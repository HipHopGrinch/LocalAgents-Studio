import type { DeliveryStack } from './deliveryIntent';
import type { DeliveryTarget } from '../types';

/** Map UI delivery target → internal DeliveryStack used by Swarm/verify. */
export function deliveryToStack(delivery: DeliveryTarget | undefined | null): DeliveryStack | null {
  switch (delivery) {
    case 'web':
      return 'typescript';
    case 'electron':
    case 'node':
      return 'node';
    case 'python':
      return 'python';
    case 'native':
      return 'native-win32';
    case 'go':
      return 'go';
    case 'rust':
      return 'rust';
    default:
      return null;
  }
}

export function deliveryBadgeLabel(delivery: DeliveryTarget | undefined | null): string | null {
  switch (delivery) {
    case 'web':
      return 'Web';
    case 'electron':
      return 'Electron';
    case 'python':
      return 'Python';
    case 'native':
      return 'Native';
    case 'go':
      return 'Go';
    case 'rust':
      return 'Rust';
    case 'node':
      return 'Node';
    default:
      return null;
  }
}

/** Infer delivery from option title/description when Planner omitted the attr. */
export function inferDeliveryFromText(text: string): DeliveryTarget | undefined {
  const t = (text || '').toLowerCase();
  if (/\belectron\b/.test(t)) return 'electron';
  if (/\b(python|pygame|tkinter|fastapi|flask)\b/.test(t)) return 'python';
  if (/\b(native|win32|winforms|wpf|c\+\+|cpp|\.exe)\b/.test(t) && !/\belectron\b/.test(t)) {
    return 'native';
  }
  if (/\brust\b/.test(t)) return 'rust';
  if (/\b(react|vite|three\.?js|r3f|browser|web|html|typescript|spa)\b/.test(t)) return 'web';
  if (/\bgolang\b|\bgo\.mod\b|\bgo modules?\b|\b(?:in|using) go\b/.test(t)) return 'go';
  if (/\bnode\b/.test(t)) return 'node';
  return undefined;
}

export function normalizeDelivery(raw: string | undefined | null): DeliveryTarget | undefined {
  if (!raw) return undefined;
  const t = raw.trim().toLowerCase();
  if (t === 'web' || t === 'typescript' || t === 'static-web' || t === 'browser') return 'web';
  if (t === 'electron' || t === 'desktop') return 'electron';
  if (t === 'python' || t === 'py') return 'python';
  if (t === 'native' || t === 'native-win32' || t === 'win32') return 'native';
  if (t === 'go' || t === 'golang') return 'go';
  if (t === 'rust') return 'rust';
  if (t === 'node') return 'node';
  return undefined;
}

export interface ScaffoldFile {
  path: string;
  content: string;
}

/** Known-good Vite + React 18 starter for web / R3F-friendly stacks. */
export function typescriptWebScaffoldFiles(): ScaffoldFile[] {
  return [
    {
      path: 'package.json',
      content: `${JSON.stringify(
        {
          name: 'app',
          private: true,
          version: '0.0.1',
          type: 'module',
          scripts: {
            dev: 'vite',
            build: 'tsc -b && vite build',
            preview: 'vite preview'
          },
          dependencies: {
            react: '^18.3.1',
            'react-dom': '^18.3.1',
            three: '^0.170.0',
            '@react-three/fiber': '^8.17.10',
            '@react-three/drei': '^9.117.3'
          },
          devDependencies: {
            '@types/react': '^18.3.12',
            '@types/react-dom': '^18.3.1',
            '@types/three': '^0.170.0',
            '@vitejs/plugin-react': '^4.3.4',
            typescript: '^5.6.3',
            vite: '^5.4.11'
          }
        },
        null,
        2
      )}\n`
    },
    {
      path: 'tsconfig.json',
      content: `${JSON.stringify(
        {
          compilerOptions: {
            target: 'ES2020',
            useDefineForClassFields: true,
            lib: ['ES2020', 'DOM', 'DOM.Iterable'],
            module: 'ESNext',
            skipLibCheck: true,
            moduleResolution: 'bundler',
            allowImportingTsExtensions: true,
            isolatedModules: true,
            moduleDetection: 'force',
            noEmit: true,
            jsx: 'react-jsx',
            strict: true,
            noUnusedLocals: false,
            noUnusedParameters: false,
            noFallthroughCasesInSwitch: true,
            resolveJsonModule: true
          },
          include: ['src']
        },
        null,
        2
      )}\n`
    },
    {
      path: 'vite.config.ts',
      content: `import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
});
`
    },
    {
      path: 'index.html',
      content: `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>App</title>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/main.tsx"></script>
  </body>
</html>
`
    },
    {
      path: 'src/main.tsx',
      content: scaffoldMainTsx()
    },
    {
      path: 'src/App.tsx',
      content: `export default function App() {
  return (
    <div style={{ minHeight: '100vh', display: 'grid', placeItems: 'center', background: '#0b0b0f', color: '#eee' }}>
      <h1>App scaffold ready</h1>
    </div>
  );
}
`
    },
    {
      path: 'src/index.css',
      content: `* { box-sizing: border-box; }
html, body, #root { margin: 0; height: 100%; }
body { font-family: system-ui, sans-serif; }
`
    }
  ];
}

