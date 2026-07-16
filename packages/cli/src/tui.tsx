import React, { useEffect, useState, useRef } from "react";
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
  const [currentRoom, setCurrentRoom] = useState<string>(() => defaultRoom(cfg));
  const [lines, setLines] = useState<string[]>([]);
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [helpVisible, setHelpVisible] = useState(false);
  const [reactMode, setReactMode] = useState(false);
  const [reactEmoji, setReactEmoji] = useState("");
  const { exit } = useApp();
  const clientRef = useRef<ClubClient | null>(null);

  useEffect(() => {
    (async () => {
      try {
        const c = new ClubClient(cfg);
        clientRef.current = c;
        const [m, rs] = await Promise.all([c.me(), c.rooms()]);
        setMe(m);
        setRooms(rs);
      } catch (err) {
        setLines(["error: " + (err as Error).message]);
      }
    })();
  }, [cfg]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const recent = await new ClubClient(cfg).messages({ limit: 50, room: currentRoom });
        if (!cancelled) {
          setMessages(recent);
          setLines(recent.map(formatMessage));
        }
      } catch (err) {
        if (!cancelled) setLines(["error: " + (err as Error).message]);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [cfg, currentRoom]);

  useEffect(() => {
    const sub = new ClubClient(cfg).stream(
      (m: Message) => {
        if (m.room !== currentRoom) return;
        setMessages((prev) => [...prev, m].slice(-200));
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
    if (key.ctrl && ch === "l") {
      setLines([]);
      return;
    }
    if (key.ctrl && ch === "u") {
      setInput("");
      return;
    }
    if (ch === "?" && !input && !reactMode) {
      setHelpVisible((v) => !v);
      return;
    }
    // React mode: press 'r' to enter, type emoji, Enter to react, Esc to cancel
    if (ch === "r" && !input && !reactMode) {
      setReactMode(true);
      setReactEmoji("");
      return;
    }
    if (reactMode) {
      if (key.escape) {
        setReactMode(false);
        setReactEmoji("");
        return;
      }
      if (key.return) {
        const lastMsg = messages[messages.length - 1];
        if (lastMsg && reactEmoji) {
          clientRef.current?.toggleReaction(lastMsg.id, reactEmoji)
            .then(() => setLines((prev) => [...prev, `reacted with ${reactEmoji}`]))
            .catch(() => setLines((prev) => [...prev, "react failed"]));
        }
        setReactMode(false);
        setReactEmoji("");
        return;
      }
      if (key.backspace || key.delete) {
        setReactEmoji((p) => p.slice(0, -1));
        return;
      }
      if (ch && !key.ctrl && !key.meta) {
        setReactEmoji((p) => p + ch);
      }
      return;
    }
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
      {helpVisible && (
        <Box>
          <Text dimColor>
            {" ? help · Tab switch · r react · Enter send · Ctrl-L clear · Ctrl-U input · Ctrl-C quit "}
          </Text>
        </Box>
      )}
      <Box>
        {reactMode ? (
          <>
            <Text color="yellow">React mode: </Text>
            <Text color="cyan">{reactEmoji}</Text>
            <Text dimColor>
              {reactEmoji ? " · Enter to react" : "type emoji..."} · Esc cancel
            </Text>
          </>
        ) : (
          <>
            <Text color="green">
              {me ? `${me.name}> ` : "> "}
            </Text>
            <Text>{input}</Text>
            <Text dimColor>
              {input
                ? ""
                : `#${currentRoom} · Tab switch · Enter send · Ctrl-C quit`}
            </Text>
          </>
        )}
      </Box>
    </Box>
  );
}

export function runTui(cfg: ClubConfig): void {
  render(<App cfg={cfg} />);
}
