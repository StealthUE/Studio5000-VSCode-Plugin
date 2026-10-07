#!/usr/bin/env node
/**
 * cli.ts — Command-line lookups against an export folder, for AI tools and terminals.
 *
 *   node cli.js xref <exportDir> <Tag[.Member]> [--program <Program>]
 *       every rung / ST line that writes or reads the tag, with its text
 *       (locations: Program/Routine#12 = rung 12, Program/Routine#L13 = ST line 13)
 *   node cli.js rung <exportDir> <Program>/<Routine> <number | L<line>>
 *       one rung with its comment, or an ST line with context
 *   node cli.js preview <exportDir> <Program>/<Routine> <rung number> [--out <file.svg>]
 *       ladder preview image (SVG) of that rung: comment, diagram, and the neutral text
 *   node cli.js preview --text <neutral text> [--comment <text>] [--out <file.svg>]
 *       the same image for a rung that is not in the file yet
 *
 * xref and rung only read _model.json. preview writes one SVG.
 */

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { Controller, Routine } from './model';
import { buildCrossRef, readModel, xrefLoc } from './export/exporter';
import { buildAoiIndex } from './export/aoiIndex';
import { isStRoutine, routineUnits } from './export/logicUnits';
import { renderRungSvg } from './export/rungPreview';

// Output piped into something that stops reading early (`| head`, an agent's pager) closes
// stdout; that is a normal end, not an error.
process.stdout.on('error', (err: NodeJS.ErrnoException) => {
  if (err.code === 'EPIPE') process.exit(0);
  throw err;
});

function fail(msg: string): never {
  process.stderr.write(msg + '\n');
  process.exit(2);
}

function load(dir: string): Controller {
  const c = readModel(path.resolve(dir));
  if (!c) fail(`No _model.json in ${dir}: pass the export folder (the one containing CODEBASE.md).`);
  return c;
}

function routineAt(c: Controller, where: string): Routine | undefined {
  const [owner, routine] = [where.slice(0, where.lastIndexOf('/')), where.slice(where.lastIndexOf('/') + 1)];
  if (owner.startsWith('AOI ')) return c.aois.find(a => a.name === owner.slice(4))?.routines.find(r => r.name === routine);
  return c.programs.find(p => p.name === owner)?.routines.find(r => r.name === routine);
}

/** Rung text, or the ST source line (n = 0-based line index). */
function rungLine(c: Controller, where: string, n: number): string {
  const r = routineAt(c, where);
  if (r && isStRoutine(r)) return r.lines![n]?.trim() ?? '(line not found)';
  const g = r?.rungs.find(x => x.number === n);
  return g ? g.text : '(rung not found)';
}

/** Same path, or one is a member / element of the other. Case-insensitive; indexes as wildcards. */
function overlaps(a: string, b: string): boolean {
  const norm = (s: string) => s.replace(/\s+/g, '').replace(/\[[^\]]*\]/g, '[*]').toLowerCase();
  const x = norm(a);
  const y = norm(b);
  if (x === y) return true;
  const [s, l] = x.length < y.length ? [x, y] : [y, x];
  return l.startsWith(s) && (l[s.length] === '.' || l[s.length] === '[');
}

/** Data type of `.Member.Sub[3]` inside a tag of type `type`, through UDT members and AOI parameters. */
function memberType(c: Controller, type: string, path: string): string | undefined {
  let t = type;
  for (const part of path.replace(/\[[^\]]*\]/g, '').split('.').filter(Boolean)) {
    if (/^\d+$/.test(part)) return 'BOOL';
    const members = c.dataTypes.find(d => d.name.toLowerCase() === t.toLowerCase())?.members
      ?? c.aois.find(a => a.name.toLowerCase() === t.toLowerCase())?.parameters;
    const m = members?.find(x => x.name.toLowerCase() === part.toLowerCase());
    if (!m) return undefined;
    t = m.dataType + (m.dimensions?.length ? `[${m.dimensions.join(',')}]` : '');
    t = t.replace(/\[.*$/, '');
  }
  return t;
}

