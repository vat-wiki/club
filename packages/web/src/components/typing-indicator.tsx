import { useT } from "@/lib/i18n";
import { cn } from "@/lib/utils";
import { memo } from "react";

// Agent "thinking" indicator shown at the bottom of the message log when one or
// more agents are processing a @mention but haven't posted a reply yet. The live
// list of thinking agents is fed by useTypingAgents(), which subscribes to the
// `agent_thinking` / `agent_idle` SSE named events forwarded through
// useMessageStream's StreamOptions.
//
// Contract (now shipped by the backend): the SDK parses the SSE `event:`
// field and dispatches `agent_thinking` ({participantId, name, kind}) and
// `agent_idle` ({participantId}) payloads to the StreamOptions callbacks. The
// server guarantees an idle on reply/error/offline plus a TTL reaper, so the
// indicator can't get stuck on; the TTL is server-side and intentionally not
// hard-coded here.

export interface TypingAgent {
  id: string;
  name: string;
}

// Three-dot "typing" bubble. Reads as a quiet, left-aligned agent row (matches
// the message-row alignment for others) with an animated ellipsis instead of
// text. Hidden from screen readers as "typing" chatter would be noisy; the
// eventual reply (a real message) is what SR users care about and that's
// announced by the log's aria-live region. role=status keeps it polite.
const Dots = memo(function Dots() {
  return (
    <span className="inline-flex items-center gap-1" aria-hidden>
      {[0, 1, 2].map((i) => (
        <span
          key={i}
          className="h-1.5 w-1.5 rounded-full bg-agent/80 animate-agent-pulse"
          // Stagger the pulse so the three dots read as a "typing" wave rather
          // than blinking in unison. Reduced-motion collapses it (global wildcard).
          style={{ animationDelay: `${i * 0.2}s` }}
        />
      ))}
    </span>
  );
});

export function TypingIndicator({ agents }: { agents: readonly TypingAgent[] }) {
  const t = useT();
  if (agents.length === 0) return null;
  // Compose a readable label: "rex is thinking…" or "rex and ana are thinking…".
  // Capped at 2 names; "+N" for the rest to avoid overflow on a crowded room.
  const names = agents.slice(0, 2).map((a) => a.name);
  const extra = agents.length - names.length;
  const label =
    extra > 0
      ? t("typing.labelMany", { names: names.join(", "), count: extra })
      : agents.length === 1
        ? t("typing.labelOne", { name: names[0] })
        : t("typing.labelTwo", { names: names.join(", ") });

  return (
    <div
      role="status"
      aria-live="polite"
      aria-label={label}
      className={cn(
        "flex items-center gap-2.5 rounded-md px-4 py-1.5 animate-slide-in sm:px-6",
      )}
    >
      <div className="flex justify-center pt-[7px]">
        <span aria-hidden className="h-[7px] w-[7px] rounded-full bg-agent animate-agent-pulse" />
      </div>
      <div className="flex items-center gap-2 rounded-lg bg-card px-3 py-2">
        <Dots />
        <span className="font-mono text-[11px] text-muted-foreground">{label}</span>
      </div>
    </div>
  );
}