export function scaffoldFilesForStack(stack: DeliveryStack): ScaffoldFile[] {
  switch (stack) {
    case 'typescript':
      return typescriptWebScaffoldFiles();
    case 'node':
      return typescriptWebScaffoldFiles().map(f => {
        if (f.path !== 'package.json') return f;
        const pkg = JSON.parse(f.content);
        pkg.dependencies = {
          ...pkg.dependencies,
          electron: '^33.2.0'
        };
        pkg.devDependencies = {
          ...pkg.devDependencies,
          'electron-builder': '^25.1.8'
        };
        return { ...f, content: `${JSON.stringify(pkg, null, 2)}\n` };
      });
    case 'python':
      return [
        {
          path: 'requirements.txt',
          content: '# Add runtime deps here\n'
        },
        {
          path: 'main.py',
          content: `def main() -> None:
    print("App scaffold ready")


if __name__ == "__main__":
    main()
`
        },
        {
          path: 'README.md',
          content: '# App\n\nRun: `python main.py`\n'
        }
      ];
    case 'static-web':
      return [
        {
          path: 'index.html',
          content: `<!doctype html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>App</title>
  <link rel="stylesheet" href="styles.css" />
</head>
<body>
  <main id="app"><h1>App scaffold ready</h1></main>
  <script src="app.js"></script>
</body>
</html>
`
        },
        { path: 'styles.css', content: `body { margin: 0; font-family: system-ui, sans-serif; }\n` },
        { path: 'app.js', content: `console.log('scaffold ready');\n` }
      ];
    default:
      return [];
  }
}

/**
 * Vite entry that mounts either `export default` or a named `App`.
 * Swarm workers follow requiredExports and do not always emit a default.
 */
export function scaffoldMainTsx(): string {
  return `import React from 'react';
import { createRoot } from 'react-dom/client';
import * as AppModule from './App';
import './index.css';

const App =
  (AppModule as { default?: React.ComponentType }).default ||
  (AppModule as { App?: React.ComponentType }).App;

if (!App) {
  throw new Error('src/App.tsx must export default App or a named App component');
}

createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
`;
}

