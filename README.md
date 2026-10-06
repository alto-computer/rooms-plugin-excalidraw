# Excalidraw notes for Alto Rooms

Sketch next to any document in [Alto Rooms](https://github.com/alto-computer/alto-rooms) with [Excalidraw](https://github.com/excalidraw/excalidraw). Notes stay with the document and export as PNG.

Excalidraw notes ships with Alto Rooms 0.4.0 and later. It is on by default; right-click it in the sidebar to turn it off.

## Use

- Open a document and click **Notes** at its top right. The panel opens beside the document; drag its edge to resize.
- Everything you draw saves as you go.
- **Export PNG** is in the menu (☰).

## Data

Each document's notes are one standard `.excalidraw` file:

```text
~/rooms/.rooms/plugins/excalidraw/data/notes/<fileKey>.excalidraw
```

`fileKey` identifies the document's original file, so notes follow a document when it moves to another room, and every room that links the same file shares them. You can open the files on excalidraw.com too.

A notes file that can't be read is never overwritten: the panel asks before starting over and keeps a copy.

## Develop

```sh
bun install
bun run test
bun run build          # → dist/, with Excalidraw's fonts (plugins have no network)
```

To try a build in the app, copy `dist/` to `~/rooms/.rooms/plugins/excalidraw/` (delete the `.bundled` file there too; otherwise the next app update replaces your build). See the [plugin guide](https://github.com/alto-computer/alto-rooms/blob/main/docs/plugins.md).

## License

MIT. Excalidraw is MIT; its fonts keep their own licenses (OFL).
