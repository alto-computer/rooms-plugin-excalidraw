/*
 * The draw tool. Agents call it through Rooms, which appends each call as one line to
 * data/notes/<fileKey>.ops.jsonl: {"at", "tool", "input": {doc, ops, direction?}}. The panel replays
 * the lines it has not applied yet onto the scene and saves how many it has applied with it.
 *
 * Ops: node (upsert by id), edge (between node ids; held until both exist), frame, delete, clear.
 * Nodes without x/y are laid out in layers along `direction`, new ones right of what is drawn.
 */
import { bounds, clear as clearOf, FONT_SIZE, nextLayerSpot, rootSpot, shapeSize, SIBLING_GAP, type Box, type Direction } from "./layout";
import { parseOps, type Call, type FrameOp, type NodeOp, type Op } from "./parse";
import { edgeElements, edgeOf, frameElement, nodeColors, nodeElements, toolData, type EdgeSpec, type El, type NodeSpec } from "./shapes";

export type { El } from "./shapes";
export { opsPath, parseOps } from "./parse";

const FRAME_PAD = 30;

export interface Replayed {
  elements: El[];
  /** Lines of the ops file now in `elements`: save it as the scene's opsApplied. */
  applied: number;
  /** Ids of elements drawn for the first time, in order. */
  added: string[];
  changed: boolean;
}

/**
 * Applies the lines of `text` past the first `applied` to `elements`. A file shorter than `applied`
 * was replaced, so it is applied from the start. Edges still waiting for a node, and frames, are
 * re-derived from the lines already applied.
 */
export function replay(elements: readonly El[], text: string | null, applied: number): Replayed {
  const calls = parseOps(text);
  const from = applied > calls.length ? 0 : applied;
  const board = new Board(elements);
  for (const call of calls.slice(0, from)) board.remember(call);
  board.settleRemembered();
  for (const call of calls.slice(from)) board.apply(call);
  return { elements: board.els, applied: calls.length, added: board.added, changed: board.changed };
}

const box = (e: El): Box => ({ x: e.x, y: e.y, width: e.width, height: e.height });
const bump = (e: El, patch: Partial<El>): El => ({
  ...e,
  ...patch,
  version: ((e.version as number) ?? 1) + 1,
  versionNonce: Math.floor(Math.random() * 2 ** 31),
});

const alive = (e: El) => !e.isDeleted;

/**
 * The scene while a replay runs. Elements are replaced, never mutated; what is removed stays,
 * marked deleted, as Excalidraw does it (its undo history relies on that). Deleted elements are
 * kept as they came.
 */
class Board {
  els: El[];
  added: string[] = [];
  changed = false;
  private pending = new Map<string, EdgeSpec>();
  private frames = new Map<string, { name?: string; children: string[] }>();
  /** Ids the current segment drew, redrew or erased: frames refit only around these. */
  private touched = new Set<string>();

  constructor(elements: readonly El[]) {
    this.els = [...elements];
  }

  /** A live element the draw tool made. */
  private get(id: string): El | undefined {
    return this.els.find((e) => e.id === id && alive(e) && toolData(e) !== undefined);
  }

  private kindOf(id: string) {
    const e = this.get(id);
    return e && toolData(e)!.kind;
  }

  /** A live node the tool drew: what edges connect. */
  private getNode(id: string) {
    return this.kindOf(id) === "node" ? this.get(id) : undefined;
  }

  private labelOf(id: string) {
    return this.els.find((e) => e.containerId === id && alive(e));
  }

  /** Marks the elements matching `which` deleted. */
  private erase(which: (e: El) => boolean) {
    this.els = this.els.map((e) => {
      if (!alive(e) || !which(e)) return e;
      this.touched.add(e.id);
      return bump(e, { isDeleted: true });
    });
    this.changed = true;
  }

  /** Remembers what an applied line left behind: edges that may still wait, and frames. */
  remember(call: Call) {
    for (const op of call.ops) {
      if (op.op === "edge") this.pending.set(op.id, { ...this.pending.get(op.id), ...edgeSpec(op) });
      else if (op.op === "frame") this.mergeFrame(op);
      else if (op.op === "delete") this.forget(op.ids);
      else if (op.op === "clear") {
        this.pending.clear();
        this.frames.clear();
      }
    }
  }

  /** Of the remembered edges, only the ones missing a node still wait: the rest were drawn, or erased by the user. */
  settleRemembered() {
    for (const [id, e] of this.pending) {
      if (this.get(id) || (this.getNode(e.from) && this.getNode(e.to))) this.pending.delete(id);
    }
  }

