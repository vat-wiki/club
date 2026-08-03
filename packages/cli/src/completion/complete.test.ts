import { Command } from "commander";
import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  type CompletionDeps,
  printCompletions,
  runComplete,
} from "./complete.js";

/**
 * Build a miniature commander program that mirrors the real `club` structure
 * closely enough to exercise every dispatcher branch: nested subcommands
 * (`channel delete|rename`), value-taking long+short options (`--channel`/`-r`),
 * a boolean flag (`--json`), a global option (`-c/--config`), a positional
 * (`kick <id>`), and `--` passthrough (`agent`).
 */
function buildProgram(): Command {
  const program = new Command("club");
  program.option("-c, --config <path>", "config file path");

  const channel = program.command("channel").description("channel actions");
  channel.command("delete").argument("<slug>", "channel slug").description("delete a channel");
  channel.command("rename").argument("<slug>", "channel slug").description("rename a channel");

  program
    .command("send")
    .description("send a message")
    .argument("[text...]", "message text")
    .option("-r, --channel <slug>", "post to this channel")
    .option("--json", "emit json");

  program
    .command("read")
    .description("read messages")
    .option("-r, --channel <slug>", "read from this channel")
    .option("--since <id>", "show messages after this id")
    .option("--json", "emit json");

  program.command("kick").description("kick a participant").argument("<id>", "participant ID");

  program
    .command("agent")
    .description("run a TUI agent")
    .allowExcessArguments(true)
    .option("-r, --channel <slug>", "subscribe to this channel");

  return program;
}

function makeDeps(overrides: Partial<CompletionDeps> = {}): CompletionDeps {
  return {
    listChannels: vi.fn(async () => [
      { value: "general", description: "General" },
      { value: "dev" },
      { value: "random", description: "Random" },
    ]),
    listMembers: vi.fn(async () => [
      { value: "u1", description: "alice" },
      { value: "u2", description: "bob" },
    ]),
    ...overrides,
  };
}

/** Extract just the candidate values for terse assertions. */
const values = (c: { value: string }[]): string[] => c.map((x) => x.value);

