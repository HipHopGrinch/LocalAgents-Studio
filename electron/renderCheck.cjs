'use strict';

/**
 * Render smoke check for web (Vite) workspaces.
 *
 * `tsc`, the web entry gate and the Reviewer are all static, so a project can pass them and still
 * paint a 150px-tall canvas or a blank page. This starts the project's own Vite dev server on a
 * free 127.0.0.1 port, loads it in a hidden sandboxed BrowserWindow, and returns raw measurements
 * (console output, load failures, canvas/parent rects, unmatched CSS classes, a screenshot).
 * `src/lib/renderGate.ts` turns the raw result into findings.
 *
 * Boundaries:
 *  - The caller has already jailed `root` to the open workspace.
 *  - Never runs `npm install`: no local vite means `{ skipped: true }`.
 *  - The page window has no preload, no Node, its own in-memory partition (no Studio cookies or
 *    storage), cannot navigate off the dev-server origin, cannot open windows, and gets no
 *    permissions. Off-loopback requests are cancelled except GET/HEAD subresources (CDN assets).
 *  - The whole check is bounded by a hard deadline and the vite process tree is always killed.
 *  - Never throws: every failure is a returned `{ skipped, reason }`.
 */

const path = require('path');
const fs = require('fs');
const net = require('net');
const http = require('http');
const crypto = require('crypto');
const { spawn } = require('child_process');

const TOTAL_TIMEOUT_MS = 45000;
const SERVER_READY_MS = 22000;
const DEFAULT_SETTLE_MS = 2500;
const VIEWPORT = { width: 1280, height: 800 };
const MAX_CONSOLE = 60;
const MAX_MESSAGE_CHARS = 400;
const SERVER_LOG_CAP = 6000;

class RenderSkip extends Error {}

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

/** @type {Map<string, Promise<any>>} one check per workspace at a time */
const inFlight = new Map();

// Vite's own lookup order, so the check runs the same config `npm run dev` would.
const VITE_CONFIG_NAMES = ['vite.config.js', 'vite.config.mjs', 'vite.config.ts', 'vite.config.cjs', 'vite.config.mts', 'vite.config.cts'];

/**
 * The user's own `npm run dev` may be running in this workspace. Two Vite servers sharing
 * `node_modules/.vite` invalidate each other's optimized deps ("Outdated Optimize Dep" / missing
 * chunk errors in the user's browser), so the check runs through a wrapper config that keeps the
 * project's config but moves `cacheDir` under `.localagents/render` and turns off HMR.
 */
function writeIsolatedViteConfig(root) {
  const dir = path.join(root, '.localagents', 'render');
  fs.mkdirSync(dir, { recursive: true });
  const userConfig = VITE_CONFIG_NAMES.map(name => path.join(root, name)).find(p => fs.existsSync(p));
  const importLine = userConfig
    ? `import userConfig from ${JSON.stringify(path.relative(dir, userConfig).split(path.sep).join('/').replace(/^(?!\.)/, './'))};`
    : 'const userConfig = {};';
  const body = `${importLine}
import { mergeConfig } from 'vite';
export default async (env) => {
  const base = typeof userConfig === 'function' ? await userConfig(env) : await userConfig;
  return mergeConfig(base || {}, {
    cacheDir: ${JSON.stringify(path.join(dir, 'vite-cache').split(path.sep).join('/'))},
    server: { hmr: false, open: false }
  });
};
`;
  const file = path.join(dir, 'vite.render.config.mjs');
  fs.writeFileSync(file, body);
  return file;
}

function freePort() {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.unref();
    srv.on('error', reject);
    srv.listen(0, '127.0.0.1', () => {
      const addr = srv.address();
      const port = addr && typeof addr === 'object' ? addr.port : 0;
      srv.close(() => (port ? resolve(port) : reject(new Error('no free port'))));
    });
  });
}

function probe(port, pathname) {
  return new Promise(resolve => {
    const req = http.get(
      { host: '127.0.0.1', port, path: pathname || '/', timeout: 2500, headers: { Accept: 'text/html' } },
      res => {
        let body = '';
        res.setEncoding('utf8');
        res.on('data', chunk => {
          if (body.length < 4000) body += chunk;
        });
        res.on('end', () => resolve({ status: res.statusCode || 0, body }));
        res.on('error', () => resolve(null));
      }
    );
    req.on('timeout', () => req.destroy());
    req.on('error', () => resolve(null));
  });
}

