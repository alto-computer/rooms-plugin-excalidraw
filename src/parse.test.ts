import { describe, expect, it } from "vitest";
import { opsPath, parseOps } from "./parse";

const line = (ops: unknown[], direction?: string) =>
  JSON.stringify({ at: "2026-10-07T08:00:00Z", tool: "draw", input: { doc: "0123456789abcdef", ops, ...(direction ? { direction } : {}) } }) + "\n";
const file = (...lines: string[]) => lines.join("");
const node = (id: string, extra: Record<string, unknown> = {}) => ({ op: "node", id, label: id.toUpperCase(), ...extra });

describe("ops file", () => {
  it("lives beside the document's notes", () => {
    expect(opsPath("9f2c01")).toBe("notes/9f2c01.ops.jsonl");
  });

  it("counts every complete line, keeps bad ones as empty calls, and waits for an unfinished last line", () => {
    const text = file(line([node("a")]), "{not json\n", line([{ op: "node" }, { op: "wat" }, { op: "edge", from: "b", to: "b" }, node("b")], "LR"), '{"input":');
    const calls = parseOps(text);
    expect(calls).toHaveLength(3);
    expect(calls[0].ops.map((o) => o.op)).toEqual(["node"]);
    expect(calls[1].ops).toEqual([]);
    // The node without an id, the unknown op and the self-loop are dropped; the rest of the call stays.
    expect(calls[2].ops).toEqual([expect.objectContaining({ op: "node", id: "b" })]);
    expect(calls[2].direction).toBe("LR");
    expect(calls[0].direction).toBe("TB");
    expect(parseOps(null)).toEqual([]);
  });

  it("keeps fonts readable", () => {
    const [call] = parseOps(line([node("a", { fontSize: 9 }), node("b", { fontSize: 28 })]));
    expect(call.ops.map((o) => (o as { fontSize?: number }).fontSize)).toEqual([16, 28]);
  });
});