/** True when content looks like a real HTML document entry (not plan prose). */
export function looksLikeRealIndexHtml(body: string): boolean {
  const t = (body || '').trim();
  if (!t) return false;
  if (/<plan_options\b/i.test(t) || /###\s*Intent Analysis/i.test(t)) return false;
  return /<!doctype\s+html/i.test(t) || /<html[\s>]/i.test(t);
}

/** Real browser UI wording. Bare "typescript", "three", or "3d game" is not enough. */
const WEB_PROMPT =
  /\b(react|vite|r3f|webapp|web-app|website|spa)\b|\bweb\s+app\b|\bweb\s+site\b|\bbrowser\b|@react-three\/(?:fiber|drei)/i;
/** Same non-web buckets inferDeliveryStack uses, plus Electron, Node, C#, C++, and Unity. */
const NON_WEB_PROMPT =
  /\b(rust|cargo|golang|python|pygame|tkinter|django|flask|fastapi|win32|winforms|wpf|c#|csharp|c\+\+|cpp|electron|node(?:\.js)?|unity)\b/i;

/** True when the user asked for a browser web app, not a CLI, Electron shell, or native game. */
export function promptRequestsWebScaffold(text: string): boolean {
  const t = text || '';
  if (!t.trim()) return false;
  const threeDWeb = /\b3d\b/i.test(t) && /\b(webapp|web|browser|site|html)\b/i.test(t);
  if (!WEB_PROMPT.test(t) && !threeDWeb) return false;
  if (NON_WEB_PROMPT.test(t) && !/\b(react|vite|webapp)\b/i.test(t) && !/\bweb\s+app\b/i.test(t)) {
    return false;
  }
  return true;
}

export function normScaffoldPath(path: string): string {
  return (path || '').replace(/\\/g, '/').replace(/^\.\//, '').replace(/^\/+/, '').toLowerCase();
}

export interface ScaffoldTaskHint {
  filePath: string;
  instructions?: string;
  requiredExports?: string[];
}

export interface ScaffoldManifestHint {
  stack?: string | null;
  contractCode?: string | null;
  tasks?: ScaffoldTaskHint[] | null;
}

const NON_WEB_MANIFEST_STACKS = new Set(['node', 'native-win32', 'python', 'go', 'rust']);
const WEB_MANIFEST_TEXT =
  /\b(react|vite|r3f|webapp|web-app|website)\b|\bweb\s+app\b|\bweb\s+site\b|\bbrowser\b|@react-three\/(?:fiber|drei)/i;

/**
 * True when Pass 1 described a browser web app.
 * A TypeScript or Node stack label, or a plain .ts file, is not a web signal.
 */
export function manifestNeedsWebScaffold(manifest: ScaffoldManifestHint, userText = ''): boolean {
  const tasks = manifest.tasks || [];
  const hasUi = tasks.some(task => /\.(tsx|jsx)$/i.test(task.filePath || ''));
  const hasIndex = tasks.some(task => {
    const path = normScaffoldPath(task.filePath || '');
    return path === 'index.html' || path.endsWith('/index.html');
  });
  const pkgText = tasks
    .filter(task => normScaffoldPath(task.filePath || '') === 'package.json')
    .map(task => task.instructions || '')
    .join('\n');
  const mentions = WEB_MANIFEST_TEXT.test(`${pkgText}\n${manifest.contractCode || ''}\n${userText || ''}`);
  if (!hasUi && !hasIndex && !mentions) return false;
  const stack = String(manifest.stack || '').toLowerCase();
  if (NON_WEB_MANIFEST_STACKS.has(stack) && !hasUi && !mentions) return false;
  return true;
}

export const VITE_PACKAGE_TASK_NOTE =
  'Include dependencies react and react-dom, and devDependencies vite, @vitejs/plugin-react, typescript, and @types/react. Scripts must include "dev": "vite" and "build": "tsc -b && vite build". Keep those if you also add three or @react-three/fiber.';

export const APP_DEFAULT_EXPORT_NOTE =
  'Export the root component as `export default function App`. src/main.tsx also mounts a named export `App`.';

export const MAIN_TSX_NOTE =
  "Mount App (default export or named App) with createRoot. Import './index.css' only if that file exists.";

/** Replace index.html only when it is empty or still the scaffold placeholder. */
export function shouldReplaceScaffoldIndexHtml(body: string | null | undefined): boolean {
  if (body == null) return true;
  const t = String(body).trim();
  if (!t) return true;
  if (looksLikeRealIndexHtml(t)) return false;
  return t.length < 400 && /scaffold ready/i.test(t);
}

export interface ScaffoldWritePlan {
  toWrite: ScaffoldFile[];
  ownedSkips: string[];
  notes: { path: string; note: string }[];
}

/** Skip scaffold files a manifest task owns. Those workers get a note instead of a clobber. */
export function planWebScaffoldWrites(tasks: ScaffoldTaskHint[]): ScaffoldWritePlan {
  const owned = new Map<string, ScaffoldTaskHint>();
  for (const task of tasks) {
    const key = normScaffoldPath(task.filePath || '');
    if (key) owned.set(key, task);
  }
  const toWrite: ScaffoldFile[] = [];
  const ownedSkips: string[] = [];
  const notes: { path: string; note: string }[] = [];
  for (const file of scaffoldFilesForStack('typescript')) {
    const key = normScaffoldPath(file.path);
    const task = owned.get(key);
    if (task) {
      ownedSkips.push(file.path);
      if (key === 'package.json') notes.push({ path: task.filePath, note: VITE_PACKAGE_TASK_NOTE });
      if (key === 'src/app.tsx') {
        const specified = (task.requiredExports || []).some(
          exp => /export\s+default\b/i.test(exp) || /\bApp\b/.test(exp)
        );
        if (!specified) notes.push({ path: task.filePath, note: APP_DEFAULT_EXPORT_NOTE });
      }
      if (key === 'src/main.tsx') notes.push({ path: task.filePath, note: MAIN_TSX_NOTE });
      continue;
    }
    toWrite.push(file);
  }
  return { toWrite, ownedSkips, notes };
}

function scaffoldPackageTemplate(): {
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
  scripts?: Record<string, string>;
} {
  const raw = scaffoldFilesForStack('typescript').find(file => file.path === 'package.json')?.content || '{}';
  return JSON.parse(raw) as {
    dependencies?: Record<string, string>;
    devDependencies?: Record<string, string>;
    scripts?: Record<string, string>;
  };
}

function essentialWebPackageFields(hint = ''): {
  dependencies: Record<string, string>;
  devDependencies: Record<string, string>;
  scripts: Record<string, string>;
} {
  const pkg = scaffoldPackageTemplate();
  const dependencies: Record<string, string> = {
    react: pkg.dependencies?.react || '^18.3.1',
    'react-dom': pkg.dependencies?.['react-dom'] || '^18.3.1'
  };
  const devDependencies: Record<string, string> = {
    vite: pkg.devDependencies?.vite || '^5.4.11',
    '@vitejs/plugin-react': pkg.devDependencies?.['@vitejs/plugin-react'] || '^4.3.4',
    typescript: pkg.devDependencies?.typescript || '^5.6.3',
    '@types/react': pkg.devDependencies?.['@types/react'] || '^18.3.12'
  };
  const mentioned = (name: string) => hint.includes(name);
  const quotedThree = /['"]three['"]|\bthree\.js\b/.test(hint);
  if ((quotedThree || mentioned('@react-three/fiber')) && pkg.dependencies?.three) {
    dependencies.three = pkg.dependencies.three;
  }
  if (mentioned('@react-three/fiber') && pkg.dependencies?.['@react-three/fiber']) {
    dependencies['@react-three/fiber'] = pkg.dependencies['@react-three/fiber'];
  }
  if (mentioned('@react-three/drei') && pkg.dependencies?.['@react-three/drei']) {
    dependencies['@react-three/drei'] = pkg.dependencies['@react-three/drei'];
  }
  if (pkg.devDependencies?.['@types/react-dom']) {
    devDependencies['@types/react-dom'] = pkg.devDependencies['@types/react-dom'];
  }
  return {
    dependencies,
    devDependencies,
    scripts: {
      dev: pkg.scripts?.dev || 'vite',
      build: pkg.scripts?.build || 'tsc -b && vite build'
    }
  };
}

/**
 * Add missing Vite/React toolchain fields. Existing versions and scripts stay.
 * 3D packages are copied from the scaffold only when `hint` names them.
 */
export function mergeEssentialWebPackageJson(raw: string, hint = ''): { content: string; changed: boolean } {
  let pkg: Record<string, unknown>;
  try {
    pkg = JSON.parse(raw) as Record<string, unknown>;
  } catch {
    return { content: raw, changed: false };
  }
  if (!pkg || typeof pkg !== 'object' || Array.isArray(pkg)) return { content: raw, changed: false };
  const essential = essentialWebPackageFields(hint);
  let changed = false;
  const ensure = (bucket: 'dependencies' | 'devDependencies' | 'scripts', entries: Record<string, string>) => {
    const current = pkg[bucket];
    const next =
      current && typeof current === 'object' && !Array.isArray(current)
        ? { ...(current as Record<string, unknown>) }
        : {};
    let added = current == null || typeof current !== 'object' || Array.isArray(current);
    for (const [key, value] of Object.entries(entries)) {
      if (next[key] == null || next[key] === '') {
        next[key] = value;
        added = true;
      }
    }
    if (added) {
      pkg[bucket] = next;
      changed = true;
    }
  };
  ensure('scripts', essential.scripts);
  ensure('devDependencies', essential.devDependencies);
  ensure('dependencies', essential.dependencies);
  if (!changed) return { content: raw, changed: false };
  return { content: `${JSON.stringify(pkg, null, 2)}\n`, changed: true };
}
