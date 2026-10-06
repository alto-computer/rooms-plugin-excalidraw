import { describe, expect, it, vi } from "vitest";
import { Notes, notePath, parseScene, pngName, serializeScene } from "./notes";

const rect = (id: string, extra: Record<string, unknown> = {}) => ({ id, type: "rectangle", isDeleted: false, ...extra });

function storage(files: Record<string, string> = {}) {
  return {
    files,
    read: vi.fn(async (p: string) => files[p] ?? null),
    write: vi.fn(async (p: string, t: string) => void (files[p] = t)),
  };
}

describe("scene files", () => {
  it("keys notes by the document's fileKey", () => {
    expect(notePath("9f2c01")).toBe("notes/9f2c01.excalidraw");
  });

  it("reads no file as an empty scene and refuses text it can't use", () => {
    expect(parseScene(null)).toEqual({ ok: true, scene: null });
    expect(parseScene("{nope").ok).toBe(false);
    expect(parseScene(JSON.stringify({ elements: "x" })).ok).toBe(false);
  });

  it("writes only what is drawn: no deleted elements, no unused images, one appState field", () => {
    const text = serializeScene({
      elements: [rect("a"), rect("b", { isDeleted: true }), { id: "i", type: "image", fileId: "f1", isDeleted: false }],
      appState: { viewBackgroundColor: "#fff", zoom: { value: 2 }, selectedElementIds: { a: true } },
      files: { f1: { id: "f1", dataURL: "data:image/png;base64,AA" }, f2: { id: "f2", dataURL: "data:x" } },
    });
    const back = JSON.parse(text);
    expect(back.type).toBe("excalidraw");
    expect(back.elements.map((e: { id: string }) => e.id)).toEqual(["a", "i"]);
    expect(back.appState).toEqual({ viewBackgroundColor: "#fff" });
    expect(Object.keys(back.files)).toEqual(["f1"]);
    const r = parseScene(text);
    expect(r.ok && r.scene?.elements).toHaveLength(2);
  });

  it("names the PNG after the document", () => {
    expect(pngName("Latency: p95/p50")).toBe("Latency- p95-p50 notes.png");
    expect(pngName("  ")).toBe("notes.png");
  });
});

describe("Notes", () => {
  it("loads a document's notes and saves changes after a quiet spell", async () => {
    vi.useFakeTimers();
    const s = storage({ "notes/k1.excalidraw": serializeScene({ elements: [rect("a")], appState: {}, files: {} }) });
    const n = new Notes(s, 400);
    const r = await n.open("k1");
    expect(r.ok && r.scene?.elements).toHaveLength(1);
    n.change("one");
    n.change("two");
    await vi.advanceTimersByTimeAsync(400);
    expect(s.write).toHaveBeenCalledTimes(1);
    expect(s.files["notes/k1.excalidraw"]).toBe("two");
    vi.useRealTimers();
  });

  it("saves the open document before switching to another", async () => {
    const s = storage();
    const n = new Notes(s, 10_000);
    await n.open("k1");
    n.change("first doc");
    await n.open("k2");
    expect(s.files["notes/k1.excalidraw"]).toBe("first doc");
    n.change("second doc");
    await n.flush();
    expect(s.files["notes/k2.excalidraw"]).toBe("second doc");
  });

  it("never writes over notes it can't read", async () => {
    const s = storage({ "notes/k1.excalidraw": "{broken" });
    const n = new Notes(s, 0);
    expect((await n.open("k1")).ok).toBe(false);
    n.change("blank");
    await n.flush();
    expect(s.write).not.toHaveBeenCalled();
    await n.startOver();
    expect(Object.entries(s.files).find(([k]) => k.startsWith("notes/k1.broken-"))?.[1]).toBe("{broken");
    n.change("fresh");
    await n.flush();
    expect(s.files["notes/k1.excalidraw"]).toBe("fresh");
  });

  it("reports a failed save and keeps it for the next try", async () => {
    const s = storage();
    s.write.mockRejectedValueOnce(new Error("disk"));
    const status = vi.fn();
    const n = new Notes(s, 0, status);
    await n.open("k1");
    n.change("x");
    await n.flush();
    expect(status).toHaveBeenLastCalledWith(true);
    await n.flush();
    expect(s.files["notes/k1.excalidraw"]).toBe("x");
    expect(status).toHaveBeenLastCalledWith(false);
  });
});
