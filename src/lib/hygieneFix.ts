/**
 * Deterministic hygiene fixer: removes ONLY provably-safe unused import bindings that the compiler
 * named (TS6133 / TS6196 on an import specifier or default import, TS6192 for a whole declaration).
 * It never touches locals, parameters or any non-import code, and returns the input unchanged when
 * anything about a declaration looks unusual (comments inside the binding clause, string-named
 * specifiers, `import x = require()`, imports after other code, stale line numbers, ...).
 *
 * Pure: no I/O. The caller writes the returned text back and re-verifies.
 */

export interface HygieneError {
  line?: number;
  code?: string;
  message: string;
}

export interface HygieneFixResult {
  text: string;
  /** Number of import bindings removed (a whole declaration counts each of its bindings). */
  removed: number;
  /** Local names of the removed bindings. */
  names: string[];
}

const UNUSED_NAME = /^'([^']+)' is declared but (?:its value is never read|never used)/i;
const ALL_IMPORTS_UNUSED = /^All imports in import declaration are unused/i;

interface Binding {
  local: string;
  start: number;
  end: number;
}

interface NamedSpec extends Binding {
  text: string;
}

interface ImportDecl {
  start: number;
  end: number;
  startLine: number;
  endLine: number;
  /** `import type ...` */
  typeOnly: boolean;
  /** Offset right after `import` (and `type`) keywords, i.e. where the binding clause begins. */
  clauseStart: number;
  /** Offset right after the last binding (`}` / namespace / default), before `from`. */
  clauseEnd: number;
  defaultBinding?: Binding;
  namespaceBinding?: Binding;
  named?: { open: number; close: number; specs: NamedSpec[]; trailingComma: boolean };
  /** A comment sits inside the binding clause: rewriting would drop it. */
  commentInClause: boolean;
}

class Bail extends Error {}

const isIdentStart = (ch: string | undefined) => !!ch && /[A-Za-z_$\u0080-\uffff]/.test(ch);
const isIdentPart = (ch: string | undefined) => !!ch && /[A-Za-z0-9_$\u0080-\uffff]/.test(ch);

/** True for the TS diagnostics this module can act on. */
export function isHygieneError(error: HygieneError): boolean {
  const code = (error.code || '').toUpperCase();
  if (code === 'TS6192') return true;
  if (code && code !== 'TS6133' && code !== 'TS6196') return false;
  return UNUSED_NAME.test((error.message || '').trim());
}

function lineStartsOf(text: string): number[] {
  const starts = [0];
  for (let i = 0; i < text.length; i += 1) if (text.charCodeAt(i) === 10) starts.push(i + 1);
  return starts;
}

function lineOfOffset(starts: number[], offset: number): number {
  let lo = 0;
  let hi = starts.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (starts[mid] <= offset) lo = mid;
    else hi = mid - 1;
  }
  return lo + 1;
}

function skipTrivia(text: string, from: number): { pos: number; comment: boolean } {
  let i = from;
  let comment = false;
  for (;;) {
    const ch = text[i];
    if (ch === undefined) return { pos: i, comment };
    if (/\s/.test(ch) || ch === '\uFEFF') {
      i += 1;
    } else if (ch === '/' && text[i + 1] === '/') {
      comment = true;
      const nl = text.indexOf('\n', i);
      i = nl < 0 ? text.length : nl + 1;
    } else if (ch === '/' && text[i + 1] === '*') {
      comment = true;
      const close = text.indexOf('*/', i + 2);
      if (close < 0) throw new Bail();
      i = close + 2;
    } else {
      return { pos: i, comment };
    }
  }
}

function skipString(text: string, from: number): number {
  const quote = text[from];
  let i = from + 1;
  while (i < text.length) {
    const ch = text[i];
    if (ch === '\\') i += 2;
    else if (ch === quote) return i + 1;
    else if (ch === '\n') throw new Bail();
    else i += 1;
  }
  throw new Bail();
}

function readIdent(text: string, from: number): { name: string; end: number } | null {
  if (!isIdentStart(text[from])) return null;
  let i = from + 1;
  while (isIdentPart(text[i])) i += 1;
  return { name: text.slice(from, i), end: i };
}