  apply(call: Call) {
    // delete and clear split a call: what comes before them happens before them.
    let segment: Op[] = [];
    for (const op of call.ops) {
      if (op.op === "delete" || op.op === "clear") {
        this.draw(segment, call.direction);
        segment = [];
        this.touched = new Set();
        if (op.op === "delete") this.remove(op.ids);
        else this.clearAll();
      } else segment.push(op);
    }
    this.draw(segment, call.direction);
  }

  private draw(ops: Op[], dir: Direction) {
    if (ops.length === 0) return;
    this.touched = new Set();
    const nodes = new Map<string, NodeOp>();
    for (const op of ops) {
      // A node and a frame can't share an id: whichever came first keeps it.
      if (op.op === "node") {
        if (!this.frames.has(op.id) && this.kindOf(op.id) !== "frame") nodes.set(op.id, { ...nodes.get(op.id), ...op });
      } else if (op.op === "edge") {
        // Sent again, an edge keeps what the new op doesn't say, like a node.
        const old = this.get(op.id);
        this.pending.set(op.id, { ...(old && edgeOf(old)), ...this.pending.get(op.id), ...edgeSpec(op) });
      } else if (op.op === "frame" && !nodes.has(op.id) && this.mergeFrame(op)) this.touched.add(op.id);
    }
    const allEdges = [...this.pending.values()];

    const before = bounds(this.obstacles());
    const auto: NodeOp[] = [];
    const moved = new Set<string>();
    for (const n of nodes.values()) {
      const old = this.get(n.id);
      if (old || (n.x !== undefined && n.y !== undefined)) {
        const spec = this.nodeSpec(n, old);
        this.putNode(spec, { x: n.x ?? old!.x, y: n.y ?? old!.y, ...this.sizeOf(n, spec, old) });
        if (old) moved.add(n.id);
      } else auto.push(n);
    }
    for (const n of layerOrder(auto, allEdges)) {
      const spec = this.nodeSpec(n, undefined);
      const size = this.sizeOf(n, spec, undefined);
      const preds = allEdges.filter((e) => e.to === n.id).flatMap((e) => this.getNode(e.from) ?? []);
      const spot = preds.length ? nextLayerSpot(preds.map(box), size, dir) : this.rootSpot(n, before, dir);
      const placed = n.x !== undefined || n.y !== undefined ? { ...spot, ...size } : clearOf({ ...spot, ...size }, this.obstacles(), dir);
      this.putNode(spec, { ...placed, x: n.x ?? placed.x, y: n.y ?? placed.y });
    }

    // Edges on nodes that changed are redrawn to their new size and place.
    for (const a of this.els.filter((e) => alive(e) && edgeOf(e))) {
      const e = edgeOf(a)!;
      if (!this.pending.has(a.id) && (moved.has(e.from) || moved.has(e.to))) this.pending.set(a.id, e);
    }
    for (const e of [...this.pending.values()]) this.tryEdge(e);
    this.layoutFrames();
  }

  private nodeSpec(n: NodeOp, old: El | undefined): NodeSpec {
    const prev = (old && toolData(old)) ?? {};
    const { op: _op, id: _id, x: _x, y: _y, width: _w, height: _h, near: _near, ...fields } = n;
    const data = { ...prev, ...fields, kind: "node" } as Record<string, unknown>;
    const shape = (data.shape as NodeSpec["shape"]) ?? "rectangle";
    const preset = nodeColors(n.color);
    const oldLabel = old && (old.type === "text" ? old.text : this.labelOf(old.id)?.text);
    return {
      id: n.id,
      shape,
      label: n.label ?? oldLabel ?? (data.label as string | undefined) ?? (shape === "text" ? n.id : ""),
      backgroundColor: n.backgroundColor ?? preset?.[0] ?? (old?.backgroundColor as string) ?? "transparent",
      strokeColor: n.strokeColor ?? preset?.[1] ?? (old?.strokeColor as string) ?? "#1e1e1e",
      strokeStyle: n.strokeStyle ?? (old?.strokeStyle as NodeSpec["strokeStyle"]) ?? "solid",
      fontSize: (data.fontSize as number | undefined) ?? FONT_SIZE,
      data,
    };
  }

  /** Given size, else the old size while the label and shape stay, else fitted to the label. */
  private sizeOf(n: NodeOp, spec: NodeSpec, old: El | undefined) {
    const sameText = old && n.label === undefined && n.shape === undefined && n.fontSize === undefined;
    const fit = sameText ? { width: old.width, height: old.height } : shapeSize(spec.label, spec.shape, spec.fontSize);
    return { width: n.width ?? fit.width, height: n.height ?? fit.height };
  }

