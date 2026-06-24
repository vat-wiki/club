import { useRef, useState, type KeyboardEvent } from "react";
import { Send } from "lucide-react";
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
    setValue("");
    requestAnimationFrame(autosize);
    try {
      await onSend(content);
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
        <Textarea
          ref={ref}
          value={value}
          rows={1}
          disabled={disabled}
          placeholder="transmit to #general…"
          className="min-h-[42px] resize-none"
          onChange={(e) => {
            setValue(e.target.value);
            autosize();
          }}
          onKeyDown={onKeyDown}
        />
        <Button type="submit" size="default" disabled={disabled || sending || !value.trim()} className="h-[42px] gap-1.5">
          <Send className="h-4 w-4" />
          send
        </Button>
      </div>
      <p className="mt-1.5 font-mono text-[10px] uppercase tracking-wider text-muted-foreground/60">
        enter to transmit · shift+enter for a new line
      </p>
    </form>
  );
}