function isLocalRequestUrl(url) {
  try {
    const u = new URL(url);
    if (u.protocol === 'data:' || u.protocol === 'blob:' || u.protocol === 'about:') return true;
    if (u.protocol === 'devtools:') return true;
    return (
      (u.protocol === 'http:' || u.protocol === 'ws:') && (u.hostname === '127.0.0.1' || u.hostname === 'localhost')
    );
  } catch {
    return false;
  }
}

/** Runs inside the page. Must stay a self-contained expression returning plain JSON. */
const MEASURE_SCRIPT = `(() => {
  const vw = window.innerWidth, vh = window.innerHeight;
  const rectOf = el => {
    const r = el.getBoundingClientRect();
    return { x: Math.round(r.x), y: Math.round(r.y), width: Math.round(r.width), height: Math.round(r.height) };
  };
  const describe = el => {
    if (!el) return '';
    let s = el.tagName.toLowerCase();
    if (el.id) s += '#' + el.id;
    const cls = typeof el.className === 'string' ? el.className.trim().split(/\\s+/).filter(Boolean).slice(0, 3) : [];
    if (cls.length) s += '.' + cls.join('.');
    return s;
  };
  const isVisible = el => {
    const cs = getComputedStyle(el);
    if (cs.display === 'none' || cs.visibility === 'hidden' || parseFloat(cs.opacity) === 0) return false;
    const r = el.getBoundingClientRect();
    return r.width > 0 && r.height > 0;
  };
  const skip = /^(SCRIPT|STYLE|LINK|META|NOSCRIPT|TEMPLATE|HEAD|TITLE|BR|VITE-ERROR-OVERLAY)$/;
  const body = document.body;
  const all = body ? Array.from(body.querySelectorAll('*')).slice(0, 5000) : [];
  let visibleCount = 0;
  for (const el of all) {
    if (skip.test(el.tagName)) continue;
    if (isVisible(el)) visibleCount++;
  }

  const canvases = [];
  for (const c of Array.from(document.querySelectorAll('canvas')).slice(0, 8)) {
    const chain = [];
    let p = c.parentElement;
    for (let i = 0; p && i < 4; i++, p = p.parentElement) {
      const cs = getComputedStyle(p);
      chain.push({
        el: describe(p),
        rect: rectOf(p),
        height: cs.height,
        minHeight: cs.minHeight,
        position: cs.position,
        display: cs.display
      });
    }
    canvases.push({
      el: describe(c),
      rect: rectOf(c),
      visible: isVisible(c),
      attrWidth: c.width,
      attrHeight: c.height,
      parent: chain[0] ? chain[0].rect : null,
      chain
    });
  }

  const mountEl = document.querySelector('#root, #app, #__next, #main') || body;
  const mount = mountEl
    ? {
        el: describe(mountEl),
        childElementCount: mountEl.childElementCount,
        textLength: (mountEl.innerText || '').trim().length,
        isBody: mountEl === body
      }
    : null;

  let largest = null;
  const candidates = mountEl ? Array.from(mountEl.children) : [];
  for (const el of candidates) {
    if (skip.test(el.tagName)) continue;
    if (!isVisible(el)) continue;
    const r = el.getBoundingClientRect();
    const area = r.width * r.height;
    if (!largest || area > largest.area) largest = { area, el };
  }
  const largestEl = largest ? { el: describe(largest.el), rect: rectOf(largest.el) } : null;

  const classNames = new Set();
  for (const el of all) {
    if (typeof el.className !== 'string') continue;
    for (const t of el.className.split(/\\s+/)) if (t) classNames.add(t);
  }
  const definedClasses = new Set();
  let sheetCount = 0;
  let ruleCount = 0;
  const collect = rules => {
    for (const rule of Array.from(rules || [])) {
      if (rule.selectorText) {
        ruleCount++;
        const re = /\\.((?:\\\\.|[\\w-])+)/g;
        let m;
        while ((m = re.exec(rule.selectorText))) definedClasses.add(m[1].replace(/\\\\(.)/g, '$1'));
      }
      if (rule.cssRules) collect(rule.cssRules);
    }
  };
  for (const sheet of Array.from(document.styleSheets)) {
    try {
      collect(sheet.cssRules);
      sheetCount++;
    } catch (e) { /* cross-origin sheet */ }
  }
  const skipClass = /^(css-|sc-|jsx-|svelte-|_|[a-z]+_[a-zA-Z0-9]{5,}$)/;
  const sample = Array.from(classNames).filter(t => !skipClass.test(t)).slice(0, 40);
  const unmatched = sheetCount ? sample.filter(t => !definedClasses.has(t)) : [];
  const unusedDefined = [];
  if (sheetCount && definedClasses.size > 0 && definedClasses.size <= 80) {
    for (const t of definedClasses) if (!classNames.has(t) && unusedDefined.length < 12) unusedDefined.push(t);
  }

  let overlay = null;
  const ov = document.querySelector('vite-error-overlay');
  if (ov) {
    const root = ov.shadowRoot;
    const q = sel => { const n = root && root.querySelector(sel); return n ? (n.textContent || '').trim().slice(0, 600) : ''; };
    overlay = { message: q('.message-body') || q('.message'), file: q('.file') };
  }

  return {
    viewport: { width: vw, height: vh },
    scroll: { width: document.documentElement.scrollWidth, height: document.documentElement.scrollHeight },
    textLength: body ? (body.innerText || '').trim().length : 0,
    textSample: body ? (body.innerText || '').trim().slice(0, 160) : '',
    visibleCount,
    canvases,
    mount,
    largest: largestEl,
    styles: {
      sheetCount,
      ruleCount,
      sampled: sample.length,
      unmatched,
      unusedDefined,
      definedCount: definedClasses.size
    },
    overlay
  };
})()`;

