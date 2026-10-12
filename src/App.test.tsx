import type { PluginContext, RoomsPlugin, RoomsTheme } from "@alto-rooms/plugin-sdk";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// A stand-in for Excalidraw: records that its module loaded, that a board mounted, and the props it last got.
type BoardProps = {
  theme?: string;
  initialData: { appState: Record<string, unknown> };
  onChange: (elements: unknown[], appState: Record<string, unknown>, files: Record<string, unknown>) => void;
  excalidrawAPI: (api: unknown) => void;
};
// `appState` is what the board's API reports; `exported` is the appState each PNG export was asked for.
const ex = vi.hoisted(() => ({
  loaded: false,
  boards: 0,
  props: null as BoardProps | null,
  appState: {} as Record<string, unknown>,
  exportPng: null as (() => void) | null,
  exported: [] as Record<string, unknown>[],
}));
vi.mock("./excalidraw", () => {
  ex.loaded = true;
  return {
    Excalidraw: (props: BoardProps & { children?: unknown }) => {
      ex.boards++;
      ex.props = props;
      props.excalidrawAPI({
        getSceneElements: () => [{ id: "a", type: "rectangle", version: 3 }],
        getAppState: () => ex.appState,
        getFiles: () => ({}),
      });
      const { children } = props;
      return <div data-board>{children as never}</div>;
    },
    MainMenu: Object.assign(({ children }: { children?: unknown }) => <>{children as never}</>, {
      Item: ({ onSelect, children }: { onSelect: () => void; children?: unknown }) => {
        if (children === "Export PNG") ex.exportPng = onSelect;
        return null;
      },
      Separator: () => null,
      DefaultItems: { ClearCanvas: () => null, ChangeCanvasBackground: () => null, Help: () => null },
    }),
    CaptureUpdateAction: { IMMEDIATELY: "IMMEDIATELY", NEVER: "NEVER" },
    exportToBlob: async ({ appState }: { appState: Record<string, unknown> }) => (ex.exported.push(appState), new Blob()),
    getSceneVersion: (els: { version?: number }[]) => els.reduce((n, e) => n + (e.version ?? 0), 0),
    newElementWith: (e: object, u: object) => ({ ...e, ...u }),
  };
});

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

function fakeRooms(files: Record<string, string>, theme: RoomsTheme | null) {
  let context: ((c: PluginContext) => void) | null = null;
  let changed: ((p: string) => void) | null = null;
  const themed = new Set<(t: RoomsTheme) => void>();
  const rooms = {
    pluginId: "excalidraw",
    theme: {
      current: () => theme,
      onChange: (cb: (t: RoomsTheme) => void) => {
        themed.add(cb);
        if (theme) cb(theme);
        return () => void themed.delete(cb);
      },
    },
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
  const setTheme = (t: RoomsTheme) => {
    theme = t;
    themed.forEach((cb) => cb(t));
  };
  return { rooms, openDoc, changed: (p: string) => changed!(p), setTheme };
}

let root: Root;
let el: HTMLElement;
beforeEach(() => {
  ex.loaded = false;
  ex.boards = 0;
  ex.props = null;
  ex.appState = {};
  ex.exportPng = null;
  ex.exported = [];
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

async function mount(files: Record<string, string>, theme: RoomsTheme | null = null) {
  const { App } = await import("./App");
  const f = fakeRooms(files, theme);
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

const dark: RoomsTheme = { scheme: "dark", tokens: { bg: "#211c19" } };
const light: RoomsTheme = { scheme: "light", tokens: { bg: "#f8f4ee" } };
const withBackground = (bg: string) => JSON.stringify({ type: "excalidraw", elements: [{ id: "a", type: "rectangle", version: 3 }], appState: { viewBackgroundColor: bg } });

describe("App: the board follows the app's theme", () => {
  it("opens in the app's scheme and switches when the app's appearance changes", async () => {
    const f = await mount({ "notes/k.excalidraw": drawn }, dark);
    expect(ex.props?.theme).toBe("dark");
    act(() => f.setTheme(light));
    expect(ex.props?.theme).toBe("light");
    act(() => f.setTheme(dark));
    expect(ex.props?.theme).toBe("dark");
  });

  it("is light before the app has sent a theme", async () => {
    await mount({ "notes/k.excalidraw": drawn });
    expect(ex.props?.theme).toBe("light");
  });

  it("does not save when only the app's theme changes", async () => {
    const files: Record<string, string> = { "notes/k.excalidraw": withBackground("#ffffff") };
    const before = files["notes/k.excalidraw"];
    const f = await mount(files, dark);
    const write = vi.spyOn(f.rooms.storage, "write");
    act(() => f.setTheme(light));
    // Excalidraw reports the switch as a change of its appState; nothing on the board changed.
    act(() => ex.props!.onChange([{ id: "a", type: "rectangle", version: 3 }], { ...ex.props!.initialData.appState, theme: "light" }, {}));
    await act(() => new Promise((r) => setTimeout(r, 500)));
    expect(write).not.toHaveBeenCalled();
    expect(files["notes/k.excalidraw"]).toBe(before);
  });
});

describe("App: the background", () => {
  beforeEach(() => {
    URL.createObjectURL = () => "blob:png";
    URL.revokeObjectURL = () => {};
    vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});
  });

  /**
   * Opens a drawing saved on `bg`, then draws with the background `picked` (unchanged when absent).
   * Returns what the board showed on open, what the edit saved, and what Export PNG painted.
   */
  async function roundTrip(bg: string, picked?: string) {
    const files: Record<string, string> = { "notes/k.excalidraw": withBackground(bg) };
    await mount(files, dark);
    const shown = ex.props!.initialData.appState;
    const now = picked === undefined ? shown : { ...shown, viewBackgroundColor: picked };
    act(() => ex.props!.onChange([{ id: "a", type: "rectangle", version: 4 }], now, {}));
    await act(() => new Promise((r) => setTimeout(r, 500)));
    ex.appState = now;
    await act(async () => ex.exportPng!());
    return {
      shown: shown.viewBackgroundColor,
      saved: JSON.parse(files["notes/k.excalidraw"]).appState.viewBackgroundColor,
      exported: ex.exported[0]?.viewBackgroundColor,
    };
  }

  it("shows the pane through the default white, and saves and exports white", async () => {
    const r = await roundTrip("#ffffff");
    expect(r.shown).not.toBe("#ffffff");
    expect(r.shown).toMatch(/^#[0-9a-f]{6}00$/);
    expect(r.saved).toBe("#ffffff");
    expect(r.exported).toBe("#ffffff");
  });

  it("keeps a transparent background the user chose, in the file and in the PNG", async () => {
    expect(await roundTrip("transparent")).toEqual({ shown: "transparent", saved: "transparent", exported: "transparent" });
  });

  it("keeps transparent when the user picks it on a default white board", async () => {
    const r = await roundTrip("#ffffff", "transparent");
    expect(r.saved).toBe("transparent");
    expect(r.exported).toBe("transparent");
  });

  it("keeps a colour the user picks on a default white board", async () => {
    const r = await roundTrip("#ffffff", "#a5d8ff");
    expect(r.saved).toBe("#a5d8ff");
    expect(r.exported).toBe("#a5d8ff");
  });

  it("keeps a colour the user chose", async () => {
    expect(await roundTrip("#ffc9c9")).toEqual({ shown: "#ffc9c9", saved: "#ffc9c9", exported: "#ffc9c9" });
  });
});
