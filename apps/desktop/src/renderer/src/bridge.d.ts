import type { Bridge } from "../../shared/rpc";

declare global {
  interface Window {
    /** Exposed by the preload script; the window's only way to reach the main process. */
    resumeapplyr: Bridge;
  }
}