function isKeywordAt(text: string, i: number, word: string): boolean {
  return text.startsWith(word, i) && !isIdentPart(text[i + word.length]);
}

/** Skips `with { ... }` / `assert { ... }` import attributes when present. Returns the new offset. */
function skipAttributes(text: string, from: number): number {
  const t = skipTrivia(text, from);
  if (!(isKeywordAt(text, t.pos, 'with') || isKeywordAt(text, t.pos, 'assert'))) return from;
  const afterWord = skipTrivia(text, t.pos + (text[t.pos] === 'w' ? 4 : 6)).pos;
  if (text[afterWord] !== '{') return from;
  let depth = 0;
  let i = afterWord;
  while (i < text.length) {
    const ch = text[i];
    if (ch === '"' || ch === "'") {
      i = skipString(text, i);
      continue;
    }
    if (ch === '{') depth += 1;
    else if (ch === '}') {
      depth -= 1;
      if (depth === 0) return i + 1;
    }
    i += 1;
  }
  throw new Bail();
}

/** End of the statement after `pos`: an optional `;` on the same line. */
function endWithOptionalSemicolon(text: string, pos: number): number {
  let i = pos;
  while (text[i] === ' ' || text[i] === '\t') i += 1;
  return text[i] === ';' ? i + 1 : pos;
}

type Parsed = { kind: 'decl'; decl: ImportDecl } | { kind: 'other'; end: number } | null;

function parseNamedList(text: string, open: number): {
  specs: NamedSpec[];
  close: number;
  trailingComma: boolean;
  comment: boolean;
} {
  const specs: NamedSpec[] = [];
  let i = open + 1;
  let comment = false;
  let trailingComma = false;
  for (;;) {
    const t = skipTrivia(text, i);
    comment = comment || t.comment;
    i = t.pos;
    if (text[i] === '}') return { specs, close: i, trailingComma, comment };
    const first = readIdent(text, i);
    if (!first) throw new Bail(); // string-named or malformed specifier
    let nameEnd = first.end;
    let name = first.name;
    if (first.name === 'type') {
      const peek = skipTrivia(text, first.end);
      comment = comment || peek.comment;
      if (text[peek.pos] !== ',' && text[peek.pos] !== '}') {
        const second = readIdent(text, peek.pos);
        if (!second || second.name === 'as') throw new Bail(); // `type as x` forms are ambiguous
        name = second.name;
        nameEnd = second.end;
      }
    }
    let local = name;
    let end = nameEnd;
    const afterName = skipTrivia(text, nameEnd);
    comment = comment || afterName.comment;
    if (isKeywordAt(text, afterName.pos, 'as')) {
      const afterAs = skipTrivia(text, afterName.pos + 2);
      comment = comment || afterAs.comment;
      const alias = readIdent(text, afterAs.pos);
      if (!alias) throw new Bail();
      local = alias.name;
      end = alias.end;
    }
    specs.push({ local, start: i, end, text: text.slice(i, end) });
    const after = skipTrivia(text, end);
    comment = comment || after.comment;
    i = after.pos;
    if (text[i] === ',') {
      i += 1;
      const next = skipTrivia(text, i);
      comment = comment || next.comment;
      trailingComma = text[next.pos] === '}';
    } else if (text[i] === '}') {
      trailingComma = false;
    } else {
      throw new Bail();
    }
  }
}

