/*
 * The board shows the app's pane colour behind a drawing whose background is Excalidraw's default:
 * the canvas is transparent and the panel's `--rooms-bg` shows through (dark mode inverts the
 * canvas, so a colour painted on it would come out inverted). That is display only. The notes file
 * keeps the background it had, and a PNG exports on it, white by default, as before.
 */

export const DEFAULT_BACKGROUND = "#ffffff";
export const THEMED = "transparent";

/** What the board shows for the background `saved` in the notes file. */
export const shownBackground = (saved: unknown): string =>
  typeof saved === "string" && saved.toLowerCase() !== DEFAULT_BACKGROUND ? saved : THEMED;

/** What the notes file keeps when the board shows `shown`: the themed canvas stands for the background it was opened with. */
export const savedBackground = (shown: unknown, saved: unknown): unknown => (shown === THEMED ? saved : shown);
