/**
 * Decide whether a finished plan should run the workspace's Electron pack script.
 * Stack verify (`npm run build`, tsc, cargo) does not produce an installer.
 * This never invents Studio's own release pipeline — it only runs a script
 * that already exists in the open project's package.json.
 */

export const ELECTRON_DIST_TIMEOUT_SEC = 1200;

const PACK_RE =
  /\belectron-builder\b|\belectron-forge\b|\belectron-packager\b|@electron-forge\/cli\b/;

/** Pack scripts, preferred first. `dist` wins over `dist:dir` (unpacked only). */
const PREFERRED_PACK_NAMES = ['dist', 'dist:win', 'pack', 'dist:portable', 'package', 'dist:dir'];

/** Locked Electron delivery may run these even when the body does not mention electron-builder. */
const ELECTRON_DELIVERY_NAMES = ['dist', 'dist:win', 'pack', 'dist:portable'];

const SCRIPT_NAME = /^[A-Za-z0-9:_./-]+$/;

export type ElectronDistDecision =
  | { run: true; scriptName: string; command: string }
  | { run: false; reason: 'no-pack-script' | 'unsafe-script-name' };

export interface PackageBuildConfig {
  scripts?: Record<string, unknown> | null;
  build?: { directories?: { output?: string } };
}

function scriptEntries(
  scripts: Record<string, unknown> | null | undefined
): [string, string][] {
  if (!scripts || typeof scripts !== 'object') return [];
  return Object.entries(scripts).filter(
    (pair): pair is [string, string] =>
      typeof pair[0] === 'string' && typeof pair[1] === 'string' && !!pair[1].trim()
  );
}

export function scriptLooksLikeElectronPack(command: string): boolean {
  return PACK_RE.test(command || '');
}

/** The user project's pack script, or null when this delivery should not be packaged. */
export function pickElectronDistScript(
  scripts: Record<string, unknown> | null | undefined,
  delivery?: string | null
): { name: string; command: string } | null {
  const entries = scriptEntries(scripts);
  const pack = entries.filter(([, cmd]) => scriptLooksLikeElectronPack(cmd));
  const byName = (list: [string, string][], name: string) => list.find(([n]) => n === name);

  for (const name of PREFERRED_PACK_NAMES) {
    const hit = byName(pack, name);
    if (hit) return { name: hit[0], command: hit[1] };
  }
  const other = pack.find(([name]) => !/^(pre|post)/i.test(name));
  if (other) return { name: other[0], command: other[1] };

  if (delivery === 'electron') {
    for (const name of ELECTRON_DELIVERY_NAMES) {
      const hit = byName(entries, name);
      if (hit) return { name: hit[0], command: hit[1] };
    }
  }
  return null;
}

/** PowerShell: skip Windows cert lookup (it hangs unsigned builds), then the project's script. */
export function electronDistShellCommand(scriptName: string): string | null {
  const name = (scriptName || '').trim();
  if (!SCRIPT_NAME.test(name)) return null;
  return `$env:CSC_IDENTITY_AUTO_DISCOVERY='false'; npm run "${name}"`;
}

export function decideElectronDist(
  delivery: string | null | undefined,
  scripts: Record<string, unknown> | null | undefined
): ElectronDistDecision {
  const picked = pickElectronDistScript(scripts, delivery);
  if (!picked) return { run: false, reason: 'no-pack-script' };
  const command = electronDistShellCommand(picked.name);
  if (!command) return { run: false, reason: 'unsafe-script-name' };
  return { run: true, scriptName: picked.name, command };
}

/** True when this delivery + package.json should run an Electron pack. */
export function shouldRunElectronDist(
  delivery: string | null | undefined,
  scripts: Record<string, unknown> | null | undefined
): boolean {
  return decideElectronDist(delivery, scripts).run;
}