function parseImport(text: string, importAt: number, starts: number[]): Parsed {
  let i = importAt + 'import'.length;
  let t = skipTrivia(text, i);
  i = t.pos;
  const ch = text[i];
  if (ch === '(' || ch === '.') return null; // dynamic import / import.meta: not a declaration
  if (ch === '"' || ch === "'") {
    const afterString = skipString(text, i);
    const afterAttrs = skipAttributes(text, afterString);
    return { kind: 'other', end: endWithOptionalSemicolon(text, afterAttrs) };
  }

  let typeOnly = false;
  let clauseStart = i;
  if (isKeywordAt(text, i, 'type')) {
    const after = skipTrivia(text, i + 4);
    const next = text[after.pos];
    if (next === '{' || next === '*') {
      typeOnly = true;
      i = after.pos;
      clauseStart = i;
    } else if (isIdentStart(next)) {
      const word = readIdent(text, after.pos);
      if (word && word.name === 'from') {
        const afterFrom = skipTrivia(text, word.end);
        const q = text[afterFrom.pos];
        if (q !== '"' && q !== "'") throw new Bail(); // `import type from from 'x'`
        // `import type from 'x'`: a default binding named `type`
      } else {
        typeOnly = true;
        i = after.pos;
        clauseStart = i;
      }
    }
  }

  let defaultBinding: Binding | undefined;
  let namespaceBinding: Binding | undefined;
  let named: ImportDecl['named'];
  let commentInClause = false;
  let clauseEnd = i;

  const ident = readIdent(text, i);
  if (ident && ident.name !== 'from') {
    defaultBinding = { local: ident.name, start: i, end: ident.end };
    clauseEnd = ident.end;
    t = skipTrivia(text, ident.end);
    if (text[t.pos] === '=') {
      // `import x = require('y')`: leave alone, skip to the end of the statement.
      let j = t.pos;
      while (j < text.length && text[j] !== ';' && text[j] !== '\n') j += 1;
      return { kind: 'other', end: text[j] === ';' ? j + 1 : j };
    }
    if (text[t.pos] === ',') {
      commentInClause = commentInClause || t.comment;
      t = skipTrivia(text, t.pos + 1);
      commentInClause = commentInClause || t.comment;
      i = t.pos;
    } else {
      commentInClause = commentInClause || t.comment;
      i = t.pos;
    }
  } else if (ident && ident.name === 'from' && !typeOnly) {
    // `import from 'x'` is not valid; `import from from 'x'` binds a default named `from`.
    const afterFrom = skipTrivia(text, ident.end);
    if (isKeywordAt(text, afterFrom.pos, 'from')) {
      defaultBinding = { local: 'from', start: i, end: ident.end };
      clauseEnd = ident.end;
      i = afterFrom.pos;
    } else {
      throw new Bail();
    }
  }

  if (text[i] === '*') {
    const afterStar = skipTrivia(text, i + 1);
    commentInClause = commentInClause || afterStar.comment;
    if (!isKeywordAt(text, afterStar.pos, 'as')) throw new Bail();
    const afterAs = skipTrivia(text, afterStar.pos + 2);
    commentInClause = commentInClause || afterAs.comment;
    const alias = readIdent(text, afterAs.pos);
    if (!alias) throw new Bail();
    namespaceBinding = { local: alias.name, start: i, end: alias.end };
    clauseEnd = alias.end;
    i = alias.end;
  } else if (text[i] === '{') {
    const list = parseNamedList(text, i);
    commentInClause = commentInClause || list.comment;
    named = { open: i, close: list.close, specs: list.specs, trailingComma: list.trailingComma };
    clauseEnd = list.close + 1;
    i = list.close + 1;
  }

  if (!defaultBinding && !namespaceBinding && !named) throw new Bail();
  t = skipTrivia(text, i);
  commentInClause = commentInClause || t.comment;
  if (!isKeywordAt(text, t.pos, 'from')) throw new Bail();
  t = skipTrivia(text, t.pos + 4);
  if (text[t.pos] !== '"' && text[t.pos] !== "'") throw new Bail();
  const afterModule = skipString(text, t.pos);
  const afterAttrs = skipAttributes(text, afterModule);
  const end = endWithOptionalSemicolon(text, afterAttrs);
  return {
    kind: 'decl',
    decl: {
      start: importAt,
      end,
      startLine: lineOfOffset(starts, importAt),
      endLine: lineOfOffset(starts, Math.max(importAt, end - 1)),
      typeOnly,
      clauseStart,
      clauseEnd,
      defaultBinding,
      namespaceBinding,
      named,
      commentInClause
    }
  };
}

