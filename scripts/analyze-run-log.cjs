/**
 * Waste report for existing Conductor run logs.
 *
 *   node scripts/analyze-run-log.cjs <run-log.md> [more.md ...] [--json]
 *
 * Parses the Markdown written by src/lib/runLog.ts back into structured events and runs the same
 * analyzers the log header uses (analyzeRunWaste, summarizeRunSteps), so the CLI and the header
 * cannot drift. Needs the `tsx` dev dependency to load the TypeScript module.
 */
'use strict';

const fs = require('fs');
const path = require('path');

const KINDS = new Set([
  'run-start',
  'run-stop',
  'user',
  'turn',
  'route',
  'context',
  'tool',
  'verify',
  'verdict',
  'heal',
  'escalate',
  'pause',
  'notice',
  'swarm-assign',
  'error',
  'info'
]);

const EVENT_LINE = /^\+(\d+):(\d{2}) (\S+)(?: (.*))?$/;
const TURN_KEYS = ['phase', 'ctx', 'budget', 'est', 'promptEval', 'eval', 'reasoning', 'think', 'done', 'wall', 'total'];

function loadRunLog() {
  try {
    require('tsx/cjs');
  } catch {
    throw new Error('tsx is not installed. Run npm install.');
  }
  return require(path.join(__dirname, '..', 'src', 'lib', 'runLog.ts'));
}

function parseDuration(text) {
  const match = /^(\d+(?:\.\d+)?)(ms|s)$/.exec(text || '');
  if (!match) return undefined;
  const value = Number(match[1]);
  return match[2] === 'ms' ? value : value * 1000;
}

function takeStep(rest) {
  const match = /^step=(\S+)(?:\s+|$)/.exec(rest);
  if (!match) return { rest };
  return { stepId: match[1], rest: rest.slice(match[0].length) };
}

function joinText(inline, detail) {
  return [inline, detail].filter(part => part && part.length > 0).join('\n');
}

function parseTurn(rest, base) {
  const head = /^(\S+)(?:\s+(.*))?$/.exec(rest);
  const roleModel = head ? head[1] : 'unknown/unknown';
  const slash = roleModel.indexOf('/');
  const event = {
    ...base,
    kind: 'turn',
    role: slash > 0 ? roleModel.slice(0, slash) : roleModel,
    model: slash > 0 ? roleModel.slice(slash + 1) : 'unknown'
  };
  const tail = head && head[2] ? head[2] : '';
  const keyed = new RegExp(`(?:^|\\s)(${TURN_KEYS.join('|')})=(\\S*)`, 'g');
  let firstKey = tail.length;
  let match;
  while ((match = keyed.exec(tail)) !== null) {
    firstKey = Math.min(firstKey, match.index);
    const key = match[1];
    const value = match[2];
    const num = Number(value);
    if (key === 'phase') event.phase = value;
    else if (key === 'ctx') event.numCtx = num;
    else if (key === 'budget') event.promptBudget = num;
    else if (key === 'est') event.estPromptTokens = num;
    else if (key === 'promptEval') event.promptEvalCount = num;
    else if (key === 'eval') event.evalCount = num;
    else if (key === 'reasoning') event.reasoningTokens = num;
    else if (key === 'think') event.think = value === 'on' ? true : value === 'off' ? false : value;
    else if (key === 'done') event.doneReason = value;
    else if (key === 'wall') event.wallMs = parseDuration(value);
    else if (key === 'total') event.totalDurationNs = (parseDuration(value) ?? 0) * 1e6;
  }
  const node = /(?:^|\s)@(.+?)(?=\s(?:phase|ctx|budget|est|promptEval|eval|reasoning|think|done|wall|total)=|\saborted\b|\serror\b|$)/.exec(
    tail
  );
  if (node) event.nodeName = node[1].trim();
  if (/(?:^|\s)aborted(?:\s|$)/.test(tail)) event.aborted = true;
  const rate = /(?:^|\s)(\d+(?:\.\d+)?) tok\/s/.exec(tail);
  if (rate) event.tokPerSec = Number(rate[1]);
  const err = /(?:^|\s)error=(.*)$/.exec(tail);
  if (err) event.error = err[1];
  if (event.wallMs === undefined) delete event.wallMs;
  return event;
}

