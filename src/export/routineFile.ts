/**
 * routineFile.ts — The editable text form of a routine (.rll for ladder, .st for
 * structured text), and the parser that reads an edited file back.
 *
 * .rll layout:
 *
 *   // @program MainProgram
 *   // @routine _030_Mode
 *   // @type RLL
 *   // @description A routine to control the mode of the area
 *
 *   // ---- Rung 0 ----
 *   // > Rung comment line 1
 *   // > Rung comment line 2
 *   XIC(Start)OTE(Motor);
 *
 * Rules the parser applies (and the AI guide documents):
 *   - `// @key value` lines are metadata; only the first block is read.
 *   - `// > text` lines are the comment of the NEXT rung.
 *   - any other `//` line is ignored (rung markers are regenerated, numbers are not trusted).
 *   - every other line is rung text; a rung ends at `;` and may span several lines.
 *     Long rungs with branches are written one branch leg per line:
 *
 *       XIC(Auto)
 *       [XIC(Start)
 *       ,XIC(Seal)
 *       ]XIO(Stop) OTE(Run);
 *
 *     Whitespace between elements is not significant (see canonicalRung).
 */

import { Routine, Rung } from '../model';
import { formatRungLines } from './rungText';

export const RLL_EXT = '.rll';
export const ST_EXT = '.st';

export interface RoutineHeader {
  program?: string;
  aoi?: string;
  routine: string;
  type: string;
  description?: string;
  undecoded?: string;
}

function metaLines(h: RoutineHeader): string[] {
  const out: string[] = [];
  if (h.aoi) out.push(`// @aoi ${h.aoi}`);
  if (h.program) out.push(`// @program ${h.program}`);
  out.push(`// @routine ${h.routine}`);
  out.push(`// @type ${h.type}`);
  if (h.description) {
    for (const line of h.description.split('\n')) out.push(`// @description ${line}`);
  }
  if (h.undecoded) out.push(`// @undecoded ${h.undecoded}`);
  return out;
}

export function formatRoutine(owner: { program?: string; aoi?: string }, r: Routine): string {
  const header = metaLines({ ...owner, routine: r.name, type: r.type, description: r.description, undecoded: r.undecoded });
  const body: string[] = [];
  if (r.type === 'RLL') {
    for (const rung of r.rungs) {
      body.push('', `// ---- Rung ${rung.number} ----`);
      if (rung.comment) for (const c of rung.comment.split('\n')) body.push(c ? `// > ${c}` : '// >');
      if (rung.text) body.push(...formatRungLines(rung.text));
      else body.push('// (rung text not stored in the project file)');
    }
  } else if (r.lines) {
    body.push('', ...r.lines);
  }
  return [...header, ...body, ''].join('\n');
}

export interface ParsedRoutineFile {
  header: RoutineHeader;
  rungs: Rung[];
  lines?: string[];
  /** Problems found while parsing: unterminated rung, etc. */
  problems: string[];
}

/** A ladder rung plus the lines it occupies in the `.rll` file. Lines are 0-based. */
export interface LocatedRung extends Rung {
  /** Marker, comment, or first instruction, whichever comes first. */
  startLine: number;
  /** The line that ends the rung, or the last line of an unterminated one. */
  endLine: number;
}

interface LocatedFile extends ParsedRoutineFile {
  /** Closed rungs only, in file order. An unterminated tail is `open`, not one of these. */
  rungs: LocatedRung[];
  open?: LocatedRung;
}

function stripLocation(g: LocatedRung): Rung {
  const rung: Rung = { number: g.number, text: g.text };
  if (g.comment !== undefined) rung.comment = g.comment;
  return rung;
}