/** Relative output folders to scan for installers. Never `node_modules` or `..`. */
export function electronOutputDirs(pkg: PackageBuildConfig | null | undefined): string[] {
  const dirs: string[] = [];
  const raw = pkg?.build?.directories?.output;
  if (typeof raw === 'string') {
    const rel = raw.trim().replace(/\\/g, '/').replace(/^\.?\//, '');
    if (
      rel &&
      !rel.includes('..') &&
      !/node_modules/i.test(rel) &&
      !rel.startsWith('/') &&
      !/^[A-Za-z]:/.test(rel)
    ) {
      dirs.push(rel);
    }
  }
  for (const fallback of ['release', 'dist']) {
    if (!dirs.some(d => d.toLowerCase() === fallback)) dirs.push(fallback);
  }
  return dirs;
}

export function distCommandFailed(output: string | null | undefined): boolean {
  const t = output || '';
  if (/timed out and was killed/i.test(t)) return true;
  if (/Exit code:\s*0\b/i.test(t)) return false;
  return true;
}

function normalizeExePath(raw: string): string | null {
  const p = (raw || '')
    .trim()
    .replace(/^["'`]+|["'`]+$/g, '')
    .replace(/[),;]+$/g, '');
  if (!p || /\.blockmap$/i.test(p) || !/\.exe$/i.test(p)) return null;
  if (/node_modules/i.test(p)) return null;
  if (/[/\\]electron\.exe$/i.test(p)) return null;
  return p.replace(/\\/g, '/').replace(/^\.\//, '');
}

/** Prefer the installer/portable exe over the unpacked runtime copy. */
export function preferShippedExes(paths: string[]): string[] {
  const seen = new Set<string>();
  const cleaned: string[] = [];
  for (const raw of paths) {
    const p = normalizeExePath(raw);
    if (!p) continue;
    const key = p.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    cleaned.push(p);
  }
  const shipped = cleaned.filter(
    p => !/\/win-unpacked\//i.test(p) && !/\/linux-unpacked\//i.test(p) && !/\/mac\//i.test(p)
  );
  return shipped.length ? shipped : cleaned;
}

export function exePathsFromDistOutput(output: string): string[] {
  const raw: string[] = [];
  for (const line of (output || '').split(/\r?\n/)) {
    const fileEq = /(?:^|\s)file=(.+)$/i.exec(line);
    if (fileEq) raw.push(fileEq[1]);
    const labeled = /(?:outFile|outfile|artifact)\s*[:=]\s*(.+\.exe)\s*$/i.exec(line);
    if (labeled) raw.push(labeled[1]);
    const loose = /((?:release|dist|out)[/\\][^\r\n]*?\.exe)(?![\w.])/gi;
    let match: RegExpExecArray | null;
    while ((match = loose.exec(line)) !== null) raw.push(match[1]);
  }
  return preferShippedExes(raw);
}

export function summarizeElectronDist(opts: {
  ok: boolean;
  scriptName: string;
  output: string;
  listedExes?: string[];
}): string {
  const script = opts.scriptName || 'dist';
  if (!opts.ok) {
    const tail = (opts.output || '').replace(/\s+/g, ' ').trim().slice(-400);
    return tail
      ? `Electron dist failed (\`npm run ${script}\`) — no installer was produced. ${tail}`
      : `Electron dist failed (\`npm run ${script}\`) — no installer was produced.`;
  }
  const fromOut = exePathsFromDistOutput(opts.output || '');
  const exes = fromOut.length ? fromOut : preferShippedExes(opts.listedExes || []);
  if (!exes.length) {
    return `npm run ${script} finished, but no .exe was found in the command output or release/. No installer to report.`;
  }
  return `Electron installer ready: ${exes.slice(0, 4).join(', ')}`;
}

/** Last echoed terminal prompt is an in-flight pack, so a second dist must not start. */
export function terminalLooksLikeRunningDist(content: string, running: boolean): boolean {
  if (!running) return false;
  const lines = (content || '')
    .split(/\r?\n/)
    .map(l => l.trim())
    .filter(Boolean);
  const prompts = lines.filter(l => l.startsWith('>'));
  const last = prompts.length ? prompts[prompts.length - 1] : '';
  if (!last) return false;
  return (
    /CSC_IDENTITY_AUTO_DISCOVERY/i.test(last) ||
    /npm\s+run\s+["']?(dist|pack)\b/i.test(last) ||
    /\belectron-builder\b/i.test(last)
  );
}

const distInFlight = new Set<string>();

export function distFlightKey(workspacePath: string): string {
  return (workspacePath || '').replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase();
}

/** False when this workspace already has a dist in flight. */
export function tryBeginElectronDist(workspacePath: string): boolean {
  const key = distFlightKey(workspacePath);
  if (!key || distInFlight.has(key)) return false;
  distInFlight.add(key);
  return true;
}

export function endElectronDist(workspacePath: string): void {
  distInFlight.delete(distFlightKey(workspacePath));
}
