import type { PluginArtifact, PluginContext, RoomsPlugin } from "@alto-rooms/plugin-sdk";
import { Excalidraw, MainMenu, exportToBlob, getSceneVersion } from "@excalidraw/excalidraw";
import type { ExcalidrawImperativeAPI } from "@excalidraw/excalidraw/types";
import "@excalidraw/excalidraw/index.css";
import { useEffect, useMemo, useRef, useState } from "react";
import { Notes, pngName, serializeScene, type Scene } from "./notes";

const SAVE_DELAY_MS = 400;

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
  const api = useRef<ExcalidrawImperativeAPI | null>(null);
  const version = useRef(-1);
  const notes = useMemo(() => new Notes(rooms.storage, SAVE_DELAY_MS, setFailing), [rooms]);

  useEffect(() => {
    let seq = 0;
    const offContext = rooms.onContext((ctx: PluginContext) => {
      if (ctx.slot !== "artifact.sidePanel") return;
      const mine = ++seq;
      setDoc(ctx.artifact);
      setView({ kind: "loading" });
      void notes.open(ctx.artifact.fileKey).then((r) => {
        if (mine !== seq) return;
        version.current = r.ok ? getSceneVersion((r.scene?.elements ?? []) as never) : -1;
        setView(r.ok ? { kind: "ready", scene: r.scene, key: ctx.artifact.fileKey } : { kind: "broken" });
      });
    });
    const offClose = rooms.onBeforeClose(() => notes.flush());
    return () => {
      offContext();
      offClose();
    };
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
          const v = getSceneVersion(elements);
          if (v === version.current) return; // nothing drawn since the last save or the load
          version.current = v;
          notes.change(serializeScene({ elements, appState: appState as unknown as Record<string, unknown>, files }));
        }}
        UIOptions={{
          canvasActions: { loadScene: false, saveToActiveFile: false, export: false, saveAsImage: false, toggleTheme: false },
          tools: { image: true },
        }}
        renderTopRightUI={() =>
          failing ? (
            <button type="button" className="warn" onClick={() => void notes.flush()}>
              Not saved · Retry
            </button>
          ) : null
        }
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
