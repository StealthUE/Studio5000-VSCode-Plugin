/**
 * rungPreview.ts — Draw one ladder rung as an SVG image.
 *
 * The picture is laid out from the same parse as the neutral text. If the text does not
 * round-trip through that parse, the image shows the text only: a wrong diagram is worse
 * than none. `?` operands (preset/accum placeholders) are left off the symbols; the footer
 * still shows the neutral text in full.
 */

import { Element, Instruction, canonicalRung, parseRung, seriesText } from './rungText';

const ROW = 64;
const WIRE_Y = 36;
const INK = '#1c1c1c';
const MUTED = '#3d4c63';
const FONT = 'Segoe UI, Arial, sans-serif';
const MONO = "Consolas, 'Courier New', monospace";

export interface RungPreviewOptions {
  /** Rung comment, drawn above the ladder. */
  comment?: string;
  /** Where the rung lives, e.g. `Program/Routine  rung 3`. */
  where?: string;
}

interface Glyph {
  w: number;
  h: number;
  /** Wire y relative to the top of this glyph. */
  yWire: number;
  /** Lowest wire y relative to the top (a branch's last leg). */
  yLow: number;
  draw: (x: number, y: number, out: string[]) => void;
}

function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function hline(x1: number, x2: number, y: number): string {
  return `<line x1="${x1}" y1="${y}" x2="${x2}" y2="${y}"/>`;
}

function vline(x: number, y1: number, y2: number): string {
  return `<line x1="${x}" y1="${y1}" x2="${x}" y2="${y2}"/>`;
}

function textWidth(s: string, px: number): number {
  return Math.ceil(s.length * px * 0.56);
}

function wrap(text: string, maxChars: number): string[] {
  const lines: string[] = [];
  for (const para of text.split(/\r?\n/)) {
    let rest = para.trim();
    if (!rest) { lines.push(''); continue; }
    while (rest.length > maxChars) {
      let cut = rest.lastIndexOf(' ', maxChars);
      if (cut < Math.floor(maxChars * 0.6)) cut = maxChars;
      lines.push(rest.slice(0, cut));
      rest = rest.slice(cut).trimStart();
    }
    lines.push(rest);
  }
  return lines;
}

function mnemonic(ins: Instruction): string {
  const i = ins.text.indexOf('(');
  return (i > 0 ? ins.text.slice(0, i) : ins.name).trim();
}

function wire(w: number): Glyph {
  return {
    w, h: ROW, yWire: WIRE_Y, yLow: WIRE_Y,
    draw(x, y, out) { out.push(hline(x, x + w, y + WIRE_Y)); },
  };
}

function label(x: number, y: number, s: string, size: number, weight: string, fill: string, anchor = 'middle'): string {
  return `<text x="${x}" y="${y}" text-anchor="${anchor}" font-family="${FONT}" font-size="${size}" font-weight="${weight}" fill="${fill}" stroke="none">${esc(s)}</text>`;
}

