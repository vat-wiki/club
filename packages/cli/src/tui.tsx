import { Box, render, Text,useApp, useInput } from "ink";
import { useEffect, useRef,useState } from "react";

import { ClubClient } from "@club/sdk";
import type { Channel,Message, Participant } from "@club/shared";

import { formatMessage } from "./commands/format.js";
import { type ClubConfig,defaultChannel } from "./config.js";

interface Props {
  cfg: ClubConfig;
}

function App({ cfg }: Props) {
  const [me, setMe] = useState<Participant | null>(null);
  const [channels, setChannels] = useState<Channel[]>([]);
  const [currentChannel, setCurrentChannel] = useState<string>(() => defaultChannel());
  const [lines, setLines] = useState<string[]>([]);
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [helpVisible, setHelpVisible] = useState(false);
  const [reactMode, setReactMode] = useState(false);
  const [reactEmoji, setReactEmoji] = useState("");
  const { exit } = useApp();
  const clientRef = useRef<ClubClient | null>(null);

  useEffect(() => {
    const c = new ClubClient(cfg);
    clientRef.current = c;
    Promise.all([c.me(), c.channels()]).then(
      ([m, rs]) => { setMe(m); setChannels(rs); },
      (err) => setLines(["error: " + (err as Error).message]),
    );
  }, [cfg]);

  useEffect(() => {
    let cancelled = false;
    const c = new ClubClient(cfg);
    c.messages({ limit: 50, channel: currentChannel }).then(
      (recent) => {
        if (!cancelled) {
          setMessages(recent);
          setLines(recent.map((m) => formatMessage(m, { server: cfg.server })));
        }
      },
      (err) => {
        if (!cancelled) setLines(["error: " + (err as Error).message]);
      },
    );
    return () => { cancelled = true; };
  }, [cfg, currentChannel]);

  useEffect(() => {
    const sub = new ClubClient(cfg).stream(
      (m: Message) => {
        if (m.channel !== currentChannel) return;
        setMessages((prev) => [...prev, m].slice(-200));
        setLines((prev) => [...prev, formatMessage(m, { server: cfg.server })].slice(-200));
      },
      { channel: currentChannel },
    );
    return () => sub.stop();
  }, [cfg, currentChannel]);

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
      if (channels.length > 0) {
        const idx = channels.findIndex((r) => r.slug === currentChannel);
        const next = channels[(idx + 1) % channels.length];
        if (next) setCurrentChannel(next.slug);
      }
      return;
    }
    if (key.return) {
      const text = input.trim();
      if (text) {
        new ClubClient(cfg)
          .send(text, undefined, { channel: currentChannel })
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
        <Text dimColor>channels </Text>
        {channels.length === 0 ? (
          <Text color="green">{`#${currentChannel}`}</Text>
        ) : (
          channels.map((r) => (
            <Text key={r.id} color={r.slug === currentChannel ? "green" : "gray"}>
              {` #${r.slug}${r.slug === currentChannel ? "*" : ""} `}
            </Text>
          ))
        )}
      </Box>
      <Box flexDirection="column" flexGrow={1}>
        {lines.length === 0 ? (
          <Text dimColor>(no messages in #{currentChannel} — say hi)</Text>
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
                : `#${currentChannel} · Tab switch · Enter send · Ctrl-C quit`}
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
