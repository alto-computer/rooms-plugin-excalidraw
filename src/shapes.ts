/*
 * Turns the draw tool's nodes, edges and frames into Excalidraw elements, through Excalidraw's own
 * skeleton API so labels, bindings and frames come out the way the editor makes them.
 */
import { convertToExcalidrawElements } from "@excalidraw/excalidraw";
import { edgeEnds, FONT_SIZE, type Box } from "./layout";

/** An element as the scene holds it. Only what the draw tool reads is typed. */
export interface El {
  id: string;
  type: string;
  x: number;
  y: number;
  width: number;
  height: number;
  isDeleted?: boolean;
  text?: string;
  containerId?: string | null;
  frameId?: string | null;
  boundElements?: readonly { id: string; type: string }[] | null;
  customData?: Record<string, unknown>;
  [key: string]: unknown;
}

/** Pastel fill + matching stroke, from Excalidraw's palette. */
export const COLORS = {
  blue: ["#a5d8ff", "#1971c2"],
  green: ["#b2f2bb", "#2f9e44"],
  orange: ["#ffd8a8", "#e8590c"],
  purple: ["#d0bfff", "#6741d9"],
  red: ["#ffc9c9", "#e03131"],
  yellow: ["#fff3bf", "#f08c00"],
  teal: ["#c3fae8", "#0c8599"],
  pink: ["#fcc2d7", "#c2255c"],
  gray: ["#e9ecef", "#495057"],
} as const;
export type ColorName = keyof typeof COLORS;

export interface NodeSpec {
  id: string;
  shape: "rectangle" | "ellipse" | "diamond" | "text";
  label: string;
  backgroundColor: string;
  strokeColor: string;
  strokeStyle: "solid" | "dashed" | "dotted";
  fontSize: number;
  /** Kept on the element so later calls can update it. */
  data: Record<string, unknown>;
}

export interface EdgeSpec {
  id: string;
  from: string;
  to: string;
  label?: string;
  kind?: "arrow" | "line" | "dashed";
  startArrowhead?: string | null;
  endArrowhead?: string | null;
  color?: string;
}

/** Marks what the draw tool made, and remembers what it was made from. */
export const ROOMS = "rooms";
export const toolData = (e: El) => e.customData?.[ROOMS] as Record<string, unknown> | undefined;

const convert = (skeletons: unknown[]) =>
  (convertToExcalidrawElements(skeletons as never, { regenerateIds: false }) as unknown as El[]).map((e) => ({ ...e, index: null }));

/** The node's shape and, unless it is free text, its bound label. */
export function nodeElements(n: NodeSpec, box: Box): El[] {
  const customData = { [ROOMS]: n.data };
  if (n.shape === "text") {
    return convert([{ type: "text", id: n.id, x: box.x, y: box.y, text: n.label || n.id, fontSize: n.fontSize, strokeColor: n.strokeColor, customData }]);
  }
  return convert([
    {
      type: n.shape,
      id: n.id,
      ...box,
      backgroundColor: n.backgroundColor,
      strokeColor: n.strokeColor,
      strokeStyle: n.strokeStyle,
      fillStyle: "solid",
      roundness: n.shape === "rectangle" ? { type: 3 } : null,
      customData,
      ...(n.label ? { label: { text: n.label, fontSize: n.fontSize } } : {}),
    },
  ]);
}

const color = (c: string | undefined) => (c && c in COLORS ? COLORS[c as ColorName][1] : c) ?? "#1e1e1e";

/** The arrow (and its label) bound to `from` and `to`. The two nodes' boundElements are the caller's to update. */
export function edgeElements(e: EdgeSpec, from: El, to: El): El[] {
  const { start, end } = edgeEnds(from, to);
  const stub = (n: El) => ({ type: n.type, id: n.id, x: n.x, y: n.y, width: n.width, height: n.height, ...(n.type === "text" ? { text: n.text } : {}) });
  const kind = e.kind ?? "arrow";
  const out = convert([
    stub(from),
    stub(to),
    {
      type: "arrow",
      id: e.id,
      x: start[0],
      y: start[1],
      points: [
        [0, 0],
        [end[0] - start[0], end[1] - start[1]],
      ],
      start: { id: from.id },
      end: { id: to.id },
      strokeColor: color(e.color),
      strokeStyle: kind === "dashed" ? "dashed" : "solid",
      startArrowhead: e.startArrowhead ?? null,
      endArrowhead: e.endArrowhead !== undefined ? e.endArrowhead : kind === "line" ? null : "arrow",
      customData: { [ROOMS]: { kind: "edge", ...e } },
      ...(e.label ? { label: { text: e.label, fontSize: FONT_SIZE - 4 } } : {}),
    },
  ]);
  return out.filter((x) => x.id !== from.id && x.id !== to.id);
}

export function frameElement(id: string, name: string, box: Box): El {
  // The converter fits a frame to children it converts itself; ours are already in the scene.
  const [frame] = convert([{ type: "frame", id, name, children: [], customData: { [ROOMS]: { kind: "frame" } } }]);
  return { ...frame, ...box };
}

export const nodeColors = (c: string | undefined) => (c && c in COLORS ? COLORS[c as ColorName] : null);