function instructionGlyph(ins: Instruction): Glyph {
  const operands = ins.operands.filter(o => o !== '?');
  const name = mnemonic(ins);
  if (name.toUpperCase() === 'XIC' || name.toUpperCase() === 'XIO') {
    const tag = operands[0] || name;
    const w = Math.max(84, textWidth(tag, 12) + 20);
    const nc = name.toUpperCase() === 'XIO';
    return {
      w, h: ROW, yWire: WIRE_Y, yLow: WIRE_Y,
      draw(x, y, out) {
        const cy = y + WIRE_Y;
        const mid = x + Math.round(w / 2);
        out.push(hline(x, mid - 8, cy));
        out.push(vline(mid - 8, cy - 12, cy + 12));
        out.push(vline(mid + 8, cy - 12, cy + 12));
        if (nc) out.push(`<line x1="${mid - 8}" y1="${cy + 12}" x2="${mid + 8}" y2="${cy - 12}" data-xio="1"/>`);
        out.push(hline(mid + 8, x + w, cy));
        out.push(label(mid, cy - 18, tag, 12, '400', MUTED));
      },
    };
  }
  if (name.toUpperCase() === 'OTE' || name.toUpperCase() === 'OTL' || name.toUpperCase() === 'OTU') {
    const tag = operands[0] || name;
    const w = Math.max(92, textWidth(tag, 12) + 28);
    const mark = name.toUpperCase() === 'OTL' ? 'L' : name.toUpperCase() === 'OTU' ? 'U' : '';
    return {
      w, h: ROW, yWire: WIRE_Y, yLow: WIRE_Y,
      draw(x, y, out) {
        const cy = y + WIRE_Y;
        const cx = x + Math.round(w / 2);
        out.push(hline(x, cx - 14, cy));
        out.push(`<circle cx="${cx}" cy="${cy}" r="14" fill="#fff" stroke="${INK}" stroke-width="1.6"/>`);
        if (mark) out.push(label(cx, cy + 4, mark, 12, '600', INK));
        out.push(hline(cx + 14, x + w, cy));
        out.push(label(cx, cy - 20, tag, 12, '400', MUTED));
      },
    };
  }
  const lines = [name, ...operands].slice(0, 5);
  if (operands.length > 4) lines.push('…');
  const w = Math.max(112, ...lines.map(l => textWidth(l, 12) + 28));
  const inner = lines.length * 15 + 14;
  const h = Math.max(ROW, inner + 8);
  const yWire = Math.round(h / 2);
  return {
    w, h, yWire, yLow: yWire,
    draw(x, y, out) {
      const cy = y + yWire;
      out.push(hline(x, x + 8, cy));
      out.push(`<rect x="${x + 8}" y="${y + 4}" width="${w - 16}" height="${h - 8}" rx="3" fill="#fff" stroke="${INK}" stroke-width="1.4"/>`);
      const first = cy - ((lines.length - 1) * 15) / 2 + 4;
      lines.forEach((l, i) => out.push(label(x + Math.round(w / 2), first + i * 15, l, i === 0 ? 12 : 11, i === 0 ? '600' : '400', INK)));
      out.push(hline(x + w - 8, x + w, cy));
    },
  };
}

function seriesGlyph(series: Element[]): Glyph {
  if (!series.length) return wire(36);
  const kids = series.map(glyphOf);
  const yWire = Math.max(...kids.map(k => k.yWire));
  const yLow = Math.max(...kids.map(k => (yWire - k.yWire) + k.yLow));
  const h = Math.max(yLow + 24, ...kids.map(k => (yWire - k.yWire) + k.h));
  const w = kids.reduce((a, k) => a + k.w, 0);
  return {
    w, h, yWire, yLow,
    draw(x, y, out) {
      let cx = x;
      for (const k of kids) {
        k.draw(cx, y + (yWire - k.yWire), out);
        cx += k.w;
      }
    },
  };
}

function glyphOf(e: Element): Glyph {
  return e.kind === 'ins' ? instructionGlyph(e.ins) : branchGlyph(e.legs);
}

function branchGlyph(legs: Element[][]): Glyph {
  const nodes = (legs.length ? legs : [[]]).map(seriesGlyph);
  const inner = Math.max(...nodes.map(n => n.w), 24);
  const w = inner + 28;
  const yWire = nodes[0]!.yWire;
  let acc = 0;
  let yLow = yWire;
  for (const n of nodes) {
    yLow = acc + n.yLow;
    acc += n.h;
  }
  const h = Math.max(acc, yLow + 24);
  return {
    w, h, yWire, yLow,
    draw(x, y, out) {
      const mids: number[] = [];
      let cy = y;
      for (const n of nodes) {
        const mid = cy + n.yWire;
        mids.push(mid);
        out.push(hline(x, x + 14, mid));
        n.draw(x + 14, cy, out);
        out.push(hline(x + 14 + n.w, x + 14 + inner, mid));
        out.push(hline(x + 14 + inner, x + w, mid));
        cy += n.h;
      }
      const top = mids[0]!;
      const bot = mids[mids.length - 1]!;
      if (bot !== top) {
        out.push(vline(x + 14, top, bot));
        out.push(vline(x + 14 + inner, top, bot));
      }
    },
  };
}