  /** An unconnected node: beside its `near` node, beside the rest of its frame, or right of everything. */
  private rootSpot(n: NodeOp, before: Box | null, dir: Direction) {
    const nearEl = n.near ? this.getNode(n.near) : undefined;
    const frame = this.frameOf(n.id, n.parent);
    const siblings = frame ? bounds(this.frameChildren(frame).filter((id) => id !== n.id).flatMap((id) => this.getNode(id) ?? []).map(box)) : null;
    const next = nearEl ? box(nearEl) : siblings;
    if (!next) return rootSpot(before);
    return dir === "TB" ? { x: next.x + next.width + SIBLING_GAP, y: next.y } : { x: next.x, y: next.y + next.height + SIBLING_GAP };
  }

  /** What new nodes must not overlap: shapes and free text; not labels, arrows, or the tool's frames. */
  private obstacles(): Box[] {
    return this.els
      .filter((e) => alive(e) && !e.containerId && e.type !== "arrow" && e.type !== "line" && !(e.type === "frame" && toolData(e)))
      .map(box);
  }

  private putNode(spec: NodeSpec, b: Box) {
    const old = this.get(spec.id);
    const made = nodeElements(spec, b);
    if (old) {
      const arrows = (old.boundElements ?? []).filter((r) => r.type === "arrow");
      made[0] = { ...made[0], boundElements: [...(made[0].boundElements ?? []), ...arrows], frameId: old.frameId ?? null };
      made.slice(1).forEach((t, i) => (made[i + 1] = { ...t, frameId: old.frameId ?? null }));
    }
    this.replace(spec.id, made);
  }

  private tryEdge(e: EdgeSpec) {
    const from = this.getNode(e.from);
    const to = this.getNode(e.to);
    if (!from || !to) {
      this.pending.set(e.id, e);
      return;
    }
    this.pending.delete(e.id);
    this.unbind(e.id);
    // Look the nodes up again: unbinding the old arrow may have replaced them.
    this.replace(e.id, edgeElements(e, this.getNode(e.from)!, this.getNode(e.to)!));
    for (const id of new Set([e.from, e.to])) {
      const n = this.getNode(id)!;
      this.swap(n, bump(n, { boundElements: [...(n.boundElements ?? []), { id: e.id, type: "arrow" }] }));
    }
  }

  /**
   * Puts `made` (an element and its label) where `id` was, or on top. The old label is deleted;
   * the old element itself gives way (also a deleted one: two elements must never share an id).
   */
  private replace(id: string, made: El[]) {
    const old = this.get(id);
    const at = old ? this.els.indexOf(old) : -1;
    const prior = this.els.find((e) => e.id === id);
    this.erase((e) => e.containerId === id);
    this.els = this.els.filter((e) => e.id !== id);
    if (prior) made[0] = { ...made[0], version: ((prior.version as number) ?? 1) + 1 };
    if (old) this.els.splice(Math.min(at, this.els.length), 0, ...made);
    else this.els.push(...made);
    if (!old && !this.added.includes(id)) this.added.push(id);
    this.touched.add(id);
    this.changed = true;
  }

  private swap(old: El, next: El) {
    this.els = this.els.map((e) => (e === old ? next : e));
    this.changed = true;
  }

  /** Removes an arrow and its label, and unbinds it from its nodes. */
  private dropArrow(id: string) {
    this.unbind(id);
    this.erase((e) => (e.id === id && !!toolData(e)) || e.containerId === id);
  }

  private unbind(arrowId: string) {
    for (const n of this.els.filter((e) => alive(e) && e.boundElements?.some((r) => r.id === arrowId && r.type === "arrow"))) {
      this.swap(n, bump(n, { boundElements: n.boundElements!.filter((r) => r.id !== arrowId) }));
    }
  }

  private remove(ids: string[]) {
    for (const id of ids) {
      const el = this.get(id);
      if (!el) continue;
      const kind = toolData(el)?.kind;
      if (kind === "edge") this.dropArrow(id);
      else if (kind === "frame") {
        this.erase((e) => e === el);
        this.els = this.els.map((e) => (alive(e) && e.frameId === id ? bump(e, { frameId: null }) : e));
      } else {
        for (const a of this.els.filter((e) => alive(e) && edgeOf(e))) {
          const spec = edgeOf(a)!;
          if (spec.from === id || spec.to === id) this.dropArrow(a.id);
        }
        const node = this.get(id);
        this.erase((e) => e === node || e.containerId === id);
      }
    }
    this.forget(ids);
    this.layoutFrames();
  }

  /** Erases what the tool drew; the user's own drawing stays. */
  private clearAll() {
    const mine = new Set(this.els.filter((e) => alive(e) && toolData(e)).map((e) => e.id));
    if (mine.size) {
      this.erase((e) => mine.has(e.id) || (!!e.containerId && mine.has(e.containerId)));
      this.els = this.els.map((e) => (alive(e) && e.frameId && mine.has(e.frameId) ? bump(e, { frameId: null }) : e));
    }
    this.pending.clear();
    this.frames.clear();
  }

