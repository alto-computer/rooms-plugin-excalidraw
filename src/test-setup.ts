// jsdom has no canvas. Excalidraw measures text with a 2D context when it loads and when it sizes
// labels, so tests get a stand-in that measures every character as 8px wide.
HTMLCanvasElement.prototype.getContext = function () {
  return new Proxy(
    { measureText: (t: string) => ({ width: t.length * 8, actualBoundingBoxAscent: 10, actualBoundingBoxDescent: 3 }) },
    { get: (target, key) => (key in target ? target[key as keyof typeof target] : () => {}) },
  );
} as never;

// Nor FontFace: Excalidraw registers its fonts on first use.
(globalThis as { FontFace?: unknown }).FontFace ??= class {
  constructor(public family: string) {}
  load() {
    return Promise.resolve(this);
  }
};