/** Import declarations in the leading import block only (directives and comments may precede). */
function scanLeadingImports(text: string): ImportDecl[] {
  const out: ImportDecl[] = [];
  const starts = lineStartsOf(text);
  let i = text.charCodeAt(0) === 0xfeff ? 1 : 0;
  if (text.startsWith('#!', i)) {
    const nl = text.indexOf('\n', i);
    i = nl < 0 ? text.length : nl + 1;
  }
  try {
    for (;;) {
      i = skipTrivia(text, i).pos;
      if (i >= text.length) break;
      const ch = text[i];
      if (ch === ';') {
        i += 1;
        continue;
      }
      if (ch === '"' || ch === "'") {
        const afterString = skipString(text, i);
        let j = afterString;
        while (text[j] === ' ' || text[j] === '\t') j += 1;
        if (text[j] === ';') j += 1;
        else if (j < text.length && text[j] !== '\n' && text[j] !== '\r') break;
        i = j;
        continue;
      }
      if (!isKeywordAt(text, i, 'import')) break;
      const parsed = parseImport(text, i, starts);
      if (!parsed) break;
      if (parsed.kind === 'decl') out.push(parsed.decl);
      i = parsed.kind === 'decl' ? parsed.decl.end : parsed.end;
    }
  } catch (err) {
    if (!(err instanceof Bail)) throw err;
  }
  return out;
}

function bindingsOf(decl: ImportDecl): string[] {
  return [
    ...(decl.defaultBinding ? [decl.defaultBinding.local] : []),
    ...(decl.namespaceBinding ? [decl.namespaceBinding.local] : []),
    ...(decl.named ? decl.named.specs.map(spec => spec.local) : [])
  ];
}

