/*
 * The draw tool's ops file: data/notes/<fileKey>.ops.jsonl, one line per tool call, appended by
 * Rooms as {"at", "tool", "input": {doc, ops, direction?}}. Turns it into calls of valid ops.
 */
import type { Direction } from "./layout";
import type { EdgeSpec, NodeSpec } from "./shapes";

/** Excalidraw's smallest readable body size. */
export const MIN_FONT_SIZE = 16;

export const opsPath = (fileKey: string) => `notes/${fileKey}.ops.jsonl`;

const SHAPES = ["rectangle", "ellipse", "diamond", "text"] as const;
const STROKES = ["solid", "dashed", "dotted"] as const;
const EDGE_KINDS = ["arrow", "line", "dashed"] as const;
const ARROWHEADS = ["arrow", "bar", "dot", "triangle"] as const;

export interface NodeOp {
  op: "node";
  id: string;
  shape?: NodeSpec["shape"];
  label?: string;
  color?: string;
  backgroundColor?: string;
  strokeColor?: string;
  strokeStyle?: NodeSpec["strokeStyle"];
  fontSize?: number;
  parent?: string;
  near?: string;
  x?: number;
  y?: number;
  width?: number;
  height?: number;
}
export type EdgeOp = { op: "edge" } & EdgeSpec;
export interface FrameOp {
  op: "frame";
  id: string;
  name?: string;
  children?: string[];
}
export type Op = NodeOp | EdgeOp | FrameOp | { op: "delete"; ids: string[] } | { op: "clear" };

/** One tool call. */
export interface Call {
  ops: Op[];
  direction: Direction;
}

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const str = (v: unknown) => (typeof v === "string" && v !== "" ? v : undefined);
const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : undefined);
const oneOf = <T extends string>(list: readonly T[], v: unknown) => (list.includes(v as T) ? (v as T) : undefined);
const strs = (v: unknown) => (Array.isArray(v) ? v.filter((x): x is string => typeof x === "string" && x !== "") : []);
/** Drops the keys whose value is undefined, so merging never erases a field with a missing one. */
const defined = <T extends object>(o: T) => Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined)) as T;

/** An op as the agent sent it, or null when it can't be used. Cosmetic fields that are wrong are dropped. */
function toOp(v: unknown): Op | null {
  if (!isObj(v)) return null;
  switch (v.op) {
    case "node": {
      const id = str(v.id);
      if (!id) return null;
      return defined({
        op: "node" as const,
        id,
        shape: oneOf(SHAPES, v.shape),
        label: typeof v.label === "string" ? v.label : undefined,
        color: str(v.color),
        backgroundColor: str(v.backgroundColor),
        strokeColor: str(v.strokeColor),
        strokeStyle: oneOf(STROKES, v.strokeStyle),
        fontSize: num(v.fontSize) !== undefined ? Math.max(MIN_FONT_SIZE, num(v.fontSize)!) : undefined,
        parent: str(v.parent),
        near: str(v.near),
        x: num(v.x),
        y: num(v.y),
        width: num(v.width) !== undefined && num(v.width)! > 0 ? num(v.width) : undefined,
        height: num(v.height) !== undefined && num(v.height)! > 0 ? num(v.height) : undefined,
      });
    }
    case "edge": {
      const from = str(v.from);
      const to = str(v.to);
      if (!from || !to || from === to) return null;
      const head = (h: unknown) => (h === null ? null : oneOf(ARROWHEADS, h));
      return defined({
        op: "edge" as const,
        id: str(v.id) ?? `${from}->${to}`,
        from,
        to,
        label: str(v.label),
        kind: oneOf(EDGE_KINDS, v.kind),
        startArrowhead: head(v.startArrowhead),
        endArrowhead: head(v.endArrowhead),
        color: str(v.color),
      });
    }
    case "frame": {
      const id = str(v.id);
      return id ? defined({ op: "frame" as const, id, name: str(v.name), children: Array.isArray(v.children) ? strs(v.children) : undefined }) : null;
    }
    case "delete": {
      const ids = strs(v.ids);
      return ids.length ? { op: "delete", ids } : null;
    }
    case "clear":
      return { op: "clear" };
    default:
      return null;
  }
}

/**
 * One call per complete line, in order. A line that isn't a call stays as an empty one, so line
 * counts and opsApplied agree. A last line without its newline is still being written: left out.
 */
export function parseOps(text: string | null): Call[] {
  if (!text) return [];
  const lines = text.split("\n").slice(0, -1);
  return lines.map((l) => {
    let raw: unknown;
    try {
      raw = JSON.parse(l);
    } catch {
      raw = null;
    }
    const input = isObj(raw) && isObj(raw.input) ? raw.input : {};
    const ops = Array.isArray(input.ops) ? input.ops.map(toOp).filter((o): o is Op => o !== null) : [];
    return { ops, direction: input.direction === "LR" ? "LR" : "TB" };
  });
}