  private forget(ids: string[]) {
    const gone = new Set(ids);
    for (const [id, e] of this.pending) if (gone.has(id) || gone.has(e.from) || gone.has(e.to)) this.pending.delete(id);
    for (const id of ids) this.frames.delete(id);
    for (const f of this.frames.values()) f.children = f.children.filter((c) => !gone.has(c));
  }

  /** Adds a frame op to what is known of the frame; false when a node already has the id. */
  private mergeFrame(op: FrameOp): boolean {
    if (this.kindOf(op.id) === "node") return false;
    const f = this.frames.get(op.id) ?? { children: [] };
    this.frames.set(op.id, { name: op.name ?? f.name, children: [...new Set([...f.children, ...(op.children ?? [])])] });
    return true;
  }

  private frameOf(id: string, parent: string | undefined) {
    if (parent) return parent;
    for (const [fid, f] of this.frames) if (f.children.includes(id)) return fid;
    return undefined;
  }

  private frameChildren(fid: string): string[] {
    const listed = this.frames.get(fid)?.children ?? [];
    const parented = this.els.filter((e) => alive(e) && toolData(e)?.kind === "node" && toolData(e)?.parent === fid).map((e) => e.id);
    return [...new Set([...listed, ...parented])];
  }

  /** Whether the tool drew `e`, or `e` is the label of something it drew. */
  private drawnByTool(e: El) {
    return !!toolData(e) || (!!e.containerId && !!this.get(e.containerId));
  }

  /**
   * Fits each frame whose nodes this segment touched around them, and points the tool's elements
   * (and their labels) at it. A frame nothing touched keeps the size the user gave it; the user's
   * own elements keep whatever frame they are in.
   */
  private layoutFrames() {
    const fids = new Set([...this.frames.keys(), ...this.els.flatMap((e) => (alive(e) && toolData(e)?.kind === "node" && toolData(e)?.parent ? [toolData(e)!.parent as string] : []))]);
    for (const fid of fids) {
      const kids = new Set(this.frameChildren(fid).filter((id) => this.getNode(id)));
      const old = this.get(fid);
      const t = this.touched;
      const refit = !old || t.has(fid) || [...kids].some((id) => t.has(id)) || this.els.some((e) => t.has(e.id) && e.frameId === fid);
      if (!refit) continue;
      const members = this.els.filter((e) => alive(e) && (kids.has(e.id) || (!!e.containerId && kids.has(e.containerId))));
      const b = bounds(members.map(box));
      if (!b) {
        if (old) this.remove([fid]);
        continue;
      }
      const name = this.frames.get(fid)?.name ?? (old?.name as string | undefined) ?? fid;
      const padded = { x: b.x - FRAME_PAD, y: b.y - FRAME_PAD, width: b.width + 2 * FRAME_PAD, height: b.height + 2 * FRAME_PAD };
      const same = old && old.name === name && (["x", "y", "width", "height"] as const).every((k) => old[k] === padded[k]);
      if (!same) this.replace(fid, [frameElement(fid, name, padded)]);
      for (const e of this.els.filter((x) => alive(x) && this.drawnByTool(x))) {
        const inside = kids.has(e.id) || (!!e.containerId && kids.has(e.containerId));
        const want = inside ? fid : e.frameId === fid ? null : e.frameId;
        if ((e.frameId ?? null) !== (want ?? null)) this.swap(e, bump(e, { frameId: want ?? null }));
      }
    }
  }
}

/** An edge op as the edge it draws. */
function edgeSpec(op: EdgeSpec & { op?: string }): EdgeSpec {
  const { op: _op, ...spec } = op;
  return spec;
}

/** New nodes in layer order: a node after the nodes its edges come from; ties (and cycles) in call order. */
function layerOrder(nodes: NodeOp[], edges: EdgeSpec[]): NodeOp[] {
  const ids = new Set(nodes.map((n) => n.id));
  const inner = edges.filter((e) => ids.has(e.from) && ids.has(e.to) && e.from !== e.to);
  const indeg = new Map(nodes.map((n) => [n.id, 0]));
  for (const e of inner) indeg.set(e.to, indeg.get(e.to)! + 1);
  const out: NodeOp[] = [];
  const left = [...nodes];
  while (left.length) {
    const i = Math.max(0, left.findIndex((n) => indeg.get(n.id) === 0));
    const [n] = left.splice(i, 1);
    out.push(n);
    for (const e of inner) if (e.from === n.id) indeg.set(e.to, indeg.get(e.to)! - 1);
  }
  return out;
}