function parseTool(rest, detail, base) {
  const head = /^(\S+)(?:\s+(.*))?$/.exec(rest);
  const event = { ...base, kind: 'tool', name: head ? head[1] : 'tool' };
  let tail = head && head[2] ? head[2] : '';
  const resultAt = /(?:^|\s)result=/.exec(tail);
  let inline = '';
  if (resultAt) {
    inline = tail.slice(resultAt.index + resultAt[0].length);
    tail = tail.slice(0, resultAt.index);
  }
  const grab = (key, re) => {
    const found = re.exec(tail);
    if (!found) return undefined;
    tail = tail.slice(0, found.index) + tail.slice(found.index + found[0].length);
    return found[1];
  };
  const step = grab('step', /(?:^|\s)step=(\S+)/);
  const exit = grab('exit', /(?:^|\s)exit=(-?\d+)/);
  const status = grab('status', /(?:^|\s)status=(\S+)/);
  const pathText = tail.trim();
  if (pathText) event.path = pathText;
  if (status) event.status = status;
  if (exit !== undefined) event.exitCode = Number(exit);
  if (step) event.stepId = step;
  const result = joinText(inline, detail);
  if (result) event.result = result;
  return event;
}

function parseVerify(rest, detail, base) {
  const first = /^(\S+)(?:\s+(.*))?$/.exec(rest);
  const event = { ...base, kind: 'verify', ok: first ? first[1].toLowerCase() === 'ok' : false };
  let tail = first && first[2] ? first[2] : '';
  const outputAt = /(?:^|\s)output=/.exec(tail);
  let inline = '';
  if (outputAt) {
    inline = tail.slice(outputAt.index + outputAt[0].length);
    tail = tail.slice(0, outputAt.index);
  }
  const fp = /(?:^|\s)fp=(\S+)/.exec(tail);
  const step = /(?:^|\s)step=(\S+)/.exec(tail);
  if (fp) event.fingerprint = fp[1];
  if (step) event.stepId = step[1];
  const output = joinText(inline, detail);
  if (output) event.output = output;
  return event;
}

function parseHeal(rest, detail, base) {
  const event = { ...base, kind: 'heal' };
  const match = /^(?:step=(\S+)\s*)?(?:attempt=(\d+)(?:\/(\d+))?\s*)?(?:fp=(\S+)\s*)?(.*)$/.exec(rest);
  if (match) {
    if (match[1]) event.stepId = match[1];
    if (match[2]) event.attempt = Number(match[2]);
    if (match[3]) event.max = Number(match[3]);
    if (match[4]) event.fingerprint = match[4];
    const note = joinText(match[5], detail);
    if (note) event.note = note;
  }
  return event;
}

function parseAssignments(detail) {
  const items = [];
  for (const raw of (detail || '').split('\n')) {
    const line = raw.trim();
    if (!line) continue;
    const item = {};
    const wave = /(?:^|\s)wave=(\d+)/.exec(line);
    if (wave) item.wave = Number(wave[1]);
    const file = /(?:^|\s)file=(.+?)(?=\s(?:node|model|skipped)=|\sfrontier-backup\b|$)/.exec(line);
    if (file) item.file = file[1].trim();
    const node = /(?:^|\s)node=(.+?)(?=\s(?:model|skipped)=|\sfrontier-backup\b|$)/.exec(line);
    if (node) item.node = node[1].trim();
    const model = /(?:^|\s)model=(\S+)/.exec(line);
    if (model) item.model = model[1];
    const skipped = /(?:^|\s)skipped=(.*)$/.exec(line);
    if (skipped) item.skippedReason = skipped[1].trim();
    if (/\sfrontier-backup\b/.test(line)) item.frontierBackup = true;
    if (Object.keys(item).length > 0) items.push(item);
  }
  return items;
}

