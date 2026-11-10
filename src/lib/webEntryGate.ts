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

/** True when opening the file shows the browser's default white page. */
export function indexHtmlIsBlankShell(html: string): boolean {
  if (!html || !/<html[\s>]/i.test(html)) return false;
  if (/<(canvas|svg|img|video)\b/i.test(html)) return false;
  if (/style\s*=\s*["'][^"']*background/i.test(html)) return false;
  return visibleHtmlText(html).length < 40;
}

export function usesTailwindClasses(source: string): boolean {
  return /className\s*=\s*["'`][^"'`]*(?:flex|grid|bg-|text-|rounded-|p-|m-|w-|h-)/.test(source || '');
}

export function tailwindCssIsWired(css: string): boolean {
  const text = css || '';
  if (/@tailwind\s+utilities/.test(text)) return true;
  if (/\.bg-slate-900\b/.test(text) || /\.flex\b/.test(text)) return true;
  return text.length > 2500;
}

export interface WebEntryInput {
  delivery?: string | null;
  indexHtml?: string;
  css?: string;
  sourceSample?: string;
}

/**
 * Compiler-shaped lines so the existing verify/heal path treats a blank page as a failed build.
 * Returns '' when the delivery is not a web page or the entry looks viewable.
 */
export function webEntryVerifyErrors(input: WebEntryInput): string {
  if (input.delivery && input.delivery !== 'web') return '';
  if (!input.indexHtml) return '';
  const lines: string[] = [];
  if (indexHtmlIsBlankShell(input.indexHtml)) {
    lines.push(
      'index.html(1,1): error TS9001: index.html has no visible content, so opening it is a blank white page. Put a background and a readable title in the document itself, and make sure the script that mounts the app actually runs.'
    );
  }
  if (usesTailwindClasses(input.sourceSample || '') && !tailwindCssIsWired(input.css || '')) {
    lines.push(
      'src/index.css(1,1): error TS9002: Components use Tailwind classes, but the stylesheet has no @tailwind utilities (and no generated utilities). The page stays unstyled. Add @tailwind base/components/utilities and a PostCSS config, or replace the classes with real CSS.'
    );
  }
  return lines.join('\n');
}
