/*
 * Where the draw tool puts things. Pure geometry: sizes from labels, a layered placement that
 * flows top-to-bottom or left-to-right, and the two points an edge runs between.
 */

export interface Box {
  x: number;
  y: number;
  width: number;
  height: number;
}

export type Direction = "TB" | "LR";

export const FONT_SIZE = 20;
const MIN_W = 120;
const MIN_H = 60;
const PAD_X = 40;
const PAD_Y = 30;
/** Between layers (a node and the one it comes from). */
export const RANK_GAP = 80;
/** Between neighbours in the same layer. */
export const SIBLING_GAP = 40;
/** Between what was drawn before and a new, unconnected node. */
export const COLUMN_GAP = 120;

// Hangul, CJK ideographs, kana, fullwidth forms: about one em wide. Latin is about 0.6 em.
const WIDE = /[ᄀ-ᅟ⺀-〾ぁ-㏿㐀-䶿一-鿿ꥠ-꥿가-힣豈-﫿︰-﹏＀-｠￠-￦]/;

export function textWidth(text: string, fontSize: number): number {
  let w = 0;
  for (const ch of text) w += WIDE.test(ch) ? fontSize : fontSize * 0.6;
  return w;
}

/** A shape big enough for its label; diamonds and ellipses lose their corners, so they get more room. */
export function shapeSize(label: string, shape: string, fontSize = FONT_SIZE): { width: number; height: number } {
  const lines = label.split("\n");
  const textW = Math.max(0, ...lines.map((l) => textWidth(l, fontSize)));
  const textH = lines.length * fontSize * 1.25;
  const grow = shape === "diamond" ? 1.6 : shape === "ellipse" ? 1.3 : 1;
  return {
    width: Math.ceil(Math.max(MIN_W, (textW + PAD_X) * grow)),
    height: Math.ceil(Math.max(MIN_H, (textH + PAD_Y) * grow)),
  };
}

export function bounds(boxes: readonly Box[]): Box | null {
  if (boxes.length === 0) return null;
  const x1 = Math.min(...boxes.map((b) => b.x));
  const y1 = Math.min(...boxes.map((b) => b.y));
  const x2 = Math.max(...boxes.map((b) => b.x + b.width));
  const y2 = Math.max(...boxes.map((b) => b.y + b.height));
  return { x: x1, y: y1, width: x2 - x1, height: y2 - y1 };
}

const overlaps = (a: Box, b: Box, gap: number) =>
  a.x < b.x + b.width + gap && b.x < a.x + a.width + gap && a.y < b.y + b.height + gap && b.y < a.y + a.height + gap;

/** Where an unconnected node starts: right of `content` (or the origin), at its top. */
export function rootSpot(content: Box | null): { x: number; y: number } {
  return content ? { x: content.x + content.width + COLUMN_GAP, y: content.y } : { x: 0, y: 0 };
}

/** One layer past the nodes it comes from, centred on them across the flow. */
export function nextLayerSpot(preds: readonly Box[], size: { width: number; height: number }, dir: Direction) {
  const b = bounds(preds)!;
  return dir === "TB"
    ? { x: b.x + b.width / 2 - size.width / 2, y: b.y + b.height + RANK_GAP }
    : { x: b.x + b.width + RANK_GAP, y: b.y + b.height / 2 - size.height / 2 };
}

/** Slides `box` across the flow (right for TB, down for LR) until it clears every obstacle. */
export function clear(box: Box, obstacles: readonly Box[], dir: Direction): Box {
  const out = { ...box };
  for (let i = 0; i <= obstacles.length; i++) {
    const hit = obstacles.find((o) => overlaps(out, o, SIBLING_GAP - 1));
    if (!hit) break;
    if (dir === "TB") out.x = hit.x + hit.width + SIBLING_GAP;
    else out.y = hit.y + hit.height + SIBLING_GAP;
  }
  return out;
}

/** From the side of `a` that faces `b` to the side of `b` that faces `a`. */
export function edgeEnds(a: Box, b: Box): { start: [number, number]; end: [number, number] } {
  const ac = [a.x + a.width / 2, a.y + a.height / 2];
  const bc = [b.x + b.width / 2, b.y + b.height / 2];
  const dx = bc[0] - ac[0];
  const dy = bc[1] - ac[1];
  // Compare against the boxes' proportions, so wide boxes stacked vertically still connect top-to-bottom.
  const vertical = Math.abs(dy) / (a.height + b.height) >= Math.abs(dx) / (a.width + b.width);
  if (vertical) {
    const down = dy >= 0;
    return { start: [ac[0], down ? a.y + a.height : a.y], end: [bc[0], down ? b.y : b.y + b.height] };
  }
  const right = dx >= 0;
  return { start: [right ? a.x + a.width : a.x, ac[1]], end: [right ? b.x : b.x + b.width, bc[1]] };
}
