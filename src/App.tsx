import type { PluginArtifact, PluginContext, RoomsPlugin } from "@alto-rooms/plugin-sdk";
import { CaptureUpdateAction, Excalidraw, MainMenu, exportToBlob, getSceneVersion, newElementWith } from "@excalidraw/excalidraw";
import type { ExcalidrawImperativeAPI } from "@excalidraw/excalidraw/types";
import "@excalidraw/excalidraw/index.css";
import { useEffect, useMemo, useRef, useState } from "react";
import { Notes, pngName, serializeScene, type Scene } from "./notes";
import { opsPath, replay, type El } from "./ops";

const SAVE_DELAY_MS = 400;
/** How long "Drawing…" shows after an agent's drawing arrives. */
const DRAWING_BADGE_MS = 2000;
const FADE_MS = 300;

const DOWNLOAD_ICON = (
  <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.25" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
    <path d="M10 3v10M6 9l4 4 4-4M4 16h12" />
  </svg>
);

type View = { kind: "loading" } | { kind: "broken" } | { kind: "ready"; scene: Scene | null; key: string };

export function App({ rooms }: { rooms: RoomsPlugin }) {
  const [doc, setDoc] = useState<PluginArtifact | null>(null);
  const [view, setView] = useState<View>({ kind: "loading" });
  const [failing, setFailing] = useState(false);
  const [drawing, setDrawing] = useState(false);
  const api = useRef<ExcalidrawImperativeAPI | null>(null);
  const version = useRef(-1);
  /** The open document's fileKey while its notes can be drawn on; null while loading or broken. */
  const openKey = useRef<string | null>(null);
  /** Lines of the open document's ops file already in its scene; saved with it. */
  const opsApplied = useRef(0);
  const notes = useMemo(() => new Notes(rooms.storage, SAVE_DELAY_MS, setFailing), [rooms]);

  const drawingTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const showDrawing = () => {
    setDrawing(true);
    if (drawingTimer.current) clearTimeout(drawingTimer.current);
    drawingTimer.current = setTimeout(() => setDrawing(false), DRAWING_BADGE_MS);
  };

  /** Applies what the draw tool appended since the last time, onto the live board. One at a time. */
  const syncing = useRef(Promise.resolve());
  const sync = () => {
    syncing.current = syncing.current.then(async () => {
      const key = openKey.current;
      const a = api.current;
      if (!key || !a) return;
      const text = await rooms.storage.read(opsPath(key)).catch(() => null);
      if (key !== openKey.current || a !== api.current) return;
      const r = replay(a.getSceneElementsIncludingDeleted() as unknown as El[], text, opsApplied.current);
      if (r.applied === opsApplied.current && !r.changed) return;
      opsApplied.current = r.applied;
      if (r.changed) {
        // Excalidraw's onChange saves it, with the new opsApplied.
        a.updateScene({ elements: r.elements as never, captureUpdate: CaptureUpdateAction.IMMEDIATELY });
        fadeIn(a, new Set(r.added));
        showDrawing();
      } else {
        // Only lines that drew nothing: nothing changes on the board, but the count must be saved.
        const applied = r.applied;
        notes.change(() => serializeScene({ elements: a.getSceneElements(), appState: a.getAppState() as never, files: a.getFiles(), opsApplied: applied }));
      }
    });
    return syncing.current;
  };

  useEffect(() => {
    let seq = 0;
    const offContext = rooms.onContext((ctx: PluginContext) => {
      if (ctx.slot !== "artifact.sidePanel") return;
      const mine = ++seq;
      const key = ctx.artifact.fileKey;
      openKey.current = null;
      api.current = null; // the board unmounts while the next document loads
      setDoc(ctx.artifact);
      setView({ kind: "loading" });
      void (async () => {
        const r = await notes.open(key);
        const text = r.ok ? await rooms.storage.read(opsPath(key)).catch(() => null) : null;
        if (mine !== seq) return;
        if (!r.ok) {
          version.current = -1;
          setView({ kind: "broken" });
          return;
        }
        // What agents drew while the panel was closed goes in before the board shows.
        const scene = r.scene ?? { elements: [], appState: {}, files: {}, opsApplied: 0 };
        const drawn = replay(scene.elements as El[], text, scene.opsApplied);
        const next = { ...scene, elements: drawn.elements, opsApplied: drawn.applied };
        opsApplied.current = drawn.applied;
        if (drawn.changed || drawn.applied !== scene.opsApplied) notes.change(() => serializeScene(next));
        if (drawn.changed) showDrawing();
        version.current = getSceneVersion(next.elements as never);
        openKey.current = key;
        setView({ kind: "ready", scene: next, key });
      })();
    });
    const offData = rooms.storage.onChange((path) => {
      if (openKey.current && path === opsPath(openKey.current)) void sync();
    });
    const offClose = rooms.onBeforeClose(async () => {
      await syncing.current;
      await notes.flush();
    });
    return () => {
      offContext();
      offData();
      offClose();
    };
    // sync and showDrawing use only refs, state setters, rooms and notes: the first render's copies stay right.
  }, [rooms, notes]);

  const exportPng = async () => {
    const a = api.current;
    if (!a || !doc) return;
    const elements = a.getSceneElements();
    if (elements.length === 0) return;
    const blob = await exportToBlob({
      elements,
      files: a.getFiles(),
      appState: { ...a.getAppState(), exportBackground: true },
      mimeType: "image/png",
      exportPadding: 16,
    });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = pngName(doc.title);
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };

  if (view.kind === "loading") return <div className="blank" />;
  if (view.kind === "broken") {
    return (
      <div className="message">
        <p>These notes can't be read.</p>
        <p className="muted">They stay as they are until you start over. A copy is kept beside them.</p>
        <button
          type="button"
          onClick={async () => {
            await notes.startOver();
            version.current = 0;
            opsApplied.current = 0;
            openKey.current = doc?.fileKey ?? null;
            setView({ kind: "ready", scene: null, key: `${doc?.fileKey}-fresh` });
          }}
        >
          Start over
        </button>
      </div>
    );
  }

  return (
    <div className="board">
      <Excalidraw
        key={view.key}
        excalidrawAPI={(a) => {
          api.current = a;
          // Catches up on anything appended while the board was loading.
          void sync();
        }}
        initialData={{
          elements: (view.scene?.elements ?? []) as never,
          appState: { ...(view.scene?.appState ?? {}), theme: "light" },
          files: (view.scene?.files ?? {}) as never,
          scrollToContent: true,
        }}
        onChange={(elements, appState, files) => {
          const v = getSceneVersion(elements);
          if (v === version.current) return; // nothing drawn since the last save or the load
          version.current = v;
          const applied = opsApplied.current;
          notes.change(() => serializeScene({ elements, appState: appState as unknown as Record<string, unknown>, files, opsApplied: applied }));
        }}
        UIOptions={{
          canvasActions: { loadScene: false, saveToActiveFile: false, export: false, saveAsImage: false, toggleTheme: false },
          tools: { image: true },
        }}
        renderTopRightUI={() => (
          <>
            {drawing ? (
              <span className="drawing" role="status">
                Drawing…
              </span>
            ) : null}
            {failing ? (
              <button type="button" className="warn" onClick={() => void notes.flush()}>
                Not saved · Retry
              </button>
            ) : null}
          </>
        )}
      >
        <MainMenu>
          <MainMenu.Item onSelect={() => void exportPng()} icon={DOWNLOAD_ICON}>
            Export PNG
          </MainMenu.Item>
          <MainMenu.Separator />
          <MainMenu.DefaultItems.ClearCanvas />
          <MainMenu.DefaultItems.ChangeCanvasBackground />
          <MainMenu.DefaultItems.Help />
        </MainMenu>
      </Excalidraw>
    </div>
  );
}

/** New elements (and their labels) fade in. Steps aren't undo steps: only the drawing itself is. */
function fadeIn(a: ExcalidrawImperativeAPI, ids: Set<string>) {
  if (ids.size === 0) return;
  const start = performance.now();
  const step = () => {
    const t = Math.min(1, (performance.now() - start) / FADE_MS);
    a.updateScene({
      elements: a
        .getSceneElementsIncludingDeleted()
        .map((e) => (ids.has(e.id) || (e.type === "text" && e.containerId && ids.has(e.containerId)) ? newElementWith(e, { opacity: Math.round(20 + 80 * t) }) : e)),
      captureUpdate: CaptureUpdateAction.NEVER,
    });
    if (t < 1) requestAnimationFrame(step);
  };
  step();
}
