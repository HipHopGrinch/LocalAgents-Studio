/**
 * electron-builder drops every *.d.ts under node_modules.
 * Packaged `tsc` reads lib.*.d.ts from disk beside lib/_tsc.js (tsc.js is only a shim).
 * Return true so those library files survive. Everything else follows the files globs.
 * @param {string} filePath
 */
module.exports = function onNodeModuleFile(filePath) {
  const norm = String(filePath).replace(/\\/g, '/');
  const marker = '/node_modules/typescript/lib/';
  const at = norm.lastIndexOf(marker);
  if (at < 0) return undefined;
  const base = norm.slice(at + marker.length);
  if (base.includes('/')) return undefined;
  if (base.startsWith('lib.') && base.endsWith('.d.ts')) return true;
  return undefined;
};