function buildEvent(kind, rest, detail, base) {
  switch (kind) {
    case 'run-start':
      return { ...base, kind };
    case 'run-stop':
      return { ...base, kind, ...(rest ? { reason: rest } : {}) };
    case 'turn':
      return parseTurn(rest, base);
    case 'tool':
      return parseTool(rest, detail, base);
    case 'verify':
      return parseVerify(rest, detail, base);
    case 'heal':
      return parseHeal(rest, detail, base);
    case 'swarm-assign':
      return { ...base, kind, assignments: parseAssignments(detail) };
    case 'verdict': {
      const first = /^(\S+)(?:\s+(.*))?$/.exec(rest);
      const taken = takeStep(first && first[2] ? first[2] : '');
      const text = joinText(taken.rest, detail);
      return {
        ...base,
        kind,
        result: first ? first[1] : 'missing',
        ...(taken.stepId ? { stepId: taken.stepId } : {}),
        ...(text ? { text } : {})
      };
    }
    case 'user':
    case 'route':
    case 'context': {
      const first = /^(\S+)(?:\s+(.*))?$/.exec(rest);
      const step = /(?:^|\s)step=(\S+)/.exec(rest);
      const text = joinText(first && first[2] ? first[2] : '', detail);
      return {
        ...base,
        kind,
        action: first ? first[1] : '',
        ...(step ? { stepId: step[1] } : {}),
        ...(text ? { text } : {})
      };
    }
    default: {
      const taken = takeStep(rest);
      return { ...base, kind, text: joinText(taken.rest, detail), ...(taken.stepId ? { stepId: taken.stepId } : {}) };
    }
  }
}

