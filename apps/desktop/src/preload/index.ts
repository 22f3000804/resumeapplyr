import { contextBridge, ipcRenderer, type IpcRendererEvent } from "electron";
import type { Bridge, PushChannel } from "../shared/rpc";

const CHANNELS: PushChannel[] = ["changed", "run-event", "runner", "question"];

const bridge: Bridge = {
  call: (method, ...args) => ipcRenderer.invoke("rpc", method, ...args),
  on(channel, listener) {
    if (!CHANNELS.includes(channel)) throw new Error(`Unknown channel ${channel}`);
    const wrapped = (_event: IpcRendererEvent, payload: unknown) => listener(payload);
    ipcRenderer.on(channel, wrapped);
    return () => ipcRenderer.removeListener(channel, wrapped);
  },
};

contextBridge.exposeInMainWorld("resumeapplyr", bridge);