function clip(text, max) {
  const t = String(text == null ? '' : text);
  return t.length > max ? `${t.slice(0, max)}…` : t;
}

async function runInner(root, opts, deps) {
  const startedAt = Date.now();
  const deadline = startedAt + Math.min(Math.max(Number(opts.timeoutMs) || TOTAL_TIMEOUT_MS, 8000), 60000);
  const remaining = () => deadline - Date.now();
  const settleMs = Math.min(Math.max(Number(opts.settleMs) || DEFAULT_SETTLE_MS, 500), 8000);
  const { BrowserWindow, session } = deps.electron;
  const log = typeof deps.log === 'function' ? deps.log : () => {};

  if (!BrowserWindow || !session) throw new RenderSkip('Electron windows are not available');
  const pkgPath = path.join(root, 'package.json');
  if (!fs.existsSync(pkgPath)) throw new RenderSkip('No package.json in the workspace');
  if (!fs.existsSync(path.join(root, 'index.html'))) throw new RenderSkip('No index.html: not a Vite web project');
  const viteJs = path.join(root, 'node_modules', 'vite', 'bin', 'vite.js');
  if (!fs.existsSync(viteJs)) throw new RenderSkip('vite is not installed in node_modules (render check never runs npm install)');

  const port = await freePort();
  let serverLog = '';
  let proc = null;
  let exited = false;
  let win = null;
  let result = null;

  try {
    const env = { ...process.env, ELECTRON_RUN_AS_NODE: '1', BROWSER: 'none', CI: '1', NODE_ENV: 'development' };
    delete env.VITE_DEV_SERVER;
    delete env.NODE_OPTIONS;
    let configFile;
    try {
      configFile = writeIsolatedViteConfig(root);
    } catch (err) {
      throw new RenderSkip(`Could not write the render-check Vite config: ${err.message}`);
    }
    try {
      proc = spawn(
        process.execPath,
        [viteJs, '--config', configFile, '--port', String(port), '--strictPort', '--host', '127.0.0.1', '--clearScreen', 'false'],
        { cwd: root, env, windowsHide: true, shell: false, stdio: ['ignore', 'pipe', 'pipe'] }
      );
    } catch (err) {
      throw new RenderSkip(`Could not start vite: ${err.message}`);
    }
    if (typeof deps.trackProc === 'function') deps.trackProc(proc);
    const onData = d => {
      serverLog += d.toString();
      if (serverLog.length > SERVER_LOG_CAP) serverLog = serverLog.slice(-SERVER_LOG_CAP);
    };
    proc.stdout.on('data', onData);
    proc.stderr.on('data', onData);
    proc.once('exit', () => {
      exited = true;
    });
    proc.once('error', err => {
      exited = true;
      serverLog += `\n${err.message}`;
    });

    // Wait for the dev server to answer.
    let pagePath = '/';
    const readyBy = Math.min(deadline - 14000, Date.now() + SERVER_READY_MS);
    let ready = false;
    while (Date.now() < readyBy) {
      if (exited) throw new RenderSkip(`vite exited before it served the page: ${clip(serverLog.trim().split(/\r?\n/).slice(-4).join(' | '), 300)}`);
      const res = await probe(port, '/');
      if (res && res.status > 0 && res.status < 500) {
        const hint = /did you mean to visit\s+(\/[^\s"'<>]*)/i.exec(res.body || '');
        if (res.status === 404 && hint) pagePath = hint[1];
        ready = true;
        break;
      }
      await sleep(250);
    }
    if (!ready) throw new RenderSkip('vite dev server did not start in time');

    const origin = `http://127.0.0.1:${port}`;
    const url = `${origin}${pagePath}`;
    const partition = `render-check-${crypto.randomBytes(8).toString('hex')}`;
    const ses = session.fromPartition(partition, { cache: false });
    ses.setPermissionRequestHandler((_wc, _permission, callback) => callback(false));
    try {
      ses.setPermissionCheckHandler(() => false);
    } catch {
      /* older API shape */
    }
    let blockedExternal = 0;
    ses.webRequest.onBeforeRequest((details, callback) => {
      if (isLocalRequestUrl(details.url)) return callback({});
      // Pages fetch CDN assets the user's browser would load too (drei HDR presets, fonts, images);
      // blocking them crashes the scene and fails a healthy page. Anything that can send data stays blocked.
      if (
        (details.method === 'GET' || details.method === 'HEAD') &&
        /^https?:\/\//i.test(details.url) &&
        details.resourceType !== 'mainFrame' &&
        details.resourceType !== 'subFrame'
      ) {
        return callback({});
      }
      blockedExternal += 1;
      callback({ cancel: true });
    });

    win = new BrowserWindow({
      show: false,
      frame: false,
      width: VIEWPORT.width,
      height: VIEWPORT.height,
      useContentSize: true,
      skipTaskbar: true,
      backgroundColor: '#ffffff',
      webPreferences: {
        sandbox: true,
        contextIsolation: true,
        nodeIntegration: false,
        webSecurity: true,
        allowRunningInsecureContent: false,
        backgroundThrottling: false,
        partition,
        spellcheck: false
      }
    });
    const wc = win.webContents;
    wc.setAudioMuted(true);
    wc.setWindowOpenHandler(() => ({ action: 'deny' }));
    const blockNav = (event, navUrl) => {
      let same = false;
      try {
        same = new URL(navUrl).origin === origin;
      } catch {
        same = false;
      }
      if (!same) event.preventDefault();
    };
    wc.on('will-navigate', blockNav);
    wc.on('will-redirect', blockNav);
    wc.on('will-frame-navigate', blockNav);

    const consoleMessages = [];
    const pageErrors = [];
    let loadFailures = [];
    let crashed = false;
    let lastActivity = Date.now();
    let finishedLoads = 0;
    let mainFailed = false;
    const reset = () => {
      consoleMessages.length = 0;
      pageErrors.length = 0;
      loadFailures = [];
      mainFailed = false;
    };
    wc.on('did-start-navigation', details => {
      // Vite's first-run dependency optimizer can reload the page: judge only the final load.
      const isMain = details && (details.isMainFrame === undefined ? true : details.isMainFrame);
      if (isMain && !details.isSameDocument) {
        reset();
        lastActivity = Date.now();
      }
    });
    wc.on('did-finish-load', () => {
      finishedLoads += 1;
      lastActivity = Date.now();
    });
    wc.on('did-fail-load', (_event, errorCode, errorDescription, validatedURL, isMainFrame) => {
      if (errorCode === -3) return; // aborted by a newer navigation
      if (loadFailures.length < 10) {
        loadFailures.push({ code: errorCode, description: clip(errorDescription, 120), url: clip(validatedURL, 200), mainFrame: !!isMainFrame });
      }
      if (isMainFrame) mainFailed = true;
    });
    wc.on('render-process-gone', (_event, details) => {
      crashed = true;
      pageErrors.push({ message: `renderer process gone: ${(details && details.reason) || 'unknown'}` });
    });
    wc.on('console-message', event => {
      const level = event && typeof event === 'object' ? event.level : undefined;
      const message = event && typeof event === 'object' ? event.message : '';
      if (level !== 'warning' && level !== 'error') return;
      const text = clip(message, MAX_MESSAGE_CHARS);
      // Cancelled external requests are the sandbox working, not a project bug.
      if (/ERR_BLOCKED_BY_CLIENT/.test(text)) return;
      // Electron's dev-only CSP notice is about this harness window, not the project.
      if (/^Electron Security Warning/.test(text)) return;
      const entry = {
        level,
        message: text,
        source: clip(event.sourceId || '', 160),
        line: Number(event.lineNumber) || 0
      };
      if (level === 'error' && /^Uncaught\b/.test(text)) {
        if (pageErrors.length < 20) pageErrors.push({ message: text, source: entry.source, line: entry.line });
      }
      if (consoleMessages.length < MAX_CONSOLE) consoleMessages.push(entry);
    });

    wc.loadURL(url).catch(() => {
      /* reported through did-fail-load */
    });

    // First load, then wait until no navigation or load has happened for `settleMs`.
    while (finishedLoads === 0 && !mainFailed && !crashed && remaining() > 6000) await sleep(100);
    while (!mainFailed && !crashed && remaining() > 5000 && Date.now() - lastActivity < settleMs) await sleep(100);
    if (finishedLoads === 0 && !mainFailed && !crashed) throw new RenderSkip('page did not finish loading in time');

    let metrics = null;
    if (!crashed && !win.isDestroyed()) {
      try {
        metrics = await Promise.race([
          wc.executeJavaScript(MEASURE_SCRIPT, true),
          sleep(Math.max(2000, Math.min(8000, remaining() - 3000))).then(() => null)
        ]);
      } catch (err) {
        pageErrors.push({ message: `measurement failed: ${clip(err.message, 200)}` });
      }
    }

    let screenshotPath = '';
    let screenshotRel = '';
    if (!crashed && !win.isDestroyed() && remaining() > 1500) {
      try {
        const image = await Promise.race([wc.capturePage(), sleep(Math.min(6000, remaining() - 500)).then(() => null)]);
        if (image && !image.isEmpty()) {
          const rel = path.join('.localagents', 'render', 'last.png');
          const abs = path.join(root, rel);
          await deps.writeFile(abs, image.toPNG());
          screenshotPath = abs;
          screenshotRel = rel.replace(/\\/g, '/');
        }
      } catch (err) {
        log('warn', `render check screenshot failed: ${err.message}`);
      }
    }

    result = {
      ok: true,
      skipped: false,
      url,
      viewport: { ...VIEWPORT },
      durationMs: Date.now() - startedAt,
      console: consoleMessages,
      pageErrors,
      loadFailures,
      crashed,
      blockedExternalRequests: blockedExternal,
      metrics: metrics && typeof metrics === 'object' ? metrics : null,
      screenshotPath,
      screenshotRel
    };
  } finally {
    if (win && !win.isDestroyed()) {
      try {
        win.destroy();
      } catch {
        /* already gone */
      }
    }
    if (proc && !exited) {
      try {
        await Promise.race([Promise.resolve(deps.killTree(proc)), sleep(4000)]);
      } catch {
        /* best effort */
      }
    }
  }
  return result;
}

/**
 * @param {string} root absolute workspace path, already inside the open workspace jail
 * @param {{ timeoutMs?: number, settleMs?: number }} [opts]
 * @param {{ electron: { BrowserWindow: any, session: any }, killTree: (p: any) => any, trackProc?: (p: any) => any,
 *   writeFile: (abs: string, data: Buffer) => Promise<any>, log?: (level: string, msg: string) => void }} deps
 */
function runRenderCheck(root, opts, deps) {
  const key = String(root).toLowerCase();
  const running = inFlight.get(key);
  if (running) return running;
  const job = (async () => {
    try {
      return await runInner(root, opts || {}, deps);
    } catch (err) {
      const reason = err instanceof RenderSkip ? err.message : `render check failed to run: ${err && err.message ? err.message : err}`;
      if (!(err instanceof RenderSkip) && typeof deps.log === 'function') deps.log('warn', reason);
      return { ok: true, skipped: true, reason: clip(reason, 400) };
    } finally {
      inFlight.delete(key);
    }
  })();
  inFlight.set(key, job);
  return job;
}

module.exports = { runRenderCheck, MEASURE_SCRIPT, TOTAL_TIMEOUT_MS };
