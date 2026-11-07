/**
 * Whole-project review helpers — enumerate sources + prefer compiler signal.
 */

const SKIP_DIR = new Set([
  'node_modules',
  '.git',
  '.localagents',
  'dist',
  'build',
  'release',
  'out',
  '.vite'
]);

const SOURCE_EXT = /\.(tsx?|jsx?|py|go|rs|cpp|cxx|cc|hpp|h|cs|css|html|json)$/i;

export function shouldScanPath(relPath: string): boolean {
  const parts = relPath.replace(/\\/g, '/').split('/');
  if (parts.some(p => SKIP_DIR.has(p))) return false;
  const base = parts[parts.length - 1] || '';
  if (base === 'package-lock.json' || base === 'yarn.lock') return false;
  return SOURCE_EXT.test(base);
}

export interface ProjectReviewBrief {
  fileCount: number;
  samplePaths: string[];
  verifyHint: string;
}

export function buildProjectReviewBrief(
  relativePaths: string[],
  opts?: { verifyOutput?: string; stack?: string }
): ProjectReviewBrief {
  const scanned = relativePaths.filter(shouldScanPath);
  return {
    fileCount: scanned.length,
    samplePaths: scanned.slice(0, 40),
    verifyHint: opts?.verifyOutput
      ? `Compiler/verify output (${opts.stack || 'project'}):\n${opts.verifyOutput.slice(0, 4000)}`
      : 'No verify output yet — run tsc / npm run build / stack verify first.'
  };
}

export function formatProjectReviewPrompt(brief: ProjectReviewBrief, userGoal: string): string {
  return `## Project compatibility review

User goal: ${userGoal}

Workspace source files (${brief.fileCount} scanned; listing up to 40):
${brief.samplePaths.map(p => `- ${p}`).join('\n') || '(none)'}

${brief.verifyHint}

Check: duplicate parallel modules, import/type disagreements, broken entry (index.html → main → App), planner prose in sources, and whether the goal features are actually implemented.
Emit a short <review_plan> of concrete fix tasks (file + change). Do not write files.`;
}