function rebuildNamed(text: string, decl: ImportDecl, kept: NamedSpec[]): string {
  const named = decl.named!;
  const braceText = text.slice(named.open, named.close + 1);
  const multiline = braceText.includes('\n');
  const spaced = /^\{\s/.test(braceText);
  if (!multiline) {
    const pad = spaced ? ' ' : '';
    return `{${pad}${kept.map(s => s.text).join(', ')}${pad}}`;
  }
  const eol = braceText.includes('\r\n') ? '\r\n' : '\n';
  const starts = lineStartsOf(text);
  const specLineStart = (spec: NamedSpec) => starts[lineOfOffset(starts, spec.start) - 1];
  const ownLine = named.specs.every(spec => /^\s*$/.test(text.slice(specLineStart(spec), spec.start)));
  if (!ownLine) {
    return `{ ${kept.map(s => s.text).join(', ')} }`;
  }
  const first = named.specs[0];
  const indent = text.slice(specLineStart(first), first.start);
  const closeLineStart = starts[lineOfOffset(starts, named.close) - 1];
  const closeIndentRaw = text.slice(closeLineStart, named.close);
  const closeIndent = /^\s*$/.test(closeIndentRaw) ? closeIndentRaw : '';
  return `{${eol}${kept.map(s => `${indent}${s.text}`).join(`,${eol}`)}${named.trailingComma ? ',' : ''}${eol}${closeIndent}}`;
}

interface Edit {
  start: number;
  end: number;
  replacement: string;
}

/** Whole-declaration removal range: the full line(s) when the statement owns them. */
function wholeDeclarationRange(text: string, decl: ImportDecl): { start: number; end: number } {
  const lineStart = text.lastIndexOf('\n', decl.start - 1) + 1;
  const before = text.slice(lineStart, decl.start);
  let after = decl.end;
  while (text[after] === ' ' || text[after] === '\t') after += 1;
  const atEol = after >= text.length || text[after] === '\n' || text[after] === '\r';
  if (/^[ \t]*$/.test(before) && atEol) {
    let end = after;
    if (text[end] === '\r') end += 1;
    if (text[end] === '\n') end += 1;
    return { start: lineStart, end };
  }
  return { start: decl.start, end: after };
}

/**
 * Remove the unused import bindings the compiler reported. `errors` are the diagnostics for ONE
 * file. Returns the input text and `removed: 0` when nothing could be removed safely.
 */
export function fixUnusedImports(text: string, errors: HygieneError[]): HygieneFixResult {
  const noop: HygieneFixResult = { text, removed: 0, names: [] };
  if (!text || !errors.length) return noop;
  const wanted: Array<{ line: number; name?: string; all: boolean }> = [];
  for (const error of errors) {
    if (!isHygieneError(error) || !error.line || error.line < 1) continue;
    const message = (error.message || '').trim();
    const named = UNUSED_NAME.exec(message);
    if (named) wanted.push({ line: error.line, name: named[1], all: false });
    else if (ALL_IMPORTS_UNUSED.test(message) || (error.code || '').toUpperCase() === 'TS6192') {
      wanted.push({ line: error.line, all: true });
    }
  }
  if (!wanted.length) return noop;

  const decls = scanLeadingImports(text);
  if (!decls.length) return noop;

  const edits: Edit[] = [];
  const removedNames: string[] = [];
  const expectedAfter: string[] = [];
  let removedCount = 0;

  for (const decl of decls) {
    const inDecl = wanted.filter(w => w.line >= decl.startLine && w.line <= decl.endLine);
    const all = bindingsOf(decl);
    if (!inDecl.length) {
      expectedAfter.push(...all);
      continue;
    }
    if (decl.commentInClause) {
      expectedAfter.push(...all);
      continue;
    }
    const allUnused = inDecl.some(w => w.all);
    const unusedNames = new Set(inDecl.filter(w => w.name).map(w => w.name as string));
    const isGone = (local: string) => allUnused || unusedNames.has(local);

    const dropDefault = !!decl.defaultBinding && isGone(decl.defaultBinding.local);
    const dropNs = !!decl.namespaceBinding && isGone(decl.namespaceBinding.local);
    const keptSpecs = decl.named ? decl.named.specs.filter(spec => !isGone(spec.local)) : [];
    const droppedSpecs = decl.named ? decl.named.specs.length - keptSpecs.length : 0;
    const removedHere =
      (dropDefault ? 1 : 0) + (dropNs ? 1 : 0) + droppedSpecs;
    if (removedHere === 0) {
      expectedAfter.push(...all);
      continue;
    }
    const keepDefault = !!decl.defaultBinding && !dropDefault;
    const keepNs = !!decl.namespaceBinding && !dropNs;
    const keptNamed = keptSpecs.length > 0;

    const droppedLocals = [
      ...(dropDefault ? [decl.defaultBinding!.local] : []),
      ...(dropNs ? [decl.namespaceBinding!.local] : []),
      ...(decl.named ? decl.named.specs.filter(spec => isGone(spec.local)).map(spec => spec.local) : [])
    ];

    if (!keepDefault && !keepNs && !keptNamed) {
      const range = wholeDeclarationRange(text, decl);
      edits.push({ start: range.start, end: range.end, replacement: '' });
    } else {
      const parts: string[] = [];
      if (keepDefault) parts.push(text.slice(decl.defaultBinding!.start, decl.defaultBinding!.end));
      if (keepNs) parts.push(text.slice(decl.namespaceBinding!.start, decl.namespaceBinding!.end));
      if (keptNamed) parts.push(rebuildNamed(text, decl, keptSpecs));
      const firstBindingStart = Math.min(
        decl.defaultBinding ? decl.defaultBinding.start : Infinity,
        decl.namespaceBinding ? decl.namespaceBinding.start : Infinity,
        decl.named ? decl.named.open : Infinity
      );
      edits.push({
        start: firstBindingStart,
        end: decl.clauseEnd,
        replacement: parts.join(', ')
      });
    }
    removedCount += removedHere;
    removedNames.push(...droppedLocals);
    expectedAfter.push(...all.filter(local => !droppedLocals.includes(local)));
  }

  if (!edits.length) return noop;

  edits.sort((a, b) => b.start - a.start);
  let out = text;
  for (const edit of edits) out = out.slice(0, edit.start) + edit.replacement + out.slice(edit.end);
  if (out === text) return noop;

  // Safety net: the rewritten import block must parse and bind exactly what we meant to keep.
  const reparsed = scanLeadingImports(out).flatMap(bindingsOf).sort();
  const expected = [...expectedAfter].sort();
  if (reparsed.length !== expected.length || reparsed.some((name, idx) => name !== expected[idx])) {
    return noop;
  }
  return { text: out, removed: removedCount, names: removedNames };
}