describe("runComplete", () => {
  let program: Command;
  beforeEach(() => {
    program = buildProgram();
  });

  describe("subcommands", () => {
    it("lists all top-level subcommands when current is empty", async () => {
      const out = await runComplete(program, [""], makeDeps());
      expect(values(out).sort()).toEqual(["agent", "channel", "kick", "read", "send"]);
    });

    it("filters subcommands by prefix", async () => {
      const out = await runComplete(program, ["se"], makeDeps());
      expect(values(out)).toEqual(["send"]);
    });

    it("completes nested subcommands (channel -> delete|rename)", async () => {
      const out = await runComplete(program, ["channel", ""], makeDeps());
      expect(values(out).sort()).toEqual(["delete", "rename"]);
    });

    it("filters nested subcommands by prefix", async () => {
      const out = await runComplete(program, ["channel", "de"], makeDeps());
      expect(values(out)).toEqual(["delete"]);
    });

    it("attaches the command description", async () => {
      const out = await runComplete(program, ["channel", ""], makeDeps());
      expect(out.find((c) => c.value === "delete")?.description).toBe("delete a channel");
    });
  });

  describe("option flags", () => {
    it("completes only long flags for `--`", async () => {
      const out = await runComplete(program, ["send", "--"], makeDeps());
      expect(values(out).sort()).toEqual(["--channel", "--config", "--json"]);
    });

    it("completes long+short flags for `-`", async () => {
      const out = await runComplete(program, ["send", "-"], makeDeps());
      expect(values(out)).toEqual(
        expect.arrayContaining(["--channel", "-r", "--json", "--config", "-c"]),
      );
      expect(out.some((c) => c.value === "-r")).toBe(true);
    });

    it("filters flags by prefix", async () => {
      const out = await runComplete(program, ["send", "--c"], makeDeps());
      expect(values(out).sort()).toEqual(["--channel", "--config"]);
    });

    it("propagates the global -c/--config to subcommands but not --version", async () => {
      program.version("1.0.0", "-v, --version");
      const out = await runComplete(program, ["send", "--"], makeDeps());
      expect(values(out)).toContain("--config");
      expect(values(out)).not.toContain("--version");
    });

    it("lists --version at the top level", async () => {
      program.version("1.0.0", "-v, --version");
      const out = await runComplete(program, ["--"], makeDeps());
      expect(values(out)).toContain("--version");
    });
  });

  describe("option-value completion (dynamic)", () => {
    it("completes --channel values via listChannels", async () => {
      const deps = makeDeps();
      const out = await runComplete(program, ["send", "--channel", ""], deps);
      expect(values(out).sort()).toEqual(["dev", "general", "random"]);
      expect(deps.listChannels).toHaveBeenCalledOnce();
    });

    it("completes -r (short) values too", async () => {
      const out = await runComplete(program, ["read", "-r", ""], makeDeps());
      expect(values(out).sort()).toEqual(["dev", "general", "random"]);
    });

    it("filters channel values by prefix", async () => {
      const out = await runComplete(program, ["read", "--channel", "ra"], makeDeps());
      expect(values(out)).toEqual(["random"]);
    });

    it("completes inline --channel=<partial> (zsh = form)", async () => {
      const out = await runComplete(program, ["read", "--channel=ra"], makeDeps());
      expect(values(out)).toEqual(["--channel=random"]);
    });

    it("returns nothing for value-options without a completer (--since <id>)", async () => {
      const out = await runComplete(program, ["read", "--since", ""], makeDeps());
      expect(out).toEqual([]);
    });

    it("returns [] (not throw) when listChannels rejects", async () => {
      const deps = makeDeps({
        listChannels: vi.fn(async () => {
          throw new Error("offline");
        }),
      });
      const out = await runComplete(program, ["send", "--channel", ""], deps);
      expect(out).toEqual([]);
    });

    it("skips the option value token when walking past --channel <val>", async () => {
      // `send --channel general ` -> now completing the next positional (text);
      // send has no positional completer -> [].
      const out = await runComplete(program, ["send", "--channel", "general", ""], makeDeps());
      expect(out).toEqual([]);
    });
  });

  describe("positional completion (dynamic)", () => {
    it("completes `channel delete <slug>` via listChannels", async () => {
      const deps = makeDeps();
      const out = await runComplete(program, ["channel", "delete", ""], deps);
      expect(values(out).sort()).toEqual(["dev", "general", "random"]);
    });

    it("completes `channel rename <slug>` via listChannels", async () => {
      const out = await runComplete(program, ["channel", "rename", ""], makeDeps());
      expect(values(out).sort()).toEqual(["dev", "general", "random"]);
    });

    it("completes `kick <id>` via listMembers", async () => {
      const deps = makeDeps();
      const out = await runComplete(program, ["kick", ""], deps);
      expect(values(out).sort()).toEqual(["u1", "u2"]);
      expect(deps.listMembers).toHaveBeenCalledOnce();
    });

    it("returns nothing for positionals without a completer (send text)", async () => {
      const out = await runComplete(program, ["send", ""], makeDeps());
      expect(out).toEqual([]);
    });
  });

  describe("`--` passthrough", () => {
    it("returns [] after `agent --` (defer to shell default)", async () => {
      const out = await runComplete(program, ["agent", "--", ""], makeDeps());
      expect(out).toEqual([]);
    });

    it("still completes --channel before the `--`", async () => {
      const out = await runComplete(program, ["agent", "--channel", ""], makeDeps());
      expect(values(out).sort()).toEqual(["dev", "general", "random"]);
    });

    it("returns [] mid-passthrough (agent -- claude <TAB>)", async () => {
      const out = await runComplete(program, ["agent", "--", "claude", ""], makeDeps());
      expect(out).toEqual([]);
    });
  });

  describe("edge cases", () => {
    it("empty words -> top-level subcommands", async () => {
      const out = await runComplete(program, [], makeDeps());
      expect(values(out).sort()).toEqual(["agent", "channel", "kick", "read", "send"]);
    });

    it("no deps -> dynamic completions return [] without throwing", async () => {
      const out = await runComplete(program, ["kick", ""], {});
      expect(out).toEqual([]);
    });

    it("unknown subcommand token is treated as a positional (no crash)", async () => {
      const out = await runComplete(program, ["bogus", ""], {});
      expect(values(out).sort()).toEqual(["agent", "channel", "kick", "read", "send"]);
    });
  });
});

describe("printCompletions", () => {
  it("writes value lines, with tab+description when present", () => {
    const spy = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    printCompletions([
      { value: "general", description: "General" },
      { value: "dev" },
    ]);
    expect(spy).toHaveBeenCalledWith("general\tGeneral\n");
    expect(spy).toHaveBeenCalledWith("dev\n");
    spy.mockRestore();
  });

  it("writes nothing for an empty list", () => {
    const spy = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    printCompletions([]);
    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
  });
});
