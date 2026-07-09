import { useEffect, useState } from "react";
import { Search, X } from "lucide-react";
import type { Message } from "@club/shared";
import { api } from "@/lib/api";
import type { ClubConn } from "@club/sdk";
import { useT } from "@/lib/i18n";

// Inline message search: debounced query against GET /messages/search, results
// in a dropdown below the input. Fire-and-forget on error (search is best-effort
// discovery, not critical). Closes on clear; stays open while typing.
export function SearchBar({ conn }: { conn: ClubConn | null }) {
  const t = useT();
  const [q, setQ] = useState("");
  const [results, setResults] = useState<Message[]>([]);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!conn || !q.trim()) {
      setResults([]);
      return;
    }
    const h = setTimeout(async () => {
      try {
        setResults(await api.search(conn, q));
      } catch {
        setResults([]);
      }
    }, 300);
    return () => clearTimeout(h);
  }, [conn, q]);

  return (
    <div className="relative flex-none border-b border-border/60 px-4 py-1.5 sm:px-6">
      <div className="flex items-center gap-2">
        <Search className="h-3.5 w-3.5 flex-none text-muted-foreground" aria-hidden />
        <input
          value={q}
          onChange={(e) => {
            setQ(e.target.value);
            setOpen(true);
          }}
          onFocus={() => setOpen(true)}
          placeholder={t("search.placeholder")}
          aria-label={t("search.placeholder")}
          className="min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground"
        />
        {q && (
          <button
            type="button"
            onClick={() => {
              setQ("");
              setResults([]);
              setOpen(false);
            }}
            aria-label={t("search.clear")}
            className="flex-none text-muted-foreground hover:text-foreground"
          >
            <X className="h-3.5 w-3.5" aria-hidden />
          </button>
        )}
      </div>
      {open && q.trim() && (
        <div className="absolute left-0 right-0 top-full z-30 max-h-72 overflow-y-auto border-b border-border bg-popover shadow-lg scrollbar-thin">
          {results.length === 0 ? (
            <div className="px-4 py-3 text-xs text-muted-foreground">{t("search.noResults")}</div>
          ) : (
            results.map((m) => (
              <div key={m.id} className="border-t border-border/40 px-4 py-1.5 text-xs hover:bg-accent/70">
                <span className="font-mono font-medium text-foreground">{m.authorName}</span>
                <span className="ml-2 truncate text-muted-foreground">{m.content || "…"}</span>
              </div>
            ))
          )}
        </div>
      )}
    </div>
  );
}
