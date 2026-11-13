/**
 * A green `tsc` / `vite build` still leaves a blank white page when index.html
 * has no visible body and Tailwind classes never reach the CSS.
 */

export function visibleHtmlText(html: string): string {
  return (html || '')
    .replace(/<script\b[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style\b[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Visible text inside `<body>` only. `<title>` shows in the tab, not on the page. */
export function visibleBodyText(html: string): string {
  const body = /<body\b[^>]*>([\s\S]*?)(?:<\/body>|$)/i.exec(html || '');
  return visibleHtmlText(body ? body[1] : (html || '').replace(/<head\b[\s\S]*?<\/head>/i, ' '));
}

/** A `<style>` block that paints the page itself (html, body, :root, #root or #app background). */
export function styleBlockPaintsPage(html: string): boolean {
  for (const m of (html || '').matchAll(/<style\b[^>]*>([\s\S]*?)<\/style>/gi)) {
    const css = m[1].replace(/\/\*[\s\S]*?\*\//g, ' ');
    for (const rule of css.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
      const selectors = rule[1].split(',').map(s => s.trim());
      if (!selectors.some(s => /^(?:html|body|:root|#root|#app)$/i.test(s))) continue;
      if (/(?:^|[;\s])background(?:-color|-image)?\s*:/i.test(rule[2])) return true;
    }
  }
  return false;
}

/** True when opening the file shows the browser's default white page. */
export function indexHtmlIsBlankShell(html: string): boolean {
  if (!html || !/<html[\s>]/i.test(html)) return false;
  if (/<(canvas|svg|img|video)\b/i.test(html)) return false;
  if (/style\s*=\s*["'][^"']*background/i.test(html)) return false;
  if (styleBlockPaintsPage(html)) return false;
  return visibleBodyText(html).length < 12;
}

/** An empty mount node (`#root` / `#app`) and no script at all: nothing can ever render into it. */
export function indexHtmlMissingMountScript(html: string): boolean {
  if (!html || !/<html[\s>]/i.test(html)) return false;
  if (!/<div\b[^>]*\bid\s*=\s*["'](?:root|app)["']/i.test(html)) return false;
  return !/<script\b/i.test(html);
}

export function usesTailwindClasses(source: string): boolean {
  return /className\s*=\s*["'`][^"'`]*(?:flex|grid|bg-|text-|rounded-|p-|m-|w-|h-)/.test(source || '');
}

export function tailwindCssIsWired(css: string): boolean {
  const text = css || '';
  if (/@tailwind\s+utilities/.test(text) || /@import\s+["']tailwindcss["']/.test(text)) return true;
  return /\.bg-slate-900\b/.test(text) || /\.flex\b/.test(text);
}

/** Files that decide whether the page renders and is styled. A later step that owns one owns the gate. */
const WEB_ENTRY_FILE =
  /^(?:index\.html|(?:src\/)?(?:index|styles?|globals?|app)\.css|postcss\.config\.[cm]?[jt]s|tailwind\.config\.[cm]?[jt]s)$/i;

export function isWebEntryFile(path: string): boolean {
  return WEB_ENTRY_FILE.test((path || '').replace(/\\/g, '/').replace(/^\.\//, ''));
}

/**
 * The blank-page / Tailwind gate belongs to the step that writes the entry files. A step that does
 * not touch any of them, while a later pending step does, must not fail on them.
 */
export function webEntryGateDeferred(currentStepFiles: string[], laterStepFiles: string[]): boolean {
  if ((currentStepFiles || []).some(isWebEntryFile)) return false;
  return (laterStepFiles || []).some(isWebEntryFile);
}

export interface WebEntryInput {
  delivery?: string | null;
  indexHtml?: string;
  css?: string;
  sourceSample?: string;
  /**
   * Build config the page depends on. Leave a field `undefined` to skip that check;
   * pass `''` when the file is missing.
   */
  postcssConfig?: { path: string; content: string } | null;
  tailwindConfig?: { path: string; content: string } | null;
  viteConfig?: string;
  packageJson?: string;
}

function tailwindConfigErrors(input: WebEntryInput): string[] {
  const css = input.css || '';
  const lines: string[] = [];
  const v4 = /@import\s+["']tailwindcss["']/.test(css);
  const v3 = /@tailwind\s+(?:base|components|utilities)/.test(css);
  if (!v3 && !v4) return lines;
  const pkg = input.packageJson;
  const vite = input.viteConfig;
  const postcss = input.postcssConfig;
  if (v4) {
    if (vite === undefined && postcss === undefined) return lines;
    const viaVite = /@tailwindcss\/vite/.test(vite || '');
    const viaPostcss = /@tailwindcss\/postcss/.test(postcss?.content || '');
    if (!viaVite && !viaPostcss) {
      lines.push(
        'vite.config.ts(1,1): error TS9002: src/index.css imports "tailwindcss" (v4), but neither vite.config.ts (@tailwindcss/vite plugin) nor a PostCSS config (@tailwindcss/postcss) loads Tailwind, so no utilities are generated and the page stays unstyled. Add the @tailwindcss/vite plugin to vite.config.ts and to devDependencies.'
      );
    }
    return lines;
  }
  if (postcss === undefined) return lines;
  const postcssPath = postcss?.path || 'postcss.config.js';
  if (!postcss?.content.trim()) {
    lines.push(
      `${postcssPath}(1,1): error TS9002: src/index.css uses @tailwind directives, but there is no PostCSS config, so Vite ships them unprocessed and every Tailwind class is unstyled. Create ${postcssPath} with plugins tailwindcss and autoprefixer${
        /"type"\s*:\s*"module"/.test(pkg || '') && /\.js$/.test(postcssPath) ? ' (package.json is "type": "module", so use `export default { plugins: { tailwindcss: {}, autoprefixer: {} } }`)' : ''
      }.`
    );
  } else if (!/tailwindcss/.test(postcss.content)) {
    lines.push(
      `${postcssPath}(1,1): error TS9002: ${postcssPath} does not load the tailwindcss plugin, so the @tailwind directives in src/index.css are never processed. Add tailwindcss (and autoprefixer) to its plugins.`
    );
  } else if (
    /\.js$/.test(postcssPath) &&
    /"type"\s*:\s*"module"/.test(pkg || '') &&
    /module\.exports/.test(postcss.content)
  ) {
    lines.push(
      `${postcssPath}(1,1): error TS9002: package.json is "type": "module", but ${postcssPath} uses module.exports, so Vite cannot load it. Use \`export default { plugins: { tailwindcss: {}, autoprefixer: {} } }\` or rename the file to postcss.config.cjs.`
    );
  }
  const tw = input.tailwindConfig;
  if (tw !== undefined) {
    const twPath = tw?.path || 'tailwind.config.js';
    if (!tw?.content.trim()) {
      lines.push(
        `${twPath}(1,1): error TS9002: Tailwind v3 needs ${twPath} with content globs (./index.html and ./src/**/*.{ts,tsx,js,jsx}); without it no utility classes are generated.`
      );
    } else if (!/\bcontent\s*:/.test(tw.content)) {
      lines.push(
        `${twPath}(1,1): error TS9002: ${twPath} has no content globs, so Tailwind generates no utilities. Add content: ['./index.html', './src/**/*.{ts,tsx,js,jsx}'].`
      );
    }
  }
  if (pkg !== undefined && pkg.trim() && !/"tailwindcss"\s*:/.test(pkg)) {
    lines.push(
      'package.json(1,1): error TS9002: src/index.css uses Tailwind, but package.json does not list tailwindcss (plus postcss and autoprefixer) in devDependencies.'
    );
  }
  return lines;
}

/**
 * Compiler-shaped lines so the existing verify/heal path treats a blank page as a failed build.
 * Returns '' when the delivery is not a web page or the entry looks viewable.
 */
export function webEntryVerifyErrors(input: WebEntryInput): string {
  if (input.delivery && input.delivery !== 'web') return '';
  if (!input.indexHtml) return '';
  const lines: string[] = [];
  if (indexHtmlMissingMountScript(input.indexHtml)) {
    lines.push(
      'index.html(1,1): error TS9003: index.html has a mount element (#root/#app) but no <script>, so the app never starts. Add <script type="module" src="/src/main.tsx"></script> before </body>.'
    );
  } else if (indexHtmlIsBlankShell(input.indexHtml)) {
    lines.push(
      'index.html(1,1): error TS9001: index.html has no visible content, so opening it is a blank white page. Put a placeholder such as <div id="root">Loading…</div> inside the mount element (never beside it) so the app replaces it when it mounts, give <body> a background (a <style> rule or inline style), and open the page through the dev server (npm run dev), not from disk (file://).'
    );
  }
  const usesTw = usesTailwindClasses(input.sourceSample || '');
  if (usesTw && !tailwindCssIsWired(input.css || '')) {
    lines.push(
      'src/index.css(1,1): error TS9002: Components use Tailwind classes, but the stylesheet has no @tailwind utilities (and no generated utilities). The page stays unstyled. Add @tailwind base/components/utilities and a PostCSS config, or replace the classes with real CSS.'
    );
  } else if (usesTw) {
    lines.push(...tailwindConfigErrors(input));
  }
  return lines.join('\n');
}

/** How to open a Vite/web project. Opening index.html straight from disk never runs the module script. */
export function webRunHint(delivery: string | null | undefined, scripts: Record<string, unknown> | null | undefined): string {
  if (delivery && delivery !== 'web') return '';
  if (!scripts || typeof scripts.dev !== 'string') return '';
  return 'To play it, run `npm run dev` in the terminal and open the URL it prints; opening index.html directly will not start the app.';
}
