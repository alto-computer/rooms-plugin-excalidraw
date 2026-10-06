import { describe, expect, it, vi } from "vitest";
import type { El } from "./ops";
import { nextStep, readOps, Serial, settled, syncStep } from "./sync";

const line = (ops: unknown[]) => JSON.stringify({ at: "2026-10-07T08:00:00Z", tool: "draw", input: { doc: "k", ops } }) + "\n";
const two = line([{ op: "node", id: "a" }]) + line([{ op: "node", id: "b" }]);

describe("readOps", () => {
  it("tells a missing file from a failed read", async () => {
    expect(await readOps(async () => null, "k")).toEqual({ ok: true, text: null });
    expect(await readOps(async () => "x\n", "k")).toEqual({ ok: true, text: "x\n" });
    expect(await readOps(async () => Promise.reject(new Error("bridge")), "k")).toEqual({ ok: false });
  });

  it("reads the doc's ops file", async () => {
    const read = vi.fn(async () => null);
    await readOps(read, "9f2c01");
    expect(read).toHaveBeenCalledWith("notes/9f2c01.ops.jsonl");
  });
});

describe("nextStep", () => {
  it("does nothing when the read failed, and keeps the count", () => {
    expect(nextStep({ ok: false }, [], 5)).toEqual({ kind: "none" });
  });

  it("draws new lines", () => {
    const s = nextStep({ ok: true, text: two }, [], 1);
    expect(s.kind).toBe("draw");
    expect(s.kind === "draw" && s.replayed.applied).toBe(2);
    expect(s.kind === "draw" && s.replayed.added).toEqual(["b"]);
  });

  it("only counts lines that draw nothing", () => {
    expect(nextStep({ ok: true, text: two + "junk\n" }, nextDrawn(), 2)).toEqual({ kind: "count", applied: 3 });
    expect(nextStep({ ok: true, text: two }, nextDrawn(), 2)).toEqual({ kind: "none" });
  });

  it("starts over when the file is gone or shorter than what was applied", () => {
    expect(nextStep({ ok: true, text: null }, [], 4)).toEqual({ kind: "count", applied: 0 });
    const s = nextStep({ ok: true, text: two }, [], 7);
    expect(s.kind === "draw" && s.replayed.added).toEqual(["a", "b"]);
  });
});

function nextDrawn(): El[] {
  const s = nextStep({ ok: true, text: two }, [], 0);
  return s.kind === "draw" ? s.replayed.elements : [];
}

describe("syncStep", () => {
  it("drops the result when another document opened during the read", async () => {
    let current = "k";
    const step = await syncStep({
      key: "k",
      isCurrent: () => current === "k",
      read: async () => {
        current = "other";
        return two;
      },
      elements: () => [],
      applied: () => 0,
    });
    expect(step).toEqual({ kind: "none" });
  });

  it("uses the board and the count as they are after the read", async () => {
    let applied = 0;
    const step = await syncStep({
      key: "k",
      isCurrent: () => true,
      read: async () => {
        applied = 1; // a sync that ran meanwhile already drew line 1
        return two;
      },
      elements: () => [],
      applied: () => applied,
    });
    expect(step.kind === "draw" && step.replayed.added).toEqual(["b"]);
  });
});

describe("Serial", () => {
  it("runs one task at a time and keeps going after one fails", async () => {
    const errors: unknown[] = [];
    const s = new Serial((e) => errors.push(e));
    const order: string[] = [];
    let release!: () => void;
    void s.run(async () => {
      await new Promise<void>((r) => (release = r));
      order.push("first");
    });
    void s.run(async () => {
      throw new Error("boom");
    });
    void s.run(async () => void order.push("third"));
    await Promise.resolve();
    expect(order).toEqual([]);
    release();
    await s.idle();
    expect(order).toEqual(["first", "third"]);
    expect(errors).toHaveLength(1);
  });
});

describe("settled", () => {
  it("saves fading elements and their labels at full opacity", () => {
    const els = [
      { id: "a", type: "rectangle", opacity: 40 },
      { id: "t", type: "text", containerId: "a", opacity: 40 },
      { id: "u", type: "rectangle", opacity: 50 },
    ] as unknown as El[];
    expect(settled(els, new Set(["a"])).map((e) => e.opacity)).toEqual([100, 100, 50]);
    expect(settled(els, new Set())).toBe(els);
  });
});
