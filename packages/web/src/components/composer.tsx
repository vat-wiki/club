import { useRef, useState, type KeyboardEvent } from "react";
import { AlertTriangle, Send } from "lucide-react";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";

export function Composer({
  onSend,
  disabled,
}: {
  onSend: (content: string) => Promise<void>;
  disabled?: boolean;
}) {
  const [value, setValue] = useState("");
  const [sending, setSending] = useState(false);
  // last failed draft — restored into the textarea on failure so the user can
  // edit/redo and resend, instead of the message vanishing silently.
  const [error, setError] = useState(false);
  const ref = useRef<HTMLTextAreaElement>(null);

  const autosize = () => {
    const el = ref.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = Math.min(el.scrollHeight, 160) + "px";
  };

  const submit = async () => {
    const content = value.trim();
    if (!content || sending) return;
    setSending(true);
    setError(false);
    setValue("");
    requestAnimationFrame(autosize);
    try {
      await onSend(content);
    } catch {
      // Send failed: put the draft back so the user isn't left thinking it
      // went through, and surface a visible inline error.
      setError(true);
      setValue(content);
      requestAnimationFrame(() => {
        autosize();
        ref.current?.focus();
      });
    } finally {
      setSending(false);
    }
  };

  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      void submit();
    }
  };

  return (
    <form
      className="flex-none border-t border-border bg-card px-5 py-3"
      onSubmit={(e) => {
        e.preventDefault();
        void submit();
      }}
    >
      <div className="flex items-end gap-2.5">
        {/* Visually-hidden label gives the textarea an accessible name; the
            placeholder alone is not a substitute (WCAG 1.3.1 / 3.3.2). */}
        <label htmlFor="composer-input" className="sr-only">
          Message #general
        </label>
        <Textarea
          ref={ref}
          id="composer-input"
          value={value}
          rows={1}
          disabled={disabled}
          placeholder="transmit to #general…"
          className="min-h-[42px] resize-none"
          aria-describedby="composer-hint"
          aria-invalid={error}
          onChange={(e) => {
            setValue(e.target.value);
            setError(false);
            autosize();
          }}
          onKeyDown={onKeyDown}
        />
        <Button
          type="submit"
          size="default"
          disabled={disabled || sending || !value.trim()}
          className="h-[42px] gap-1.5"
        >
          <Send className="h-4 w-4" aria-hidden />
          send
        </Button>
      </div>
      {error ? (
        <p
          role="alert"
          className="mt-1.5 flex items-center gap-1.5 font-mono text-[11px] text-destructive"
        >
          <AlertTriangle className="h-3.5 w-3.5" aria-hidden />
          couldn't send — check your connection and try again
        </p>
      ) : (
        <p
          id="composer-hint"
          className="mt-1.5 font-mono text-[10px] uppercase tracking-wider text-muted-foreground/90"
        >
          enter to transmit · shift+enter for a new line
        </p>
      )}
    </form>
  );
}