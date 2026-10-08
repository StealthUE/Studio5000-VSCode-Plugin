/**
 * aiFiles.ts — Write the AI guide (CLAUDE.md, .clinerules, .cursorrules,
 * .github/copilot-instructions.md) into each workspace folder that holds projects, and the
 * Claude Code deny rules that keep the AI away from the binary .ACD.
 *
 * A guide file is only ever overwritten when it starts with our stamp, so a hand-written
 * CLAUDE.md is left alone (a warning is logged instead).
 */

import * as fs from 'fs';
import * as path from 'path';
import { ExportHealth } from './export/exporter';

export const GUIDE_STAMP = '<!-- vs-studio5000-guide';

export type AiTool = 'All' | 'Claude Code' | 'Cline' | 'Cursor' | 'GitHub Copilot' | 'None';

export interface ProjectEntry {
  file: string;
  exportDir: string;
  health: ExportHealth;
}

const TARGETS: Record<Exclude<AiTool, 'All' | 'None'>, string> = {
  'Claude Code': 'CLAUDE.md',
  'Cline': '.clinerules',
  'Cursor': '.cursorrules',
  'GitHub Copilot': path.join('.github', 'copilot-instructions.md'),
};

function projectTable(folder: string, projects: ProjectEntry[]): string {
  const rows = ['| Project file | Export folder (start with CODEBASE.md) | Export |', '|---|---|---|'];
  for (const p of projects) {
    const rel = path.relative(folder, p.file) || path.basename(p.file);
    rows.push(`| \`${rel.replace(/\\/g, '/')}\` | \`${p.exportDir}\` | ${p.health} |`);
  }
  return rows.join('\n');
}

export interface GuideFlags {
  /** When true, the assistant edits the export and the user imports the L5X. Default off: instructions only. */
  editFileGenerated?: boolean;
  /** In chat, show a rung as a ladder picture instead of its neutral text. Default on. */
  rungPreview?: boolean;
}

/** How every change names its place, in both modes. */
const WHERE_IT_GOES = [
  'Start every change with where it goes, by rung number:',
  '',
  '- **Change rung 12** of `Program/Routine`: rung 12 as it is now, then as it should be.',
  '- **Add a rung after rung 12** of `Program/Routine` (it becomes rung 13): the new rung.',
  '- **Delete rung 12** of `Program/Routine`: rung 12 as it is now, so the user can check it.',
  '- **Lines 40–42** of `Program/Routine` (Structured Text): the lines as they are now, then the new lines.',
  '',
  'Rungs are numbered from 0, as Studio 5000 shows them in the left margin. Take a rung number from',
  '`xref`, `rung` or the `// ---- Rung n ----` marker of an unedited file, never by counting rungs.',
  'Number every change from the routine as it is in the project, before any of your changes, and',
  'list a routine\'s changes from the highest rung or line number to the lowest: then making one',
  'change never moves a rung that a later change refers to.',
];

const FILE_STEPS = [
  '1. Edit the `.rll` / `.st` files in the export folder. Keep the `// @` header lines.',
  '2. Check tags exist (`TAGS.md`) and the instruction syntax matches existing logic. New tags must be',
  '   created by the user in Studio 5000, so list any you introduce.',
  '3. Ask the user to run **Studio 5000: Build L5X Import from Edits**. It validates each edited routine',
  '   (ladder: rung structure, instructions; ST: brackets, comments, IF/CASE/FOR/WHILE/REPEAT blocks;',
  '   both: tags and JSR targets) and writes `edits/<Program>__<Routine>.L5X` plus `edits/IMPORT_REPORT.md`.',
  '4. Re-exporting keeps edited files, so they are not lost if the project reloads.',
  '   **Studio 5000: Discard Edits** restores them.',
  '5. Tell the user every change you made, so they can check it in Studio 5000 after the import.',
  '   `IMPORT_REPORT.md` lists the numbers of the new and changed rungs as they are after the import.',
];

const NOT_PACKAGED = [
  'AOI logic cannot be packaged as a routine (the AOI definition is edited in Studio 5000), and',
  'FBD/SFC views and source-protected routines cannot be packaged. The report says so.',
];

/**
 * The "Making changes" section. `editFile` is `studio5000.editFileGenerated`.
 * On: edit the export and hand back an L5X to import. Off: instructions only.
 */
