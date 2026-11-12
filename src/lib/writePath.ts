/**
 * Keep agent writes inside the folder the desktop opened.
 * Absolute, UNC, device, and traversal paths are rejected.
 * Returns a normalized relative path only when it stays inside `root`.
 */

const DEVICE_NAME = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(\.|$)/i;

export function clampWritePath(root: string, filePath: string): string | null {
  const rootNorm = String(root || '')
    .trim()
    .replace(/[\\/]+$/, '')
    .replace(/\\/g, '/');
  if (!rootNorm) return null;
  const raw = String(filePath || '').trim().replace(/^["']|["']$/g, '');
  if (raw.includes('\0')) return null;
  if (!raw) return 'file';
  const win = raw.replace(/\//g, '\\');
  if (/^\\\\[?.]\\/i.test(win)) return null;
  let norm = raw.replace(/\\/g, '/');
  if (/^\/\/[?.]\//i.test(norm)) return null;
  const rootLower = rootNorm.toLowerCase();
  const lower = norm.toLowerCase();
  const rooted = /^[a-zA-Z]:/.test(norm) || norm.startsWith('/');
  if (rooted) {
    if (lower === rootLower) return 'file';
    if (lower.startsWith(rootLower + '/')) norm = norm.slice(rootNorm.length + 1);
    else return null;
  }
  if (/^[a-zA-Z]:/.test(norm) || norm.startsWith('/')) return null;
  if (norm.split('/').some(part => part === '..')) return null;
  const parts = norm.split('/').filter(part => part && part !== '.');
  if (!parts.length) return null;
  for (const part of parts) {
    if (part.includes('\0') || part.includes(':')) return null;
    if (DEVICE_NAME.test(part)) return null;
  }
  return parts.join('/');
}
