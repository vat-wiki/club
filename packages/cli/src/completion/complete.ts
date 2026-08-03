// Shell completion dispatcher.
//
// `club __complete <words...>` is invoked by the generated bash/zsh/fish
// completion scripts (see `club completion`). It walks the commander program
// tree using the partial command line and prints one completion candidate per
// line to stdout (`value[\tdescription]`). The last word is the token currently
// being typed (possibly empty); everything before it is fully-entered context.
//
// This is intercepted in index.ts BEFORE commander parses, so it stays out of
// `club --help`, skips the auto-update preAction hook, and never requires auth.
// Static completion (subcommands + flags) is pure tree introspection and needs
// no network; dynamic completion (--channel slugs, `kick` ids) calls the SDK
// best-effort with a short timeout and silently no-ops when offline/unauthed.

import type { Command, Option } from "commander";

import { ClubClient } from "@club/sdk";

import { loadConfig } from "../config.js";

/** A single completion candidate: a value plus an optional description. */
export interface CompletionCandidate {
  value: string;
  description?: string;
}

/** Injected data sources for dynamic completion (channels, members). */
export interface CompletionDeps {
  /** Channel slugs (for `--channel`, `channel delete|rename <slug>`). */
  listChannels?: () => Promise<CompletionCandidate[]>;
  /** Participants (for `kick <id>`). */
  listMembers?: () => Promise<CompletionCandidate[]>;
}

/** True when `option` expects an argument (`<val>` or `[val]`), false for flags. */
function takesValue(o: Option): boolean {
  return o.required || o.optional;
}

function findLongOption(node: Command, name: string, program: Command): Option | undefined {
  return (
    node.options.find((o) => o.long === `--${name}`) ??
    program.options.find((o) => o.long === `--${name}`)
  );
}

function findShortOption(node: Command, ch: string, program: Command): Option | undefined {
  const flag = `-${ch}`;
  return (
    node.options.find((o) => o.short === flag) ??
    program.options.find((o) => o.short === flag)
  );
}

function findSubcommand(node: Command, name: string): Command | undefined {
  return node.commands.find((c) => c.name() === name || c.aliases().includes(name));
}

/**
 * Parse a short-option cluster like `-r`, `-rfoo`, `-vr`. Returns the first
 * value-taking option encountered (and whether its value was inline) so the
 * walker knows the next token is that option's argument.
 */
function parseShortCluster(
  node: Command,
  word: string,
  program: Command,
): { valueOpt: Option | null; hasInline: boolean } {
  for (let i = 1; i < word.length; i++) {
    const opt = findShortOption(node, word[i], program);
    if (!opt) continue; // unknown short flag char; skip
    if (takesValue(opt)) {
      const rest = word.slice(i + 1);
      return { valueOpt: opt, hasInline: rest.length > 0 };
    }
  }
  return { valueOpt: null, hasInline: false };
}

/** Option-flag candidates for `node`, merged with the global `-c/--config`. */
function flagCandidates(node: Command, program: Command): CompletionCandidate[] {
  const out: CompletionCandidate[] = [];
  const seen = new Set<string>();
  const push = (o: Option): void => {
    if (o.long && !seen.has(o.long)) {
      seen.add(o.long);
      out.push({ value: o.long, description: o.description || undefined });
    }
    if (o.short && !seen.has(o.short)) {
      seen.add(o.short);
      out.push({ value: o.short, description: o.description || undefined });
    }
  };
  for (const o of node.options) push(o);
  // Propagate the documented-global `-c/--config` to subcommands; `--version`
  // is top-level only, so exclude it when not on the program itself.
  if (node !== program) {
    for (const o of program.options) {
      if (o.long === "--version") continue;
      push(o);
    }
  }
  return out;
}

function prefixFilter(
  cands: CompletionCandidate[],
  prefix: string,
): CompletionCandidate[] {
  return prefix ? cands.filter((c) => c.value.startsWith(prefix)) : cands;
}

// --- dynamic completer registry ------------------------------------------------

type Completer = (deps: CompletionDeps) => Promise<CompletionCandidate[]>;

const channelsCompleter: Completer = async (deps) => {
  if (!deps.listChannels) return [];
  try {
    return await deps.listChannels();
  } catch {
    return [];
  }
};

const membersCompleter: Completer = async (deps) => {
  if (!deps.listMembers) return [];
  try {
    return await deps.listMembers();
  } catch {
    return [];
  }
};

/** Option-value completers keyed by long flag name (without `--`). */
const optionCompleters: Record<string, Completer> = {
  channel: channelsCompleter,
};

/**
 * Positional-argument completers keyed by command path (space-joined names) ->
 * one completer per positional index.
 */
const positionalCompleters: Record<string, Completer[]> = {
  "channel delete": [channelsCompleter], // <slug>
  "channel rename": [channelsCompleter], // <slug>
  kick: [membersCompleter], // <id>
};

/**
 * Compute completion candidates for a partial command line.
 *
 * @param program - The fully-built commander program (all commands registered).
 * @param words   - Command-line tokens after `club`; the last is the partial.
 * @param deps    - Optional dynamic data sources (defaults to best-effort SDK).
 */