/** Same read as `parseRoutineFile`, keeping the source line of each rung. */
function parseLocated(text: string): LocatedFile {
  const header: RoutineHeader = { routine: '', type: 'RLL' };
  const problems: string[] = [];
  const descr: string[] = [];
  const src = text.replace(/\r\n/g, '\n').split('\n');
  let i = 0;
  // Metadata block: leading `// @` lines (blank lines allowed before the first).
  for (; i < src.length; i++) {
    if (src[i]!.trim() === '') { if (header.routine) break; continue; }
    const m = /^\/\/\s*@(\w+)\s?(.*)$/.exec(src[i]!.trimStart());
    if (!m) break;
    const key = m[1]!.toLowerCase();
    const val = m[2] ?? '';
    if (key === 'program') header.program = val.trim();
    else if (key === 'aoi') header.aoi = val.trim();
    else if (key === 'routine') header.routine = val.trim();
    else if (key === 'type') header.type = val.trim().toUpperCase();
    else if (key === 'description') descr.push(val);
    else if (key === 'undecoded') header.undecoded = val;
  }
  if (descr.length) header.description = descr.join('\n');
  if (!header.routine) problems.push('Missing "// @routine <name>" header line.');

  if (header.type !== 'RLL') {
    // ST keeps every remaining line verbatim, minus the single blank separator.
    const rest = src.slice(i);
    while (rest.length && rest[0]!.trim() === '') rest.shift();
    while (rest.length && rest[rest.length - 1]!.trim() === '') rest.pop();
    return { header, rungs: [], lines: rest, problems };
  }

  const rungs: LocatedRung[] = [];
  let comment: string[] = [];
  let pending = '';
  let start = -1;
  const begin = (line: number) => { if (start < 0) start = line; };
  for (; i < src.length; i++) {
    const raw = src[i]!;
    const l = raw.trim();
    if (l === '') continue;
    // Comment text keeps its trailing whitespace: it is part of the rung comment.
    const cm = /^\/\/\s?>\s?(.*)$/.exec(raw.trimStart());
    if (cm) {
      if (pending) problems.push(`Line ${i + 1}: comment found inside an unterminated rung.`);
      begin(i);
      comment.push(cm[1] ?? '');
      continue;
    }
    if (l.startsWith('//')) { begin(i); continue; }
    begin(i);
    pending += (pending ? ' ' : '') + l;
    if (l.endsWith(';')) {
      const rung: LocatedRung = { number: rungs.length, text: pending, startLine: start, endLine: i };
      if (comment.length) rung.comment = comment.join('\n');
      rungs.push(rung);
      pending = '';
      comment = [];
      start = -1;
    }
  }
  let open: LocatedRung | undefined;
  if (pending) {
    problems.push(`Last rung is missing its terminating ";": ${pending.slice(0, 80)}`);
    open = { number: rungs.length, text: pending, startLine: start, endLine: src.length - 1 };
    if (comment.length) open.comment = comment.join('\n');
  }
  return { header, rungs, open, problems };
}

export function parseRoutineFile(text: string): ParsedRoutineFile {
  const file = parseLocated(text);
  return { header: file.header, rungs: file.rungs.map(stripLocation), lines: file.lines, problems: file.problems };
}

export type RungAtLine =
  | { header: RoutineHeader; rung: LocatedRung }
  | { header: RoutineHeader; rung?: undefined; reason: 'st' | 'header' | 'none' };

/**
 * The rung at a cursor line in a routine file. `line` is 0-based, as in a text editor.
 * A marker or `// >` comment belongs to the rung under it. A blank line between rungs
 * belongs to the nearer one, and to the earlier one when the two are the same distance.
 * `// @` header lines are not a rung.
 */
export function rungAtLine(text: string, line: number): RungAtLine {
  const file = parseLocated(text);
  if (file.header.type !== 'RLL') return { header: file.header, reason: 'st' };
  const src = text.replace(/\r\n/g, '\n').split('\n');
  if (/^\/\/\s*@/.test(src[line]?.trimStart() ?? '')) return { header: file.header, reason: 'header' };
  let best: LocatedRung | undefined;
  let bestDist = Infinity;
  for (const rung of file.open ? [...file.rungs, file.open] : file.rungs) {
    if (line >= rung.startLine && line <= rung.endLine) return { header: file.header, rung };
    const dist = line < rung.startLine ? rung.startLine - line : line - rung.endLine;
    if (dist < bestDist) { bestDist = dist; best = rung; }
  }
  return best ? { header: file.header, rung: best } : { header: file.header, reason: 'none' };
}
