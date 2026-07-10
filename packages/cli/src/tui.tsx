import React, { useEffect, useState } from "react";
import { render, useInput, useApp, Box, Text } from "ink";
import type { Message, Participant, Room } from "@club/shared";
import { ClubClient } from "@club/sdk";
import { defaultRoom, type ClubConfig } from "./config.js";
import { formatMessage } from "./commands/format.js";

interface Props {
  cfg: ClubConfig;
}

function App({ cfg }: Props) {
  const [me, setMe] = useState<Participant | null>(null);
  const [rooms, setRooms] = useState<Room[]>([]);
  // The focused room starts from the config default (`club enter`), else general.
  const [currentRoom, setCurrentRoom] = useState<string>(() => defaultRoom(cfg));
  const [lines, setLines] = useState<string[]>([]);
  const [input, setInput] = useState("");
  const { exit } = useApp();

  // initial load: whoami + the room list (once). The room list drives the
  // switcher bar; if the config's default room isn't in it yet, that's fine —
  // the bar just shows what exists and history/stream still target currentRoom.
  useEffect(() => {
    (async () => {
      try {
        const c = new ClubClient(cfg);
        const [m, rs] = await Promise.all([c.me(), c.rooms()]);
        setMe(m);
        setRooms(rs);
      } catch (err) {
        setLines(["error: " + (err as Error).message]);
      }
    })();
  }, [cfg]);

  // recent history for the focused room. Re-runs on every room switch so the
  // view reflects that room's conversation, not the previous room's tail.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const recent = await new ClubClient(cfg).messages({ limit: 50, room: currentRoom });
        if (!cancelled) setLines(recent.map(formatMessage));
      } catch (err) {
        if (!cancelled) setLines(["error: " + (err as Error).message]);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [cfg, currentRoom]);

  // live stream, scoped to the focused room. Re-subscribes on room switch: the
  // old subscription is torn down (cleanup) and a new one opens for the new
  // room, so a client watching room A never receives room B's events (MR10).
  useEffect(() => {
    const sub = new ClubClient(cfg).stream(
      (m: Message) => {
        // Server-side filtering already scopes by room, but guard anyway: a
        // message from another room must never bleed into this view.
        if (m.room !== currentRoom) return;
        setLines((prev) => [...prev, formatMessage(m)].slice(-200));
      },
      { room: currentRoom },
    );
    return () => sub.stop();
  }, [cfg, currentRoom]);

  useInput((ch, key) => {
    if (key.ctrl && ch === "c") {
      exit();
      return;
    }
    // Tab cycles to the next room in the switcher bar. A focused client follows
    // one room at a time (PRD §5.3); cycling re-runs the history + stream
    // effects above.
    if (key.tab) {
      if (rooms.length > 0) {
        const idx = rooms.findIndex((r) => r.slug === currentRoom);
        const next = rooms[(idx + 1) % rooms.length];
        if (next) setCurrentRoom(next.slug);
      }
      return;
    }
    if (key.return) {
      const text = input.trim();
      if (text) {
        // optimistic; server echoes via stream. Posts to the focused room.
        new ClubClient(cfg)
          .send(text, undefined, { room: currentRoom })
          .catch((e) => setLines((prev) => [...prev, "send error: " + (e as Error).message]));
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
      {/* Room switcher bar: every room inline, the focused one highlighted. */}
      <Box>
        <Text dimColor>rooms </Text>
        {rooms.length === 0 ? (
          <Text color="green">{`#${currentRoom}`}</Text>
        ) : (
          rooms.map((r) => (
            <Text key={r.id} color={r.slug === currentRoom ? "green" : "gray"}>
              {` #${r.slug}${r.slug === currentRoom ? "*" : ""} `}
            </Text>
          ))
        )}
      </Box>
      <Box flexDirection="column" flexGrow={1}>
        {lines.length === 0 ? (
          <Text dimColor>(no messages in #{currentRoom} — say hi)</Text>
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
        <Text dimColor>
          {input
            ? ""
            : `#${currentRoom} · Tab switch · Enter send · Ctrl-C quit`}
        </Text>
      </Box>
    </Box>
  );
}

export function runTui(cfg: ClubConfig): void {
  render(<App cfg={cfg} />);
}
