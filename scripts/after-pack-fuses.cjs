/**
 * Flip Electron fuses on the packaged binary.
 * Keep this list identical to package.json `build.electronFuses`.
 * electron-builder applies that config again after this hook, using its own
 * @electron/fuses, and embeds the ASAR integrity hash while packing.
 *
 * Left on (Electron defaults this app still needs):
 * - RunAsNode: workspace typecheck spawns process.execPath with ELECTRON_RUN_AS_NODE
 *   so the bundled tsc.js runs. Disabling the fuse makes that spawn a second app instance.
 * - GrantFileProtocolExtraPrivileges: production UI is BrowserWindow.loadFile(dist/index.html),
 *   a Vite <script type="module"> bundle. file:// pages need the extra privileges to fetch
 *   sibling module and worker scripts. WasmTrapHandlers is not set (stock default).
 */
async function afterPack(context) {
  const fs = require('fs');
  const path = require('path');
  const { flipFuses, FuseVersion, FuseV1Options } = await import('@electron/fuses');

  const ext =
    {
      darwin: '.app',
      mas: '.app',
      win32: '.exe',
      linux: ''
    }[context.electronPlatformName] || '';
  const executableName = context.packager.appInfo.productFilename;
  const electronBinaryPath = path.join(context.appOutDir, `${executableName}${ext}`);
  if (!fs.existsSync(electronBinaryPath)) {
    throw new Error(`afterPack fuses: Electron binary not found at ${electronBinaryPath}`);
  }

  await flipFuses(electronBinaryPath, {
    version: FuseVersion.V1,
    resetAdHocDarwinSignature: context.electronPlatformName === 'darwin',
    [FuseV1Options.RunAsNode]: true,
    [FuseV1Options.EnableCookieEncryption]: true,
    [FuseV1Options.EnableNodeOptionsEnvironmentVariable]: false,
    [FuseV1Options.EnableNodeCliInspectArguments]: false,
    [FuseV1Options.EnableEmbeddedAsarIntegrityValidation]: true,
    [FuseV1Options.OnlyLoadAppFromAsar]: true,
    [FuseV1Options.LoadBrowserProcessSpecificV8Snapshot]: false,
    [FuseV1Options.GrantFileProtocolExtraPrivileges]: true
  });

  console.log(`[after-pack-fuses] ${electronBinaryPath}`);
  console.log('[after-pack-fuses] RunAsNode=on EnableCookieEncryption=on');
  console.log('[after-pack-fuses] EnableNodeOptionsEnvironmentVariable=off EnableNodeCliInspectArguments=off');
  console.log('[after-pack-fuses] EnableEmbeddedAsarIntegrityValidation=on OnlyLoadAppFromAsar=on');
  console.log('[after-pack-fuses] LoadBrowserProcessSpecificV8Snapshot=off GrantFileProtocolExtraPrivileges=on');
}

module.exports = afterPack;
