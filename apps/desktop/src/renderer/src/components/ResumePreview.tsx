// The CV as it will print, drawn at paper width and scaled to fit. Scripts can't run inside the
// frame, and it ignores the pointer so links in the CV can't navigate it.
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import type { PreviewTarget } from "../../../shared/rpc";
import { call, errorMessage, useRpc } from "../api";

const PAPER_WIDTH_PX = { A4: (210 / 25.4) * 96, Letter: 8.5 * 96 } as const;
const PAPER_HEIGHT_PX = { A4: (297 / 25.4) * 96, Letter: 11 * 96 } as const;
// The template's page margins come from @page, which the screen ignores; add them back here.
const SCREEN_CSS = "<style>@media screen{html{background:#fff}body{padding:13mm 15mm 15mm;box-sizing:border-box}}</style>";

export function ResumePreview({ target, debounceMs = 0, caption }: { target: PreviewTarget; debounceMs?: number; caption?: string }) {
  const settings = useRpc("settings.get", [], ["settings"]);
  const paper = settings.data?.paperSize ?? "A4";
  const [html, setHtml] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const key = JSON.stringify(target);
  const loaded = useRef(false);

  useEffect(() => {
    let cancelled = false;
    const timer = setTimeout(
      () => {
        call("resumes.previewHtml", JSON.parse(key) as PreviewTarget).then(
          (value) => {
            if (cancelled) return;
            loaded.current = true;
            setHtml(value.replace("</head>", `${SCREEN_CSS}</head>`));
            setError(null);
          },
          (failure) => {
            if (!cancelled) setError(errorMessage(failure));
          },
        );
      },
      // The first render shows at once; edits after that wait for a pause in typing.
      loaded.current ? debounceMs : 0,
    );
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [key, paper, debounceMs]);

  const box = useRef<HTMLDivElement>(null);
  const frame = useRef<HTMLIFrameElement>(null);
  const [width, setWidth] = useState(0);
  const [contentHeight, setContentHeight] = useState(PAPER_HEIGHT_PX[paper]);

  useLayoutEffect(() => {
    const el = box.current;
    if (!el) return;
    const observer = new ResizeObserver(() => setWidth(el.clientWidth));
    observer.observe(el);
    setWidth(el.clientWidth);
    return () => observer.disconnect();
  }, []);

  const paperWidth = PAPER_WIDTH_PX[paper];
  const scale = width > 0 ? Math.min(1, width / paperWidth) : 0.5;
  const height = Math.max(contentHeight, PAPER_HEIGHT_PX[paper]);

  return (
    <figure className="cv-preview">
      <div ref={box}>
        {error ? (
          <p className="field-error">{error}</p>
        ) : (
          <div className="cv-preview-frame" style={{ width: paperWidth * scale, height: height * scale }}>
            {html !== null ? (
              <iframe
                ref={frame}
                title="CV preview"
                sandbox="allow-same-origin"
                srcDoc={html}
                tabIndex={-1}
                style={{ width: paperWidth, height, transform: `scale(${scale})` }}
                onLoad={() => {
                  const doc = frame.current?.contentDocument;
                  if (doc) setContentHeight(Math.ceil(doc.documentElement.scrollHeight));
                }}
              />
            ) : null}
          </div>
        )}
      </div>
      <figcaption className="caption">{caption ?? `${paper === "A4" ? "A4" : "US Letter"}. Page breaks are set when the PDF is made.`}</figcaption>
    </figure>
  );
}
