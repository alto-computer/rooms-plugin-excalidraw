# Changelog

## 0.3.0

Requires Alto Rooms 0.7.1.

- The panel follows the app's theme, light or dark. Excalidraw switches with the app, and the panel, the board's background and Excalidraw's bars take the app's colours.
- The board's themed background is display only. The notes file keeps the background it had, and **Export PNG** still exports on that background (white unless you chose one) in light colours.
- The side panel shows a palette icon.
- Excalidraw loads only once a document has a drawing. An empty document shows **Click to sketch**.
- Built on `@alto-rooms/plugin-sdk` 0.7.0.

## 0.2.0

- Agents can draw into a document's notes with the `draw` tool. Requires Alto Rooms 0.5.0.

## 0.1.1

- Faster loading and deferred saving.

## 0.1.0

- Excalidraw notes beside any document, saved as you draw, with PNG export.
