import { BrowserWindow } from "electron";
import type { PdfRenderer } from "../services/context";

/** Prints HTML to PDF in a hidden, script-free window. */
export function createPdfRenderer(): PdfRenderer {
  return {
    async render(html, paperSize) {
      const win = new BrowserWindow({
        show: false,
        webPreferences: { sandbox: true, javascript: false, contextIsolation: true, nodeIntegration: false },
      });
      win.webContents.on("will-navigate", (event) => event.preventDefault());
      try {
        await win.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`);
        return await win.webContents.printToPDF({ pageSize: paperSize, printBackground: true, preferCSSPageSize: true });
      } finally {
        win.destroy();
      }
    },
  };
}
