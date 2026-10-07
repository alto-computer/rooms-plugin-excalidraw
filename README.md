# Excalidraw notes for Alto Rooms

Sketch next to any document in [Alto Rooms](https://github.com/alto-computer/alto-rooms) with [Excalidraw](https://github.com/excalidraw/excalidraw), or let an agent draw there. Notes stay with the document and export as PNG.

Excalidraw notes ships with Alto Rooms 0.4.0 and later; agents can draw from Alto Rooms 0.5.0. It is on by default; right-click it in the sidebar to turn it off.

## Use

- Open a document and click **Notes** at its top right. The panel opens beside the document; drag its edge to resize.
- Everything you draw saves as you go.
- **Export PNG** is in the menu (☰).

## Let an agent draw

The plugin gives agents a `draw` tool (through Rooms' MCP server, as `excalidraw__draw`). The agent describes boxes and arrows by id; the panel lays them out, right of what is already there, and shows **Drawing…** while it adds them. Calls made while the panel is closed are drawn the next time it opens. The agent can't see the board, so the tool asks for small steps:

```json
{ "doc": "<fileKey>", "direction": "TB", "ops": [
  { "op": "node", "id": "api", "label": "API", "color": "purple" },
  { "op": "node", "id": "db", "label": "Database", "color": "teal" },
  { "op": "edge", "from": "api", "to": "db", "label": "reads" }
] }
```

Ops: `node` (sending an id again updates it), `edge` (waits until both nodes exist), `frame` (groups nodes), `delete` (by id), `clear` (erases only what the tool drew).

## Data

Each document's notes are one standard `.excalidraw` file:

```text
~/rooms/.rooms/plugins/excalidraw/data/notes/<fileKey>.excalidraw
```

Agent calls land beside it, one line per call, in `notes/<fileKey>.ops.jsonl`. The `.excalidraw` file remembers how many of those lines it already shows (`rooms.opsApplied`).

`fileKey` identifies the document's original file, so notes follow a document when it moves to another room, and every room that links the same file shares them. You can open the files on excalidraw.com too.

A notes file that can't be read is never overwritten: the panel asks before starting over and keeps a copy.

## Develop

`@alto-rooms/plugin-sdk` comes from the `plugin-sdk-v0.2.0` release tarball. Requires Alto Rooms 0.5.0.

```sh
bun install
bun run test
bun run build          # → dist/, with Excalidraw's fonts (plugins have no network)
```

To try a build in the app, copy `dist/` to `~/rooms/.rooms/plugins/excalidraw/` (delete the `.bundled` file there too; otherwise the next app update replaces your build). See the [plugin guide](https://github.com/alto-computer/alto-rooms/blob/main/docs/plugins.md).

## License

MIT. Excalidraw is MIT; its fonts keep their own licenses (OFL).