export function makingChangesGuide(editFile: boolean): string {
  if (!editFile) {
    return [
      '## Making changes',
      '',
      'Do not edit the export. Give the user each change to make themselves in Studio 5000.',
      '',
      ...WHERE_IT_GOES,
      '',
      'Each rung you show has its comment and its exact neutral text; Structured Text is shown as',
      'source. List any new tags they must create. Leave every file as it is.',
      '',
    ].join('\n');
  }
  return [
    '## Making changes',
    '',
    'Edit the export and give the user the file to import into Studio 5000.',
    '',
    ...FILE_STEPS,
    '',
    ...NOT_PACKAGED,
    '',
    'When you tell the user what you changed:',
    '',
    ...WHERE_IT_GOES,
    '',
  ].join('\n');
}

/** The "Rung previews" section. `enabled` is `studio5000.rungPreview`. */
export function rungPreviewGuide(enabled: boolean): string {
  if (!enabled) {
    return [
      '## Rung previews',
      '',
      'Rung preview is off (`studio5000.rungPreview`). The Preview Rung command is hidden. When you',
      'show a rung, show where it is (`Program/Routine` rung 12), its comment and its neutral text.',
      'Do not make a ladder image.',
      '',
    ].join('\n');
  }
  return [
    '## Rung previews',
    '',
    'Rung preview is on (`studio5000.rungPreview`). When you show one rung, or propose a change to',
    'one, show a ladder picture of that rung in the chat instead of its neutral text. The picture',
    'already contains the routine and rung number, the comment, the diagram and the neutral text. Do',
    'not draw the ladder yourself, and do not paste the neutral text as well. For a change, show the',
    'current picture and the proposed picture, and still write where the change goes in your text.',
    'A long list (a whole cross reference) stays text; preview the rung you are discussing.',
    'Structured Text has no ladder preview; keep showing the source.',
    '',
    'The picture is drawn from the rung text. The command prints the path of an SVG. Show that image.',
    '',
    '```',
    'node "{{CLI}}" preview "<export folder>" <Program>/<Routine> <rung number>',
    '```',
    '',
    'For the rung you are proposing, `--at` gives its number: it replaces that rung, or with `--insert`',
    'it is a new rung that takes that number (it goes in after the rung before it). The command checks',
    'the routine and the number against the project and refuses a rung that does not exist.',
    '',
    '```',
    'node "{{CLI}}" preview "<export folder>" --at "<Program>/<Routine>#<rung number>" [--insert] --text "<neutral text>" --comment "<rung comment>"',
    '```',
    '',
    'The same picture is **Studio 5000: Preview Rung** (the preview icon in the editor title of a',
    '`.rll` file, or right-click). That draws the rung at the cursor beside the editor, including',
    'text that is not saved yet.',
    '',
  ].join('\n');
}

/** Returns the files written; `skipped` collects hand-written files that were left alone. */
export function writeGuides(
  folder: string, projects: ProjectEntry[], template: string, tool: AiTool, skipped: string[], cliPath = 'cli.js',
  flags: GuideFlags = {},
): string[] {
  if (tool === 'None' || !projects.length) return [];
  const content = template
    .replace('{{PROJECT_TABLE}}', projectTable(folder, projects))
    .replace('{{MAKING_CHANGES}}', makingChangesGuide(flags.editFileGenerated === true))
    .replace('{{RUNG_PREVIEW}}', rungPreviewGuide(flags.rungPreview !== false))
    .replace(/\{\{CLI\}\}/g, cliPath.replace(/\\/g, '/'));
  const rels = tool === 'All' ? Object.values(TARGETS) : [TARGETS[tool]];
  const written: string[] = [];
  for (const rel of rels) {
    const full = path.join(folder, rel);
    let existing: string | undefined;
    try { existing = fs.readFileSync(full, 'utf8'); } catch { /* none yet */ }
    if (existing !== undefined && !existing.trimStart().startsWith(GUIDE_STAMP)) {
      skipped.push(full);
      continue;
    }
    if (existing === content) continue;
    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.writeFileSync(full, content, 'utf8');
    written.push(full);
  }
  return written;
}

const DENY = ['Read(**/*.ACD)', 'Read(**/*.acd)', 'Edit(**/*.ACD)', 'Edit(**/*.acd)', 'Edit(**/*.L5X)', 'Edit(**/*.l5x)'];

/** Merge deny rules into <folder>/.claude/settings.json. Returns true when the file changed. */
export function writeClaudeGuard(folder: string): boolean {
  const file = path.join(folder, '.claude', 'settings.json');
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let settings: any = {};
  if (fs.existsSync(file)) {
    try { settings = JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return false; }
  }
  const deny: string[] = settings?.permissions?.deny ?? [];
  const missing = DENY.filter(d => !deny.includes(d));
  if (!missing.length) return false;
  settings.permissions = settings.permissions ?? {};
  settings.permissions.deny = [...deny, ...missing];
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(settings, null, 2) + '\n', 'utf8');
  return true;
}
