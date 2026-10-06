import type { PluginArtifact, PluginContext, RoomsPlugin } from "@alto-rooms/plugin-sdk";
import { CaptureUpdateAction, Excalidraw, MainMenu, exportToBlob, getSceneVersion, newElementWith } from "@excalidraw/excalidraw";
import type { ExcalidrawImperativeAPI } from "@excalidraw/excalidraw/types";
import "@excalidraw/excalidraw/index.css";
import { useEffect, useMemo, useRef, useState } from "react";
import { Notes, pngName, serializeScene, type Scene } from "./notes";
import { inView } from "./layout";
import { opsPath, type El } from "./ops";
import { nextStep, readOps, Serial, settled, syncStep, type OpsRead } from "./sync";

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

  /** Ids still fading in. Saves write them at full opacity. */
  const fading = useRef(new Set<string>());
  /** New elements (and their labels) fade in on board `a`. Steps aren't undo steps: only the drawing is. */
  const fadeIn = (a: ExcalidrawImperativeAPI, ids: readonly string[]) => {
    if (ids.length === 0) return;
    const set = new Set(ids);
    ids.forEach((id) => fading.current.add(id));
    const done = () => ids.forEach((id) => fading.current.delete(id));
    const start = performance.now();
    const step = () => {
      if (a !== api.current) return done(); // another document, or the panel closed
      const t = Math.min(1, (performance.now() - start) / FADE_MS);
      a.updateScene({
        elements: a
          .getSceneElementsIncludingDeleted()
          .map((e) => (set.has(e.id) || (e.type === "text" && e.containerId && set.has(e.containerId)) ? newElementWith(e, { opacity: Math.round(20 + 80 * t) }) : e)),
        captureUpdate: CaptureUpdateAction.NEVER,
      });
      if (t < 1) requestAnimationFrame(step);
      else done();
    };
    step();
  };

  /** Brings new drawing into view, unless some of it already is. */
  const reveal = (a: ExcalidrawImperativeAPI, ids: readonly string[]) => {
    const set = new Set(ids);
    const shown = a.getSceneElements().filter((e) => set.has(e.id));
    const st = a.getAppState();
    const view = { scrollX: st.scrollX, scrollY: st.scrollY, zoom: st.zoom.value, width: st.width, height: st.height };
    if (shown.length && !inView(shown, view)) a.scrollToContent(shown, { animate: true });
  };

  /** The open document's scene as a save writes it. */
  const save = (elements: readonly unknown[], appState: Record<string, unknown>, files: Record<string, unknown>, applied: number) => {
    const now = new Set(fading.current);
    notes.change(() => serializeScene({ elements: settled(elements as El[], now), appState, files, opsApplied: applied }));
  };

  const serial = useMemo(() => new Serial((e) => console.error("Excalidraw notes: couldn't apply the agent's drawing", e)), []);
  /** The board that has loaded its scene: before that, drawing on a board would be overwritten. */
  const loadedBoard = useRef<ExcalidrawImperativeAPI | null>(null);

  /** Applies what the draw tool appended since the last time, onto the live board. One at a time. */
  const sync = () =>
    serial.run(async () => {
      const key = openKey.current;
      const a = api.current;
      if (!key || !a || loadedBoard.current !== a) return;
      const step = await syncStep({
        key,
        isCurrent: () => key === openKey.current && a === api.current,
        read: rooms.storage.read,
        elements: () => a.getSceneElementsIncludingDeleted() as unknown as El[],
        applied: () => opsApplied.current,
      });
      if (step.kind === "none") return;
      if (step.kind === "count") {
        // Nothing changes on the board, but the count must be saved.
        opsApplied.current = step.applied;
        save(a.getSceneElements(), a.getAppState() as never, a.getFiles(), step.applied);
        return;
      }
      const r = step.replayed;
      // Excalidraw's onChange saves it, with the new opsApplied; counted only once the scene took it.
      a.updateScene({ elements: r.elements as never, captureUpdate: CaptureUpdateAction.IMMEDIATELY });
      opsApplied.current = r.applied;
      reveal(a, r.added);
      fadeIn(a, r.added);
      showDrawing();
    });

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
        const read: OpsRead = r.ok ? await readOps(rooms.storage.read, key) : { ok: false };
        if (mine !== seq) return;
        if (!r.ok) {
          version.current = -1;
          setView({ kind: "broken" });
          return;
        }
        let scene: Scene = r.scene ?? { elements: [], appState: {}, files: {}, opsApplied: 0 };
        try {
          // What agents drew while the panel was closed goes in before the board shows.
          const step = nextStep(read, scene.elements as El[], scene.opsApplied);
          if (step.kind !== "none") {
            scene = step.kind === "draw" ? { ...scene, elements: step.replayed.elements, opsApplied: step.replayed.applied } : { ...scene, opsApplied: step.applied };
            const next = scene;
            notes.change(() => serializeScene(next));
            if (step.kind === "draw") showDrawing();
          }
        } catch (e) {
          // The notes still open as they were; the next sync tries again.
          console.error("Excalidraw notes: couldn't apply the agent's drawing", e);
        }
        opsApplied.current = scene.opsApplied;
        version.current = getSceneVersion(scene.elements as never);
        openKey.current = key;
        setView({ kind: "ready", scene, key });
      })();
    });
    const offData = rooms.storage.onChange((path) => {
      if (openKey.current && path === opsPath(openKey.current)) void sync();
    });
    const offClose = rooms.onBeforeClose(async () => {
      try {
        await serial.idle();
      } finally {
        await notes.flush();
      }
    });
    return () => {
      offContext();
      offData();
      offClose();
    };
    // sync, save and showDrawing use only refs, state setters, rooms, notes and serial: the first render's copies stay right.
  }, [rooms, notes, serial]);

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
        excalidrawAPI={(a) => (api.current = a)}
        initialData={{
          elements: (view.scene?.elements ?? []) as never,
          appState: { ...(view.scene?.appState ?? {}), theme: "light" },
          files: (view.scene?.files ?? {}) as never,
          scrollToContent: true,
        }}
        onChange={(elements, appState, files) => {
          if (api.current && loadedBoard.current !== api.current) {
            // A board's first change comes once its scene has loaded: catch up on what was appended meanwhile.
            loadedBoard.current = api.current;
            void sync();
          }
          const v = getSceneVersion(elements);
          if (v === version.current) return; // nothing drawn since the last save or the load
          version.current = v;
          save(elements, appState as unknown as Record<string, unknown>, files, opsApplied.current);
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

