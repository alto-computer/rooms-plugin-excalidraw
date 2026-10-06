/*
 * Notes per document: data/notes/<fileKey>.excalidraw, the standard Excalidraw file format.
 * The fileKey stays the same when Rooms moves a document, so notes follow it.
 */

export interface Scene {
  elements: readonly Record<string, unknown>[];
  appState: Record<string, unknown>;
  files: Record<string, unknown>;
}

export const notePath = (fileKey: string) => `notes/${fileKey}.excalidraw`;

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

/** `null` (no notes yet) is an empty scene; anything that isn't an Excalidraw scene is refused. */
export function parseScene(text: string | null): { ok: true; scene: Scene | null } | { ok: false } {
  if (text === null) return { ok: true, scene: null };
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return { ok: false };
  }
  if (!isObj(raw) || !Array.isArray(raw.elements)) return { ok: false };
  return {
    ok: true,
    scene: {
      elements: raw.elements.filter(isObj),
      appState: isObj(raw.appState) ? raw.appState : {},
      files: isObj(raw.files) ? raw.files : {},
    },
  };
}

/** What is drawn, as an .excalidraw file: live elements, the images they use, the background. */
export function serializeScene(s: {
  elements: readonly unknown[];
  appState: Record<string, unknown>;
  files: Record<string, unknown>;
}): string {
  const elements = s.elements.filter((e): e is Record<string, unknown> => isObj(e) && e.isDeleted !== true);
  const used = new Set(elements.map((e) => e.fileId).filter((f): f is string => typeof f === "string"));
  const files = Object.fromEntries(Object.entries(s.files).filter(([id]) => used.has(id)));
  const appState = typeof s.appState.viewBackgroundColor === "string" ? { viewBackgroundColor: s.appState.viewBackgroundColor } : {};
  return JSON.stringify({ type: "excalidraw", version: 2, source: "rooms-plugin-excalidraw", elements, appState, files });
}

export function pngName(title: string): string {
  const base = title.replace(/[\\/:*?"<>|]/g, "-").trim();
  return base ? `${base} notes.png` : "notes.png";
}

interface Storage {
  read(path: string): Promise<string | null>;
  write(path: string, text: string): Promise<void>;
}

/** The notes of the document in the panel: loads them, saves changes debounced, flushes on switch. */
export class Notes {
  private path: string | null = null;
  private brokenText: string | null = null;
  private pending: { path: string; text: string } | null = null;
  private timer: ReturnType<typeof setTimeout> | null = null;

  constructor(
    private storage: Storage,
    private delayMs: number,
    private onFailing: (failing: boolean) => void = () => {},
  ) {}

  /** Saves what is pending for the current document, then reads `fileKey`'s notes. */
  async open(fileKey: string) {
    await this.flush();
    this.path = notePath(fileKey);
    const text = await this.storage.read(this.path);
    const r = parseScene(text);
    this.brokenText = r.ok ? null : text;
    return r;
  }

  /** A new serialized scene for the open document. Ignored while its notes can't be read. */
  change(text: string) {
    if (!this.path || this.brokenText !== null) return;
    this.pending = { path: this.path, text };
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => void this.flush(), this.delayMs);
  }

  async flush() {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    const p = this.pending;
    if (!p) return;
    this.pending = null;
    try {
      await this.storage.write(p.path, p.text);
      this.onFailing(false);
    } catch {
      if (!this.pending) this.pending = p;
      this.onFailing(true);
    }
  }

  /** Keeps a copy of notes that can't be read beside them, and lets new notes replace them. */
  async startOver() {
    if (!this.path || this.brokenText === null) return;
    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    await this.storage.write(this.path.replace(/\.excalidraw$/, `.broken-${stamp}.excalidraw`), this.brokenText);
    this.brokenText = null;
  }
}