/** Markdown run log -> events (relative millisecond timestamps, run ids from the `## Run #N` headings). */
function parseRunLogMarkdown(markdown) {
  const lines = String(markdown).split(/\r?\n/);
  const events = [];
  let inTimeline = false;
  let runId;
  let pending = null;
  let fenceLen = 0;

  const flush = () => {
    if (!pending) return;
    const detail = pending.detail.join('\n');
    events.push(buildEvent(pending.kind, pending.rest, detail, pending.base));
    pending = null;
  };

  for (const line of lines) {
    if (!inTimeline) {
      if (/^(?:## )?TIMELINE\s*$/.test(line)) inTimeline = true;
      continue;
    }
    if (fenceLen > 0) {
      const close = /^(`{3,})\s*$/.exec(line);
      if (close && close[1].length >= fenceLen) fenceLen = 0;
      else if (pending) pending.detail.push(line);
      continue;
    }
    const heading = /^(?:## )?Run (?:#(\d+)(?: \(.*\))?|\(unscoped\))\s*$/.exec(line);
    if (heading) {
      flush();
      runId = heading[1] != null ? Number(heading[1]) : undefined;
      continue;
    }
    const match = EVENT_LINE.exec(line);
    if (match && KINDS.has(match[3])) {
      flush();
      const t = (Number(match[1]) * 60 + Number(match[2])) * 1000;
      pending = {
        kind: match[3],
        rest: match[4] || '',
        detail: [],
        base: { t, ...(runId != null ? { runId } : {}) }
      };
      continue;
    }
    const open = /^(`{3,})\s*$/.exec(line);
    if (open && pending) {
      fenceLen = open[1].length;
      continue;
    }
    if (pending && line.startsWith('  ')) pending.detail.push(line.slice(2));
  }
  flush();
  return events;
}

function relTime(ms) {
  const total = Math.max(0, Math.floor(ms / 1000));
  return `+${String(Math.floor(total / 60)).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`;
}

function analyzeText(runLog, markdown) {
  const events = parseRunLogMarkdown(markdown);
  const waste = runLog.analyzeRunWaste(events);
  const { steps, topTurns } = runLog.summarizeRunSteps(events, 5);
  let turns = 0;
  for (const event of events) if (event.kind === 'turn') turns += 1;
  return { events: events.length, turns, waste, steps, topTurns };
}

function pad(text, width) {
  return String(text).padEnd(width);
}

function shortModel(model) {
  return model.length > 44 ? `...${model.slice(-41)}` : model;
}

function formatReport(runLog, file, result) {
  const dur = runLog.formatWasteDuration;
  const w = result.waste;
  const out = [];
  out.push(`== ${file} ==`);
  out.push(`events ${result.events}, turns ${result.turns}, turn time ${dur(w.totalTurnMs)}`);
  for (const line of runLog.formatRunWasteLines(w)) out.push(line);
  if (w.rejectedWrites.count > 0) {
    out.push(`  rejected-writes: ${w.rejectedWrites.count} duplicate write(s) refused after a full generation`);
  }
  if (w.duplicateDispatch.count > 0) {
    out.push(`  duplicate-dispatch pairs (${w.duplicateDispatch.count}):`);
    const seen = new Set();
    for (const pair of w.duplicateDispatch.pairs) {
      const key = `${pair.file.toLowerCase()} -> ${pair.duplicateOf.toLowerCase()}`;
      if (seen.has(key)) continue;
      seen.add(key);
      const times = w.duplicateDispatch.pairs.filter(
        p => `${p.file.toLowerCase()} -> ${p.duplicateOf.toLowerCase()}` === key
      ).length;
      out.push(`    ${pair.file} == ${pair.duplicateOf}${times > 1 ? ` (x${times})` : ''}`);
    }
  }
  if (w.reviewerOnRed.count > 0) {
    out.push(
      `  reviewer-on-red: ${w.reviewerOnRed.redBeforeReview} with verify red before review, ${w.reviewerOnRed.yayToNay} ended yay->nay (verify failed)`
    );
  }
  if (w.noOpReworks.count > 0) {
    out.push(`  no-op-reworks: ${w.noOpReworks.changedNothing} changed nothing, ${w.noOpReworks.repeatedEdits} REPEATED_EDIT`);
  }
  if (w.repeatedFingerprint.count > 0) {
    const fps = w.repeatedFingerprint.fingerprints.map(f => `${f.fingerprint} x${f.count + 1}`).join(', ');
    out.push(`  repeated-fingerprint: ${fps}`);
  }
  out.push('');
  out.push('steps:');
  const header = `  ${pad('step', 6)}${pad('coder', 10)}${pad('review', 10)}${pad('other', 10)}${pad('turns', 7)}${pad('reworks', 9)}${pad('heals', 7)}${pad('vfail', 7)}verdicts`;
  out.push(header);
  for (const row of result.steps) {
    out.push(
      `  ${pad(row.stepId, 6)}${pad(dur(row.coderMs), 10)}${pad(dur(row.reviewMs), 10)}${pad(dur(row.otherMs), 10)}${pad(row.turns, 7)}${pad(row.reworks, 9)}${pad(row.heals, 7)}${pad(row.verifyFailures, 7)}${row.verdicts.join(',') || '-'}`
    );
  }
  out.push('');
  out.push(`top ${result.topTurns.length} most expensive turns:`);
  for (const turn of result.topTurns) {
    const bits = [
      relTime(turn.t),
      `step=${turn.stepId}`,
      `${turn.role}/${shortModel(turn.model)}`,
      turn.phase ? `phase=${turn.phase}` : '',
      `wall=${dur(turn.wallMs)}`,
      `eval=${turn.evalCount}`,
      turn.doneReason ? `done=${turn.doneReason}` : ''
    ].filter(Boolean);
    out.push(`  ${bits.join(' ')}`);
  }
  return out.join('\n');
}

function main(argv) {
  const json = argv.includes('--json');
  const files = argv.filter(arg => arg !== '--json');
  if (files.length === 0 || files.includes('--help') || files.includes('-h')) {
    console.error('Usage: node scripts/analyze-run-log.cjs <run-log.md> [more.md ...] [--json]');
    return files.length === 0 ? 2 : 0;
  }
  let runLog;
  try {
    runLog = loadRunLog();
  } catch (err) {
    console.error(err.message);
    return 2;
  }
  const results = [];
  let failed = false;
  for (const file of files) {
    let text;
    try {
      text = fs.readFileSync(file, 'utf8');
    } catch (err) {
      console.error(`Cannot read ${file}: ${err.message}`);
      failed = true;
      continue;
    }
    results.push({ file, ...analyzeText(runLog, text) });
  }
  if (json) console.log(JSON.stringify({ files: results }, null, 2));
  else console.log(results.map(r => formatReport(runLog, r.file, r)).join('\n\n'));
  return failed ? 1 : 0;
}

module.exports = { parseRunLogMarkdown, analyzeText, formatReport, loadRunLog };

if (require.main === module) process.exitCode = main(process.argv.slice(2));
