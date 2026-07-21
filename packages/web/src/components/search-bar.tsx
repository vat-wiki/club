import { api } from "@/lib/api";
import { useT } from "@/lib/i18n";
import { Search, X } from "lucide-react";
import { useEffect, useState } from "react";

import type { ClubConn } from "@club/sdk";
import type { Message } from "@club/shared";

/**
 * Inline message search bar. Debounces the query and calls `GET /messages/search`,
 * rendering results in a dropdown beneath the input.
 *
 * - Scoped to `room` when provided; searches the whole workspace when omitted.
 * - Fire-and-forget: errors are swallowed (search is best-effort discovery,
 *   not a critical path).
 * - Stays open while the user types; closes when cleared.
 *
 * @param props.conn - Active connection; null disconnects the search input.
 * @param props.room - Optional room slug to scope the search.
 *
 * @module @club/web/components/search-bar
 */
export function SearchBar({ conn, room }: { conn: ClubConn | null; room?: string }) {
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
        setResults(await api.search(conn, q, room));
      } catch {
        setResults([]);
      }
    }, 300);
    return () => clearTimeout(h);
  }, [conn, q, room]);

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
