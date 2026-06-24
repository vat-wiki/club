import React, { useEffect, useState } from "react";
import { render, useInput, useApp, Box, Text } from "ink";
import type { Message, Participant } from "@club/shared";
import { ClubClient } from "@club/sdk";
import type { ClubConfig } from "./config.js";
import { formatMessage } from "./commands/format.js";

interface Props {
  cfg: ClubConfig;
}

function App({ cfg }: Props) {
  const [me, setMe] = useState<Participant | null>(null);
  const [lines, setLines] = useState<string[]>([]);
  const [input, setInput] = useState("");
  const { exit } = useApp();

  // initial load: whoami + recent history
  useEffect(() => {
    (async () => {
      try {
        const c = new ClubClient(cfg);
        const m = await c.me();
        setMe(m);
        const recent = await c.messages({ limit: 50 });
        setLines(recent.map(formatMessage));
      } catch (err) {
        setLines(["error: " + (err as Error).message]);
      }
    })();
  }, [cfg]);

  // live stream
  useEffect(() => {
    const sub = new ClubClient(cfg).stream((m: Message) => {
      setLines((prev) => [...prev, formatMessage(m)].slice(-200));
    });
    return () => sub.stop();
  }, [cfg]);

  useInput((ch, key) => {
    if (key.ctrl && ch === "c") {
      exit();
      return;
    }
    if (key.return) {
      const text = input.trim();
      if (text) {
        // optimistic; server echoes via stream
        new ClubClient(cfg).send(text).catch((e) =>
          setLines((prev) => [...prev, "send error: " + (e as Error).message]),
        );
      }
      setInput("");
      return;
    }
    if (key.backspace || key.delete) {
      setInput((p) => p.slice(0, -1));
      return;
    }
    if (ch && !key.ctrl && !key.meta) {
      setInput((p) => p + ch);
    }
  });

  return (
    <Box flexDirection="column" height={process.stdout.rows || 24}>
      <Box flexDirection="column" flexGrow={1}>
        {lines.length === 0 ? (
          <Text dimColor>(no messages yet — say hi)</Text>
        ) : (
          lines.map((l, i) => (
            <Text key={i} wrap="truncate">
              {l}
            </Text>
          ))
        )}
      </Box>
      <Box>
        <Text color="green">
          {me ? `${me.kind === "agent" ? "🤖" : "🧑"}${me.name}> ` : "> "}
        </Text>
        <Text>{input}</Text>
        <Text dimColor>{input ? "" : "type a message, Enter to send, Ctrl-C to quit"}</Text>
      </Box>
    </Box>
  );
}

export function runTui(cfg: ClubConfig): void {
  render(<App cfg={cfg} />);
}