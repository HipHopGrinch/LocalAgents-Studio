import { createHash } from 'node:crypto';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

/**
 * Production CSP meta. Dev keeps the Electron header policy (unsafe-eval for Vite).
 * Packaged file:// windows do not receive onHeadersReceived CSP.
 */
function productionCspPlugin() {
  return {
    name: 'localagents-production-csp',
    apply: 'build' as const,
    transformIndexHtml: {
      order: 'post' as const,
      handler(html: string) {
        const hashes: string[] = [];
        const re = /<script\b(?![^>]*\bsrc\s*=)[^>]*>([\s\S]*?)<\/script>/gi;
        let match: RegExpExecArray | null;
        while ((match = re.exec(html))) {
          const body = match[1] ?? '';
          if (!body) continue;
          const hash = createHash('sha256').update(body, 'utf8').digest('base64');
          hashes.push(`'sha256-${hash}'`);
        }
        const scriptSrc = ["'self'", ...hashes].join(' ');
        const csp = [
          "default-src 'self'",
          `script-src ${scriptSrc}`,
          "style-src 'self' 'unsafe-inline'",
          "img-src 'self' data: blob:",
          "font-src 'self' data: blob:",
          "connect-src 'self'",
          "worker-src 'self' blob:",
          "frame-src 'none'",
          "object-src 'none'",
          "base-uri 'self'"
        ].join('; ');
        if (/http-equiv=["']Content-Security-Policy["']/i.test(html)) return html;
        const meta = `    <meta http-equiv="Content-Security-Policy" content="${csp}" />`;
        return html.replace(/<head>/i, `<head>\n${meta}`);
      }
    }
  };
}

/** Pull large dependencies out of the entry chunk. Workers stay on Vite's own graph. */
function vendorChunk(id: string): string | undefined {
  const norm = id.replace(/\\/g, '/');
  // Keep this out of the Monaco chunk. If it lands there, the entry statically
  // imports Monaco and the browser downloads the editor on startup.
  if (norm.includes('vite/preload-helper')) return 'preload-helper';
  if (norm.includes('?worker') || norm.includes('.worker')) return undefined;
  const match = norm.match(/\/node_modules\/((?:@[^/]+\/)?[^/]+)/);
  if (!match) return undefined;
  const name = match[1];
  // Language grammars are dynamic imports. Leave them as their own chunks.
  if (name === 'monaco-editor' && !norm.includes('/basic-languages/')) return 'monaco';
  if (name === '@monaco-editor/react') return 'monaco';
  if (name === 'lucide-react') return 'lucide';
  if (name === 'react' || name === 'react-dom' || name === 'scheduler') return 'react';
  return undefined;
}

export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
    productionCspPlugin()
  ],
  server: {
    port: 5173,
    strictPort: true
  },
  base: './',
  build: {
    rollupOptions: {
      output: {
        manualChunks: vendorChunk
      }
    }
  }
});
