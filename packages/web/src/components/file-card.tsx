import { useEffect, useRef, useState } from "react";
import { Download, Eye, FileText, Loader2, X } from "lucide-react";
import type { MessageAttachment } from "@club/shared";
import { humanBytes } from "@/lib/upload";
import { useT } from "@/lib/i18n";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";

// The preview libraries' styles. Small (~24KB combined, mostly excel) and
// loaded eagerly so they're ready when a user opens a preview; the heavier JS
// (pdf.js / docx-parser / x-spreadsheet) loads on demand via dynamic import.
import "@js-preview/docx/lib/index.css";
import "@js-preview/excel/lib/index.css";

function resolveUrl(url: string): string {
  if (typeof window === "undefined") return url;
  if (/^https?:\/\//i.test(url)) return url;
  return `${window.location.origin}${url.startsWith("/") ? "" : "/"}${url}`;
}

type PreviewKind = "docx" | "excel" | "pdf";

// Which @js-preview lib renders this MIME, if any. Markdown (and anything else
// not listed) is download-only — it's plain text the user opens locally.
function previewKind(mime: string): PreviewKind | null {
  switch (mime) {
    case "application/pdf":
      return "pdf";
    case "application/vnd.openxmlformats-officedocument.wordprocessingml.document":
      return "docx";
    case "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet":
      return "excel";
    default:
      return null;
  }
}

// A document attachment card: file icon + filename + size + actions. Documents
// that js-preview can render (pdf/docx/xlsx) get a "preview" button opening a
// large Dialog; every document can be downloaded.
//
// The preview is rendered through the Radix Dialog (not a hand-rolled fixed
// div) on purpose: the message list virtualizes rows with `transform`, which
// demotes any descendant `position: fixed` to be relative to that row — so a
// naive fixed overlay would be trapped in a tiny strip. Radix Dialog portals
// its content to document.body, escaping the transformed ancestor entirely.
export function FileCard({ attachment }: { attachment: MessageAttachment }) {
  const t = useT();
  const [previewing, setPreviewing] = useState(false);
  const kind = previewKind(attachment.mime);
  const url = resolveUrl(attachment.url);
  const name = attachment.filename ?? attachment.id;

  return (
    <>
      <div
        data-testid="attachment-file"
        className="mt-1.5 flex w-full max-w-[320px] items-center gap-2.5 rounded-md border border-border/60 bg-card px-2.5 py-2"
      >
        <FileText className="h-8 w-8 shrink-0 text-muted-foreground" aria-hidden />
        <div className="min-w-0 flex-1">
          <div className="truncate text-xs font-medium" title={name}>
            {name}
          </div>
          <div className="font-mono text-[10px] text-muted-foreground">
            {humanBytes(attachment.size)}
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-0.5">
          {kind && (
            <button
              type="button"
              onClick={() => setPreviewing(true)}
              aria-label={t("file.preview")}
              className="grid h-8 w-8 place-items-center rounded text-muted-foreground transition-colors hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <Eye className="h-4 w-4" aria-hidden />
            </button>
          )}
          <a
            href={url}
            download={name}
            aria-label={t("file.download")}
            className="grid h-8 w-8 place-items-center rounded text-muted-foreground transition-colors hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <Download className="h-4 w-4" aria-hidden />
          </a>
        </div>
      </div>

      {kind && (
        <Dialog open={previewing} onOpenChange={setPreviewing}>
          <DialogContent
            // Drop the default card chrome + max-w-lg; span almost the whole
            // viewport so documents have room. showClose=false because we render
            // our own close in the header (keeps it aligned with the download).
            showClose={false}
            className="flex max-h-[90vh] w-[95vw] max-w-[95vw] flex-col gap-0 overflow-hidden p-0 sm:rounded-lg"
          >
            <DialogTitle className="sr-only">{name}</DialogTitle>
            <header className="flex flex-none items-center gap-2 border-b border-border/60 px-3 py-2">
              <FileText className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
              <span className="min-w-0 flex-1 truncate text-sm font-medium" title={name}>
                {name}
              </span>
              <a
                href={url}
                download={name}
                aria-label={t("file.download")}
                className="grid h-8 w-8 place-items-center rounded text-muted-foreground transition-colors hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                <Download className="h-4 w-4" aria-hidden />
              </a>
              <button
                type="button"
                onClick={() => setPreviewing(false)}
                aria-label={t("file.close")}
                className="grid h-8 w-8 place-items-center rounded text-muted-foreground transition-colors hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                <X className="h-4 w-4" aria-hidden />
              </button>
            </header>
            <PreviewBody kind={kind} url={url} />
          </DialogContent>
        </Dialog>
      )}
    </>
  );
}

// The scrollable preview surface. Mounted only while the Dialog is open, so its
// effect can rely on `ref.current` being present: dynamically import the right
// @js-preview lib, init it against the container, feed the URL, and destroy on
// unmount to avoid leaks.
function PreviewBody({ kind, url }: { kind: PreviewKind; url: string }) {
  const t = useT();
  const ref = useRef<HTMLDivElement>(null);
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");

  useEffect(() => {
    let previewer: { preview: (src: string) => Promise<void>; destroy?: () => void } | null = null;
    let active = true;
    (async () => {
      try {
        // CJS packages — the default export holds the { init } API.
        const mod: Record<string, unknown> =
          kind === "docx"
            ? await import("@js-preview/docx")
            : kind === "excel"
              ? await import("@js-preview/excel")
              : await import("@js-preview/pdf");
        const lib = (mod.default ?? mod) as {
          init: (el: HTMLElement) => {
            preview: (src: string) => Promise<void>;
            destroy?: () => void;
          };
        };
        previewer = lib.init(ref.current ?? document.createElement("div"));
        await previewer.preview(url);
        if (active) setStatus("ready");
      } catch {
        if (active) setStatus("error");
      }
    })();
    return () => {
      active = false;
      try {
        previewer?.destroy?.();
      } catch {
        /* already torn down */
      }
    };
  }, [kind, url]);

  return (
    <div className="relative min-h-0 flex-1 overflow-auto bg-muted/30">
      {status !== "ready" && (
        <div className="pointer-events-none absolute inset-0 grid place-items-center p-6 text-center text-sm text-muted-foreground">
          {status === "loading" ? (
            <Loader2 className="h-6 w-6 animate-spin" aria-hidden />
          ) : (
            t("file.previewFailed")
          )}
        </div>
      )}
      <div ref={ref} className="min-h-full" />
    </div>
  );
}