export async function runComplete(
  program: Command,
  words: string[],
  deps: CompletionDeps = {},
): Promise<CompletionCandidate[]> {
  const current = words.length ? words[words.length - 1] : "";
  const preceding = words.length ? words.slice(0, -1) : [];

  let node = program;
  let positionalIndex = 0;
  let afterDashDash = false;
  let completingOption: Option | null = null;
  const path: string[] = [];

  let i = 0;
  while (i < preceding.length) {
    const w = preceding[i];
    if (afterDashDash) {
      positionalIndex++;
      i++;
      continue;
    }
    if (w === "--") {
      afterDashDash = true;
      i++;
      continue;
    }
    if (w.startsWith("--")) {
      const eq = w.indexOf("=");
      const name = eq >= 0 ? w.slice(2, eq) : w.slice(2);
      const hasInline = eq >= 0;
      const opt = findLongOption(node, name, program);
      if (opt && takesValue(opt) && !hasInline) {
        if (i === preceding.length - 1) completingOption = opt;
        i += 2; // option + its value token
      } else {
        i += 1;
      }
      continue;
    }
    if (w.startsWith("-") && w !== "-" && w.length > 1) {
      const { valueOpt, hasInline } = parseShortCluster(node, w, program);
      if (valueOpt && !hasInline) {
        if (i === preceding.length - 1) completingOption = valueOpt;
        i += 2;
      } else {
        i += 1;
      }
      continue;
    }
    // positional or subcommand
    const sub = findSubcommand(node, w);
    if (sub) {
      node = sub;
      path.push(sub.name());
      positionalIndex = 0;
    } else {
      positionalIndex++;
    }
    i++;
  }

  // After `--` (e.g. `club agent -- <cmd>`): defer to the shell's default.
  if (afterDashDash && !completingOption) return [];

  // Completing an option's value, e.g. `--channel <TAB>` or `-r <TAB>`.
  if (completingOption) {
    const longName = completingOption.long ? completingOption.long.slice(2) : "";
    const completer = optionCompleters[longName];
    const cands = completer ? await completer(deps) : [];
    return prefixFilter(cands, current);
  }

  // Inline long-option value, e.g. `--channel=gen<TAB>` (zsh style).
  if (current.startsWith("--") && current.includes("=")) {
    const eq = current.indexOf("=");
    const name = current.slice(2, eq);
    const partial = current.slice(eq + 1);
    const opt = findLongOption(node, name, program);
    if (opt && takesValue(opt)) {
      const longName = opt.long ? opt.long.slice(2) : name;
      const completer = optionCompleters[longName];
      if (completer) {
        const cands = await completer(deps);
        const prefix = current.slice(0, eq + 1);
        return prefixFilter(cands, partial).map((c) => ({
          value: `${prefix}${c.value}`,
          description: c.description,
        }));
      }
    }
  }

  // Completing a flag, e.g. `--<TAB>` or `-<TAB>`.
  if (current.startsWith("-")) {
    return prefixFilter(flagCandidates(node, program), current);
  }

  // Completing a subcommand or positional argument.
  const subs = node.commands;
  if (subs.length > 0) {
    return prefixFilter(
      subs.map((s) => ({ value: s.name(), description: s.description() || undefined })),
      current,
    );
  }
  const completer = positionalCompleters[path.join(" ")]?.[positionalIndex];
  if (completer) {
    return prefixFilter(await completer(deps), current);
  }
  return [];
}

/**
 * Build best-effort `CompletionDeps` from the on-disk config. The SDK client is
 * created lazily (only when a dynamic completer actually runs) and each call is
 * racing a short timeout so a hung/offline server never stalls the shell.
 */
export function buildRealDeps(): CompletionDeps {
  let cfg: ReturnType<typeof loadConfig> | undefined;
  let client: ClubClient | null = null;

  const getClient = (): ClubClient | null => {
    if (cfg === undefined) cfg = loadConfig();
    if (!cfg) return null;
    client ??= new ClubClient(cfg);
    return client;
  };

  const withTimeout = <T>(p: Promise<T>, ms: number, fallback: T): Promise<T> => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<T>((resolve) => {
      timer = setTimeout(() => resolve(fallback), ms);
    });
    return Promise.race([p, timeout]).finally(() => {
      if (timer) clearTimeout(timer);
    });
  };

  // Generous default: a real (but slow) roster/channel list can take ~1.5s, and
  // a genuine offline/server-down fails the TCP connect in well under that, so
  // the timeout only bites on a hung connection - never on a healthy slow one.
  // Overridable for users on high-latency servers.
  const timeoutMs = Number(process.env.CLUB_COMPLETION_TIMEOUT) || 3000;

  return {
    listChannels: async () => {
      const cl = getClient();
      if (!cl) return [];
      const chs = await withTimeout(cl.channels(), timeoutMs, []);
      return chs.map((c) => ({ value: c.slug, description: c.displayName ?? undefined }));
    },
    listMembers: async () => {
      const cl = getClient();
      if (!cl) return [];
      const ms = await withTimeout(cl.members(), timeoutMs, []);
      return ms.map((m) => ({ value: m.id, description: m.name || undefined }));
    },
  };
}

/** Print candidates as `value[\tdescription]` lines to stdout. */
export function printCompletions(cands: CompletionCandidate[]): void {
  for (const c of cands) {
    process.stdout.write(c.description ? `${c.value}\t${c.description}\n` : `${c.value}\n`);
  }
}

/**
 * End-to-end dispatcher entry: build real deps, compute, print. Never throws -
 * any failure yields no output (the shell simply falls back to default
 * completion) rather than corrupting the completion stream with an error.
 */
export async function runCompleteAndPrint(program: Command, words: string[]): Promise<void> {
  try {
    const cands = await runComplete(program, words, buildRealDeps());
    printCompletions(cands);
  } catch {
    // Silent: completion must never surface errors to the shell.
  }
}
