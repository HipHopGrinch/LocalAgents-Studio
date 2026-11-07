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
  if (/\b(golang|\bgo\b)\b/.test(t)) return 'go';
  if (/\brust\b/.test(t)) return 'rust';
  if (/\b(react|vite|three\.?js|r3f|browser|web|html|typescript|spa)\b/.test(t)) return 'web';
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
      content: `import React from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import './index.css';

createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
`
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

/** True when content looks like a real HTML document entry (not plan prose). */
export function looksLikeRealIndexHtml(body: string): boolean {
  const t = (body || '').trim();
  if (!t) return false;
  if (/<plan_options\b/i.test(t) || /###\s*Intent Analysis/i.test(t)) return false;
  return /<!doctype\s+html/i.test(t) || /<html[\s>]/i.test(t);
}
