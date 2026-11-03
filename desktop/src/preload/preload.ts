import { contextBridge, ipcRenderer, webUtils } from "electron";

// The renderer's only door to the app: invoke(command, input) and a batched event stream (spec §4.6).

type Listener = (batch: { type: string; payload: unknown; rev: number }[]) => void;
const listeners = new Set<Listener>();
ipcRenderer.on("muse:events", (_e, batch) => {
  for (const l of listeners) l(batch);
});

contextBridge.exposeInMainWorld("muse", {
  invoke: (command: string, input?: unknown) => ipcRenderer.invoke("muse:cmd", command, input ?? {}),
  onEvents: (cb: Listener) => {
    listeners.add(cb);
    return () => listeners.delete(cb);
  },
  pathForFile: (file: File) => {
    try {
      return webUtils.getPathForFile(file);
    } catch {
      return "";
    }
  },
  platform: process.platform,
});
