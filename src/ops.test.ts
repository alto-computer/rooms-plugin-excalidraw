import { describe, expect, it } from "vitest";
import { inView } from "./layout";
import { replay, type El } from "./ops";

/** One appended tool call, as Rooms writes it. */
const line = (ops: unknown[], direction?: string) =>
  JSON.stringify({ at: "2026-10-07T08:00:00Z", tool: "draw", input: { doc: "0123456789abcdef", ops, ...(direction ? { direction } : {}) } }) + "\n";

const file = (...lines: string[]) => lines.join("");
const live = (els: El[]) => els.filter((e) => !e.isDeleted);
const byId = (els: El[], id: string) => {
  const e = live(els).find((x) => x.id === id);
  if (!e) throw new Error(`no element ${id}`);
  return e;
};
const has = (els: El[], id: string) => live(els).some((e) => e.id === id);
const labelOf = (els: El[], id: string) => live(els).find((e) => e.containerId === id)?.text;
const node = (id: string, extra: Record<string, unknown> = {}) => ({ op: "node", id, label: id.toUpperCase(), ...extra });
const userRect = (id: string, x: number, y: number, width: number, height: number): El => ({
  id,
  type: "rectangle",
  x,
  y,
  width,
  height,
  isDeleted: false,
});

describe("replay", () => {
  it("applies only the lines past opsApplied and reports the new count", () => {
    const text = file(line([node("a")]), line([node("b")]));
    const r = replay([], text, 1);
    expect(r.applied).toBe(2);
    expect(has(r.elements, "a")).toBe(false);
    expect(has(r.elements, "b")).toBe(true);
    expect(labelOf(r.elements, "b")).toBe("B");
    expect(r.added).toEqual(["b"]);
    expect(replay(r.elements, text, 2).changed).toBe(false);
  });

  it("skips a bad line and still applies the ones after it", () => {
    const r = replay([], file("garbage\n", line([node("a")])), 0);
    expect(r.applied).toBe(2);
    expect(has(r.elements, "a")).toBe(true);
  });

  it("lays new nodes out top to bottom by default, right of what is already drawn", () => {
    const existing = [userRect("mine", 0, 0, 500, 300)];
    const r = replay(existing, file(line([node("a"), node("b"), node("c"), { op: "edge", from: "a", to: "b" }, { op: "edge", from: "a", to: "c" }])), 0);
    const [a, b, c] = ["a", "b", "c"].map((id) => byId(r.elements, id));
    expect(a.x).toBeGreaterThanOrEqual(500 + 40);
    expect(b.y).toBeGreaterThan(a.y + a.height);
    expect(c.y).toBe(b.y);
    // Siblings sit side by side, not on top of each other.
    expect(c.x >= b.x + b.width || b.x >= c.x + c.width).toBe(true);
    expect(byId(r.elements, "mine")).toEqual(existing[0]);
  });

  it("flows left to right when asked", () => {
    const r = replay([], file(line([node("a"), node("b"), { op: "edge", from: "a", to: "b" }], "LR")), 0);
    const [a, b] = [byId(r.elements, "a"), byId(r.elements, "b")];
    expect(b.x).toBeGreaterThan(a.x + a.width);
  });

  it("places a node added in a later call below the node it comes from", () => {
    const first = replay([], file(line([node("a")])), 0);
    const text = file(line([node("a")]), line([node("b"), { op: "edge", from: "a", to: "b" }]));
    const r = replay(first.elements, text, 1);
    const [a, b] = [byId(r.elements, "a"), byId(r.elements, "b")];
    expect(b.y).toBeGreaterThan(a.y + a.height);
    expect(Math.abs(b.x + b.width / 2 - (a.x + a.width / 2))).toBeLessThan(1);
  });

  it("keeps explicit x/y", () => {
    const r = replay([], file(line([node("a", { x: 900, y: -40 })])), 0);
    expect(byId(r.elements, "a")).toMatchObject({ x: 900, y: -40 });
  });

  it("sizes labels by script: CJK characters are wider than Latin ones", () => {
    const r = replay([], file(line([node("en", { label: "abcdefghijkl" }), node("ko", { label: "데이터베이스서버연결풀관" })])), 0);
    expect(byId(r.elements, "ko").width).toBeGreaterThan(byId(r.elements, "en").width);
    expect(byId(r.elements, "en").width).toBeGreaterThanOrEqual(120);
    expect(byId(r.elements, "en").height).toBeGreaterThanOrEqual(60);
  });

  it("binds edges to nodes by id", () => {
    const r = replay([], file(line([node("a"), node("b"), { op: "edge", from: "a", to: "b", label: "calls" }])), 0);
    const arrow = live(r.elements).find((e) => e.type === "arrow")!;
    expect(arrow.id).toBe("a->b");
    expect((arrow.startBinding as { elementId: string }).elementId).toBe("a");
    expect((arrow.endBinding as { elementId: string }).elementId).toBe("b");
    expect(byId(r.elements, "a").boundElements).toContainEqual({ id: "a->b", type: "arrow" });
    expect(byId(r.elements, "b").boundElements).toContainEqual({ id: "a->b", type: "arrow" });
    expect(labelOf(r.elements, "a->b")).toBe("calls");
  });

  it("holds an edge until both of its nodes exist, also across a reload", () => {
    const text = file(line([node("a"), { op: "edge", from: "a", to: "b" }]), line([node("b")]));
    const first = replay([], text.split("\n")[0] + "\n", 0);
    expect(live(first.elements).some((e) => e.type === "arrow")).toBe(false);
    // The panel was closed in between: the held edge comes back from the ops file.
    const r = replay(first.elements, text, first.applied);
    expect(has(r.elements, "a->b")).toBe(true);
    expect(r.added).toEqual(["b", "a->b"]);
  });

  it("updates a node sent again with the same id and keeps where it is", () => {
    const first = replay([], file(line([node("a"), node("b"), { op: "edge", from: "a", to: "b" }])), 0);
    const a0 = byId(first.elements, "a");
    const text = file(line([node("a"), node("b"), { op: "edge", from: "a", to: "b" }]), line([{ op: "node", id: "a", label: "Gateway", color: "green" }]));
    const r = replay(first.elements, text, 1);
    const a = byId(r.elements, "a");
    expect(labelOf(r.elements, "a")).toBe("Gateway");
    expect(a.backgroundColor).toBe("#b2f2bb");
    expect({ x: a.x, y: a.y }).toEqual({ x: a0.x, y: a0.y });
    expect(live(r.elements).filter((e) => e.containerId === "a")).toHaveLength(1);
    expect(a.boundElements).toContainEqual({ id: "a->b", type: "arrow" });
    expect(r.added).toEqual([]);
    expect(r.changed).toBe(true);
  });

  it("deletes a node with its label and the edges on it", () => {
    const text = file(line([node("a"), node("b"), { op: "edge", from: "a", to: "b", label: "x" }]), line([{ op: "delete", ids: ["a"] }]));
    const r = replay([], text, 0);
    expect(has(r.elements, "a")).toBe(false);
    expect(has(r.elements, "a->b")).toBe(false);
    expect(live(r.elements).some((e) => e.containerId === "a" || e.containerId === "a->b")).toBe(false);
    expect(byId(r.elements, "b").boundElements ?? []).not.toContainEqual({ id: "a->b", type: "arrow" });
  });

  it("marks what it removes as deleted, keeps deleted elements, and never leaves two elements with one id", () => {
    const gone: El = { ...userRect("old", 0, 0, 10, 10), isDeleted: true };
    const text = file(line([node("a"), node("b"), { op: "edge", from: "a", to: "b" }]), line([{ op: "delete", ids: ["a"] }]), line([node("a"), node("b", { label: "B2" })]));
    const r = replay([gone], text, 0);
    expect(r.elements.find((e) => e.id === "old")).toEqual(gone);
    expect(r.elements.find((e) => e.id === "a->b")?.isDeleted).toBe(true);
    const ids = r.elements.map((e) => e.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(has(r.elements, "a")).toBe(true);
    // b's first label was replaced: it is deleted, not dropped.
    expect(r.elements.filter((e) => e.containerId === "b").map((e) => [e.text, !!e.isDeleted]).sort()).toEqual([
      ["B", true],
      ["B2", false],
    ]);
  });

  it("clear removes what the tool drew and leaves the user's own drawing", () => {
    const r = replay([userRect("mine", 0, 0, 100, 100)], file(line([node("a"), node("b")]), line([{ op: "clear" }]), line([node("c")])), 0);
    expect(live(r.elements).map((e) => e.id).filter((id) => !live(r.elements).find((e) => e.id === id)?.containerId)).toEqual(["mine", "c"]);
  });


  it("keeps a dashed edge an edge: deleting its node removes it", () => {
    const r = replay([], file(line([node("a"), node("b"), { op: "edge", from: "a", to: "b", kind: "dashed" }]), line([{ op: "delete", ids: ["b"] }])), 0);
    expect(has(r.elements, "a->b")).toBe(false);
  });

  it("merges an edge sent again, like a node", () => {
    const text = file(line([node("a"), node("b"), { op: "edge", from: "a", to: "b", label: "reads" }]), line([{ op: "edge", from: "a", to: "b", kind: "dashed" }]));
    const r = replay([], text, 0);
    expect(labelOf(r.elements, "a->b")).toBe("reads");
    expect(byId(r.elements, "a->b").strokeStyle).toBe("dashed");
  });

  it("drops a node or frame whose id the other already uses", () => {
    const r = replay([], file(line([node("a"), { op: "frame", id: "a", children: ["a"] }, { op: "frame", id: "z", name: "Zone", children: ["b"] }, node("b"), node("z")])), 0);
    expect(byId(r.elements, "a").type).toBe("rectangle");
    expect(byId(r.elements, "z").type).toBe("frame");
    expect(byId(r.elements, "b").frameId).toBe("z");
    expect(live(r.elements).filter((e) => e.id === "z")).toHaveLength(1);
  });

  it("leaves the user's elements in a frame alone, and a frame the user resized while its nodes stay put", () => {
    const first = replay([], file(line([node("a", { parent: "zone" }), { op: "frame", id: "zone", name: "Zone" }])), 0);
    const mine: El = { ...userRect("mine", 5000, 5000, 10, 10), frameId: "zone" };
    const resized = first.elements.map((e) => (e.id === "zone" ? { ...e, width: e.width + 300 } : e));
    const text = file(line([node("a", { parent: "zone" }), { op: "frame", id: "zone", name: "Zone" }]), line([node("c")]));
    const r = replay([...resized, mine], text, 1);
    expect(byId(r.elements, "mine").frameId).toBe("zone");
    expect(byId(r.elements, "zone").width).toBe(byId(resized, "zone").width);
  });

  it("frames group their children", () => {
    const r = replay([], file(line([node("a"), node("b", { parent: "zone" }), { op: "frame", id: "zone", name: "Backend", children: ["a"] }])), 0);
    const f = byId(r.elements, "zone");
    expect(f).toMatchObject({ type: "frame", name: "Backend" });
    for (const id of ["a", "b"]) {
      const e = byId(r.elements, id);
      expect(e.frameId).toBe("zone");
      expect(e.x).toBeGreaterThan(f.x);
      expect(e.x + e.width).toBeLessThan(f.x + f.width);
    }
    expect(live(r.elements).find((e) => e.containerId === "a")?.frameId).toBe("zone");
  });
});

describe("inView", () => {
  const view = { scrollX: 0, scrollY: 0, zoom: 2, width: 800, height: 600 };
  it("sees boxes inside the scene area the viewport shows", () => {
    // At zoom 2 the viewport shows scene x 0..400, y 0..300.
    expect(inView([{ x: 350, y: 10, width: 100, height: 50 }], view)).toBe(true);
    expect(inView([{ x: 450, y: 10, width: 100, height: 50 }], view)).toBe(false);
    expect(inView([{ x: 450, y: 10, width: 100, height: 50 }], { ...view, scrollX: -300 })).toBe(true);
    expect(inView([], view)).toBe(false);
  });
});
