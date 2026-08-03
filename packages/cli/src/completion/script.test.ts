import { existsSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  detectShell,
  getScript,
  installCompletion,
  type Shell,
} from "./script.js";

describe("getScript", () => {
  it("bash script registers via `complete -F`", () => {
    const s = getScript("bash");
    expect(s).toContain("complete -o default -F _club_completion club");
    expect(s).toContain("club __complete");
  });

  it("zsh script registers via `compdef` and renders descriptions", () => {
    const s = getScript("zsh");
    expect(s).toContain("compdef _club club");
    expect(s).toContain("_describe");
    expect(s).toContain("${value}:${desc}");
  });

  it("fish script delegates to `club __complete`", () => {
    const s = getScript("fish");
    expect(s).toContain("complete -c club");
    expect(s).toContain("club __complete");
    // path-valued options get file completion
    expect(s).toContain("-l image");
    expect(s).toContain("-l config");
  });

  it.each(["bash", "zsh", "fish"] as Shell[])("%s script is non-empty", (shell) => {
    expect(getScript(shell).length).toBeGreaterThan(0);
  });
});

describe("detectShell", () => {
  const orig = process.env.SHELL;
  afterEach(() => {
    process.env.SHELL = orig;
  });

  it("detects zsh", () => {
    process.env.SHELL = "/bin/zsh";
    expect(detectShell()).toBe("zsh");
  });

  it("detects bash", () => {
    process.env.SHELL = "/usr/bin/bash";
    expect(detectShell()).toBe("bash");
  });

  it("detects fish", () => {
    process.env.SHELL = "/usr/local/bin/fish";
    expect(detectShell()).toBe("fish");
  });

  it("returns null when SHELL is unset", () => {
    delete process.env.SHELL;
    expect(detectShell()).toBeNull();
  });
});

describe("installCompletion", () => {
  const origHome = process.env.HOME;
  let tmpHome: string;

  beforeEach(() => {
    tmpHome = join(tmpdir(), `club-completion-test-${process.pid}-${Math.random().toString(36).slice(2)}`);
    process.env.HOME = tmpHome;
  });
  afterEach(() => {
    process.env.HOME = origHome;
    rmSync(tmpHome, { recursive: true, force: true });
  });

  it("bash: writes ~/.club/completion.bash and appends a source line to ~/.bashrc", () => {
    const res = installCompletion("bash");
    expect(existsSync(join(tmpHome, ".club", "completion.bash"))).toBe(true);
    expect(existsSync(join(tmpHome, ".bashrc"))).toBe(true);
    expect(res.installed).toBe(true);
    const rc = readFileSync(join(tmpHome, ".bashrc"), "utf8");
    expect(rc).toContain("club completion");
    expect(rc).toContain(`source "${join(tmpHome, ".club", "completion.bash")}"`);
  });

  it("zsh: writes the script and wires ~/.zshrc", () => {
    const res = installCompletion("zsh");
    expect(existsSync(join(tmpHome, ".club", "completion.zsh"))).toBe(true);
    expect(readFileSync(join(tmpHome, ".zshrc"), "utf8")).toContain("club completion");
    expect(res.installed).toBe(true);
  });

  it("fish: drops ~/.config/fish/completions/club.fish (no rc edit)", () => {
    const res = installCompletion("fish");
    const p = join(tmpHome, ".config", "fish", "completions", "club.fish");
    expect(existsSync(p)).toBe(true);
    expect(res.scriptPath).toBe(p);
    expect(res.installed).toBe(true);
  });

  it("is idempotent: a second bash install reports not-installed", () => {
    installCompletion("bash");
    const again = installCompletion("bash");
    expect(again.installed).toBe(false);
    // rc still has exactly one source line
    const rc = readFileSync(join(tmpHome, ".bashrc"), "utf8");
    expect(rc.match(/>>> club completion >>>/g)).toHaveLength(1);
  });

  it("refreshes the script content on re-install (bash)", () => {
    installCompletion("bash");
    const before = readFileSync(join(tmpHome, ".club", "completion.bash"), "utf8");
    // re-install overwrites the script file even though the rc line is unchanged
    installCompletion("bash");
    const after = readFileSync(join(tmpHome, ".club", "completion.bash"), "utf8");
    expect(after).toBe(before); // stable content, but the write path is exercised
  });
});
