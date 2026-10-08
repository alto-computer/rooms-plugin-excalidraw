import type { PluginContext, RoomsPlugin } from "@alto-rooms/plugin-sdk";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// A stand-in for Excalidraw: records that its module loaded and that a board mounted.
const ex = vi.hoisted(() => ({ loaded: false, boards: 0 }));
vi.mock("./excalidraw", () => {
  ex.loaded = true;
  return {
    Excalidraw: ({ children }: { children?: unknown }) => {
      ex.boards++;
      return <div data-board>{children as never}</div>;
    },
    MainMenu: Object.assign(({ children }: { children?: unknown }) => <>{children as never}</>, {
      Item: () => null,
      Separator: () => null,
      DefaultItems: { ClearCanvas: () => null, ChangeCanvasBackground: () => null, Help: () => null },
    }),
    CaptureUpdateAction: { IMMEDIATELY: "IMMEDIATELY", NEVER: "NEVER" },
    exportToBlob: async () => new Blob(),
    getSceneVersion: (els: { version?: number }[]) => els.reduce((n, e) => n + (e.version ?? 0), 0),
    newElementWith: (e: object, u: object) => ({ ...e, ...u }),
  };
});

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

function fakeRooms(files: Record<string, string>) {
  let context: ((c: PluginContext) => void) | null = null;
  let changed: ((p: string) => void) | null = null;
  const rooms = {
    pluginId: "excalidraw",
    onContext: (cb: (c: PluginContext) => void) => ((context = cb), () => {}),
    onBeforeClose: () => () => {},
    storage: {
      read: async (p: string) => files[p] ?? null,
      write: async (p: string, t: string) => void (files[p] = t),
      list: async () => [],
      delete: async () => {},
      onChange: (cb: (p: string) => void) => ((changed = cb), () => {}),
    },
    rooms: { list: async () => [] },
    artifacts: { list: async () => [] },
    open: async () => {},
  } as unknown as RoomsPlugin;
  const openDoc = (fileKey: string) =>
    context!({ slot: "artifact.sidePanel", artifact: { roomId: "r", artifactId: fileKey, fileKey, title: fileKey, createdAt: "2026-10-08T00:00:00Z" } } as PluginContext);
  return { rooms, openDoc, changed: (p: string) => changed!(p) };
}

let root: Root;
let el: HTMLElement;
beforeEach(() => {
  ex.loaded = false;
  ex.boards = 0;
  vi.resetModules();
  el = document.createElement("div");
  document.body.append(el);
  root = createRoot(el);
});
afterEach(() => {
  act(() => root.unmount());
  el.remove();
});

const settle = () => act(async () => {
  for (let i = 0; i < 5; i++) await new Promise((r) => setTimeout(r, 0));
});

async function mount(files: Record<string, string>) {
  const { App } = await import("./App");
  const f = fakeRooms(files);
  act(() => root.render(<App rooms={f.rooms} />));
  act(() => f.openDoc("k"));
  await settle();
  return f;
}

const drawn = JSON.stringify({ type: "excalidraw", elements: [{ id: "a", type: "rectangle", version: 3 }] });

describe("App: Excalidraw loads only when there is a board", () => {
  it("a document with no notes shows the start surface and never loads Excalidraw", async () => {
    await mount({});
    expect(el.querySelector(".start")).not.toBeNull();
    expect(ex.loaded).toBe(false);
  });

  it("a click on the start surface brings up the board", async () => {
    await mount({});
    act(() => (el.querySelector(".start") as HTMLButtonElement).click());
    await settle();
    expect(el.querySelector("[data-board]")).not.toBeNull();
    expect(ex.loaded).toBe(true);
  });

  it("a document with notes opens straight on the board", async () => {
    await mount({ "notes/k.excalidraw": drawn });
    expect(el.querySelector("[data-board]")).not.toBeNull();
  });

  it("an agent drawing on an empty document brings up the board", async () => {
    const f = await mount({});
    act(() => f.changed("notes/k.ops.jsonl"));
    await settle();
    expect(el.querySelector("[data-board]")).not.toBeNull();
  });
});