function xref(dir: string, query: string, program?: string): void {
  const c = load(dir);
  const base = query.split(/[.[]/)[0]!;
  const prog = c.programs.find(p => p.name.toLowerCase() === program?.toLowerCase());
  const local = prog?.tags.find(t => t.name.toLowerCase() === base.toLowerCase());
  const ctl = [...c.tags, ...(c.moduleTags ?? [])].find(t => t.name.toLowerCase() === base.toLowerCase());
  const aois = buildAoiIndex(c);
  const x = buildCrossRef(c, aois);
  const candidates = [...x.refs.keys()].filter(k => k.slice(k.lastIndexOf('/') + 1).toLowerCase() === base.toLowerCase());
  const scopeKey = local ? `${prog!.name}/${local.name}` : ctl ? `/${ctl.name}` : candidates[0];
  const tag = local ?? ctl;
  const member = query.length > base.length ? query.replace(/\s+/g, '') : undefined;
  if (tag) {
    const scope = local ? `program ${prog!.name}` : 'controller';
    if (member) {
      const type = memberType(c, tag.dataType, member.slice(base.length));
      process.stdout.write(`${member} : ${type ?? '?'} — member of ${tag.name} : ${tag.dataType} (${scope} scope)\n`);
    } else {
      process.stdout.write(`${tag.name} : ${tag.dataType}${tag.dimensions ? `[${tag.dimensions.join(',')}]` : ''} (${scope} scope)\n`);
    }
    if (tag.description) process.stdout.write(`  ${tag.description.replace(/\n/g, ' ')}\n`);
  }
  const e = scopeKey ? x.refs.get(scopeKey) : undefined;
  if (!e) {
    process.stdout.write(`${query}: not referenced by any rung or ST line${candidates.length > 1 ? ` (also in: ${candidates.join(', ')})` : ''}.\n`);
    return;
  }
  // With a member, keep only uses of that member, a member inside it, or the whole structure
  // containing it (a COP of the whole tag reads and writes the member too).
  const matches = (op: string) => !member || overlaps(op, member);
  if (member) process.stdout.write(`(showing uses of ${member}, its members, and whole-structure uses that include it)\n`);
  process.stdout.write('\nWRITES\n');
  for (const [k, rungs] of e.writes) {
    const [where, ins, op] = k.split('\u0000') as [string, string, string];
    if (!matches(op)) continue;
    for (const n of rungs) process.stdout.write(`  ${xrefLoc(x, where, n)}  ${ins} ${op}\n      ${rungLine(c, where, n)}\n`);
  }
  process.stdout.write('\nREADS\n');
  for (const [where, rungs] of e.reads) {
    const r = routineAt(c, where);
    const units = member && r ? new Map(routineUnits(r, aois).map(u => [u.n, u])) : undefined;
    for (const n of rungs) {
      if (units) {
        const reads = (units.get(n)?.uses ?? []).filter(u => !u.write && u.base.toLowerCase() === base.toLowerCase());
        if (!reads.some(u => matches(u.operand))) continue;
      }
      process.stdout.write(`  ${xrefLoc(x, where, n)}\n      ${rungLine(c, where, n)}\n`);
    }
  }
  if (candidates.length > 1) process.stdout.write(`\nSame name in other scopes: ${candidates.filter(k => k !== scopeKey).join(', ')}\n`);
}

function rung(dir: string, where: string, n: string): void {
  const c = load(dir);
  const r = routineAt(c, where);
  if (!r) fail(`Routine ${where} not found (use Program/Routine or "AOI Name/Routine").`);
  if (isStRoutine(r)) {
    // ST: "L13" or "13" is the 1-based line; print a few lines of context around it.
    const line = Number(n.replace(/^#?L/i, ''));
    const lines = r.lines!;
    if (!Number.isInteger(line) || line < 1 || line > lines.length) fail(`${where} has ${lines.length} lines; line ${n} does not exist.`);
    for (let i = Math.max(1, line - 3); i <= Math.min(lines.length, line + 3); i++) {
      process.stdout.write(`${i === line ? '>' : ' '}${String(i).padStart(5)}  ${lines[i - 1]}\n`);
    }
    return;
  }
  const g = r.rungs.find(x => x.number === Number(n.replace(/^#/, '')));
  if (!g) fail(`${where} has ${r.rungs.length} rungs; #${n} does not exist.`);
  if (g.comment) process.stdout.write(g.comment.split('\n').map(l => `// ${l}`).join('\n') + '\n');
  process.stdout.write(g.text + '\n');
}

const USAGE = [
  'usage:',
  '  cli.js xref <exportDir> <Tag[.Member]> [--program <Program>]',
  '  cli.js rung <exportDir> <Program>/<Routine> <number | L<line>>',
  '  cli.js preview <exportDir> <Program>/<Routine> <rung number> [--out <file.svg>]',
  '  cli.js preview --text <neutral text> [--comment <text>] [--out <file.svg>]',
].join('\n');

function takeFlag(rest: string[], name: string): string | undefined {
  const i = rest.indexOf(name);
  if (i < 0) return undefined;
  if (i + 1 >= rest.length || rest[i + 1]!.startsWith('--')) fail(`${name} needs a value.`);
  const v = rest[i + 1]!;
  rest.splice(i, 2);
  return v;
}

function writeSvg(file: string, text: string, comment?: string, where?: string): void {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, renderRungSvg(text, { comment, where }), 'utf8');
  process.stdout.write(path.resolve(file) + '\n');
}

function preview(args: string[]): void {
  const text = takeFlag(args, '--text');
  const comment = takeFlag(args, '--comment');
  const out = takeFlag(args, '--out');
  if (text !== undefined) {
    if (!text.trim()) fail('preview --text needs the rung neutral text.');
    writeSvg(out ?? path.join(os.tmpdir(), 'vs-studio5000', 'rung-preview.svg'), text, comment);
    return;
  }
  const [dir, where, n] = args;
  if (!dir || !where || n === undefined) fail(USAGE);
  const c = load(dir);
  const r = routineAt(c, where);
  if (!r) fail(`Routine ${where} not found (use Program/Routine or "AOI Name/Routine").`);
  if (isStRoutine(r)) fail(`${where} is Structured Text. A ladder preview is only for a rung; show the source.`);
  const num = Number(n.replace(/^#/, ''));
  const g = r.rungs.find(x => x.number === num);
  if (!g) fail(`${where} has ${r.rungs.length} rungs; #${n} does not exist.`);
  const safe = where.replace(/[<>:"/\\|?*\u0000-\u001f]/g, '_').replace(/\s+/g, '_');
  const file = out ?? path.join(path.resolve(dir), 'previews', `${safe}__r${g.number}.svg`);
  writeSvg(file, g.text, g.comment, `${where}  rung ${g.number}`);
}

function main(argv: string[]): void {
  const [cmd, ...tail] = argv;
  if (cmd === 'preview') { preview(tail); return; }
  const [dir, ...rest] = tail;
  const flag = (name: string) => takeFlag(rest, name);
  if (cmd === 'xref' && dir && rest[0]) {
    const program = flag('--program');
    xref(dir, rest[0], program);
  } else if (cmd === 'rung' && dir && rest[0] && rest[1]) {
    rung(dir, rest[0], rest[1]);
  } else {
    fail(USAGE);
  }
}

main(process.argv.slice(2));
