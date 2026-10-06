import { connect } from "@alto-rooms/plugin-sdk";
import "./styles.css";

// Excalidraw loads its fonts from <asset path>/fonts/. The plugin can't reach the network, so they ship beside it.
(window as unknown as { EXCALIDRAW_ASSET_PATH: string }).EXCALIDRAW_ASSET_PATH = new URL("./", location.href).href;

const [rooms, { App }, { createRoot }] = await Promise.all([connect(), import("./App"), import("react-dom/client")]);
createRoot(document.getElementById("root")!).render(<App rooms={rooms} />);