/** Tree when the text round-trips; otherwise undefined so the caller does not draw a partial rung. */
function safeTree(text: string): Element[] | undefined {
  const t = text.trim();
  if (!t) return [];
  const tree = parseRung(t);
  const rebuilt = seriesText(tree) + ';';
  const orig = t.endsWith(';') ? t : `${t};`;
  return canonicalRung(rebuilt) === canonicalRung(orig) ? tree : undefined;
}

function document(width: number, height: number, body: string[]): string {
  return [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">`,
    `<rect width="${width}" height="${height}" fill="#f7f8fa"/>`,
    `<g stroke="${INK}" stroke-width="1.6" stroke-linecap="square">`,
    ...body,
    '</g>',
    '</svg>',
    '',
  ].join('\n');
}

function textBlock(lines: string[], x: number, y: number, size: number, fill: string, weight: string, mono: boolean): string[] {
  const family = mono ? MONO : FONT;
  return lines.map((l, i) =>
    `<text x="${x}" y="${y + i * (size + 4)}" font-family="${family}" font-size="${size}" font-weight="${weight}" fill="${fill}" stroke="none">${esc(l)}</text>`);
}

/** Ladder preview of one rung. The footer repeats the neutral text the editor already shows. */
export function renderRungSvg(text: string, opts: RungPreviewOptions = {}): string {
  const raw = text.trim();
  const tree = safeTree(raw);
  const margin = 16;
  const minWidth = 480;
  const body = tree ? (tree.length ? seriesGlyph(tree) : wire(48)) : undefined;
  const sheet = Math.max(minWidth, margin + 28 + (body ? body.w : 360) + margin);
  const chars = Math.max(48, Math.floor((sheet - 32) / 7.1));
  const where = opts.where?.trim() ? wrap(opts.where.trim(), chars) : [];
  const comment = opts.comment?.trim() ? wrap(opts.comment.trim(), chars) : [];
  const footer = wrap(raw || '(empty rung)', chars);
  const note = tree ? [] : ['This rung could not be drawn. The neutral text is unchanged.'];

  const headerH = (where.length ? where.length * 18 + 4 : 0) + (comment.length ? comment.length * 18 + 6 : 0) + (note.length ? 20 : 0);
  const ladderH = body ? body.h : 8;
  const footerH = 18 + footer.length * 16;
  const width = sheet;
  const height = margin + headerH + ladderH + 14 + footerH + margin;

  const parts: string[] = [];
  let y = margin + 14;
  parts.push(...textBlock(where, margin, y, 12, '#5c6b7a', '600', false));
  y += where.length ? where.length * 18 + 4 : 0;
  parts.push(...textBlock(comment, margin, y, 13, INK, '600', false));
  y += comment.length ? comment.length * 18 + 6 : 0;
  parts.push(...textBlock(note, margin, y, 12, '#8a4b08', '600', false));
  y += note.length ? 20 : 0;

  const ladderTop = y;
  if (body) {
    const railIn = 12;
    const left = margin + 16;
    const yIn = ladderTop + body.yWire;
    const yLow = ladderTop + body.yLow;
    const railX1 = margin + 4;
    const railX2 = width - margin - 4;
    const railTop = Math.min(yIn, yLow) - railIn;
    const railBot = Math.max(yIn, yLow) + railIn;
    parts.push(`<line x1="${railX1}" y1="${railTop}" x2="${railX1}" y2="${railBot}" stroke-width="3"/>`);
    parts.push(`<line x1="${railX2}" y1="${railTop}" x2="${railX2}" y2="${railBot}" stroke-width="3"/>`);
    parts.push(hline(railX1, left, yIn));
    body.draw(left, ladderTop, parts);
    parts.push(hline(left + body.w, railX2, yIn));
  }

  const footY = ladderTop + ladderH + 22;
  parts.push(`<line x1="${margin}" y1="${footY - 14}" x2="${width - margin}" y2="${footY - 14}" stroke="#d5dbe3" stroke-width="1"/>`);
  parts.push(...textBlock(footer, margin, footY, 12, '#243044', '400', true));
  return document(width, height, parts);
}
