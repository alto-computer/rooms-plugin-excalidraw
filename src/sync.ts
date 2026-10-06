/*
 * Keeping the open board in step with the draw tool's ops file: what to do after a read, one
 * sync at a time, and what a save writes while new drawing is still fading in.
 */
import { opsPath, replay, type El, type Replayed } from "./ops";

/** An ops file read: its text (null when there is no file yet), or a failed read. */
export type OpsRead = { ok: true; text: string | null } | { ok: false };

export async function readOps(read: (path: string) => Promise<string | null>, fileKey: string): Promise<OpsRead> {
  try {
    return { ok: true, text: await read(opsPath(fileKey)) };
  } catch {
    return { ok: false };
  }
}

export type Step =
  /** Nothing to do. A failed read is this too: the count stays, and the next sync tries again. */
  | { kind: "none" }
  /** New lines drew nothing (bad lines, held edges), or the file is gone: only the count changes. */
  | { kind: "count"; applied: number }
  | { kind: "draw"; replayed: Replayed };

export function nextStep(read: OpsRead, elements: readonly El[], applied: number): Step {
  if (!read.ok) return { kind: "none" };
  const r = replay(elements, read.text, applied);
  if (r.changed) return { kind: "draw", replayed: r };
  return r.applied !== applied ? { kind: "count", applied: r.applied } : { kind: "none" };
}

/**
 * Reads the ops file of `key`, then decides against the board and count as they are by then.
 * Nothing, when another document opened (or the board changed) during the read.
 */
export async function syncStep(o: {
  key: string;
  isCurrent: () => boolean;
  read: (path: string) => Promise<string | null>;
  elements: () => readonly El[];
  applied: () => number;
}): Promise<Step> {
  const read = await readOps(o.read, o.key);
  if (!o.isCurrent()) return { kind: "none" };
  return nextStep(read, o.elements(), o.applied());
}

/** Runs tasks one after another. A task that throws is reported and the next one still runs. */
export class Serial {
  private chain = Promise.resolve();

  constructor(private onError: (e: unknown) => void) {}

  run(task: () => Promise<void>): Promise<void> {
    this.chain = this.chain.then(task).catch(this.onError);
    return this.chain;
  }

  /** Resolves once every task so far has finished; never rejects. */
  idle(): Promise<void> {
    return this.chain;
  }
}

/** The elements as they will look once `fading` (and their labels) have faded in. */
export function settled(elements: readonly El[], fading: ReadonlySet<string>): readonly El[] {
  if (fading.size === 0) return elements;
  return elements.map((e) => (fading.has(e.id) || (e.containerId && fading.has(e.containerId)) ? { ...e, opacity: 100 } : e));
}
