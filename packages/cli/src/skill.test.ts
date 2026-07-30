import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  type AgentSkillSpec,
  buildInstallMessage,
  type BundledSkill,
  decideSkillInstall,
  detectInstalled,
  findAgentSkill,
  type InstalledSkill,
  needsUpdate,
  readSkillVersion,
} from "./skill.js";

// Each test gets a fresh temp dir as the fake project root (cwd), so detectInstalled
// writes/reads never touch the real ~/.claude etc.
let tmpDir: string;
beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), "club-skill-"));
});
afterEach(() => {
  rmSync(tmpDir, { recursive: true, force: true });
});

/** Build a minimal skill markdown body, with or without a version field. */
const SKILL = (v?: string): string =>
  `---\nname: club\n${v ? `version: ${v}\n` : ""}description: club skill\n---\n# club\nbody`;

describe("readSkillVersion", () => {
  it("reads version from frontmatter", () => {
    expect(readSkillVersion(SKILL("0.1.0"))).toBe("0.1.0");
  });
  it("returns null when no version field", () => {
    expect(readSkillVersion(SKILL())).toBeNull();
  });
  it("returns null when no frontmatter at all", () => {
    expect(readSkillVersion("# just body\nno fm")).toBeNull();
  });
  it("strips surrounding quotes", () => {
    expect(readSkillVersion(`---\nname: club\nversion: "0.2.0"\n---\n`)).toBe("0.2.0");
  });
  it("rejects non-semver values", () => {
    expect(readSkillVersion(`---\nname: club\nversion: latest\n---\n`)).toBeNull();
  });
  it("accepts a pre-release suffix (keeps full string)", () => {
    expect(readSkillVersion(`---\nname: club\nversion: 1.2.3-rc.1\n---\n`)).toBe("1.2.3-rc.1");
  });
});

describe("findAgentSkill", () => {
  it("matches claude", () => {
    expect(findAgentSkill("claude")?.agent).toBe("claude");
  });
  it("matches basename and is case-insensitive", () => {
    expect(findAgentSkill("/usr/local/bin/Claude")?.agent).toBe("claude");
  });
  it("matches opencode / codex / pi", () => {
    expect(findAgentSkill("opencode")?.agent).toBe("opencode");
    expect(findAgentSkill("codex")?.agent).toBe("codex");
    expect(findAgentSkill("pi")?.agent).toBe("pi");
  });
  it("returns null for unknown agent", () => {
    expect(findAgentSkill("gemini")).toBeNull();
  });
  it("codex has a global fallback path", () => {
    expect(findAgentSkill("codex")?.globalFallback).toBeTruthy();
  });
  it("pi uses flat club.md (not SKILL.md)", () => {
    const pi = findAgentSkill("pi");
    expect(pi?.file).toBe("club.md");
    expect(pi?.dir).toBe(".pi/skills");
  });
  it("claude/opencode/codex use <dir>/club/SKILL.md", () => {
    expect(findAgentSkill("claude")?.file).toBe("SKILL.md");
    expect(findAgentSkill("opencode")?.file).toBe("SKILL.md");
    expect(findAgentSkill("codex")?.file).toBe("SKILL.md");
  });
});

describe("detectInstalled", () => {
  it("returns null version + expected path when not installed", () => {
    const spec = findAgentSkill("claude")!;
    const r = detectInstalled(spec, tmpDir);
    expect(r.version).toBeNull();
    expect(r.path).toBe(join(tmpDir, ".claude", "skills", "club", "SKILL.md"));
  });
  it("reads the installed version", () => {
    const spec = findAgentSkill("claude")!;
    const dir = join(tmpDir, ".claude", "skills", "club");
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "SKILL.md"), SKILL("0.1.0"));
    expect(detectInstalled(spec, tmpDir).version).toBe("0.1.0");
  });
  it("treats installed-without-version as 0.0.0 (so it's seen as outdated)", () => {
    const spec = findAgentSkill("claude")!;
    const dir = join(tmpDir, ".claude", "skills", "club");
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "SKILL.md"), SKILL());
    expect(detectInstalled(spec, tmpDir).version).toBe("0.0.0");
  });
  it("pi detects flat .pi/skills/club.md", () => {
    const spec = findAgentSkill("pi")!;
    mkdirSync(join(tmpDir, ".pi", "skills"), { recursive: true });
    writeFileSync(join(tmpDir, ".pi", "skills", "club.md"), SKILL("0.1.0"));
    expect(detectInstalled(spec, tmpDir).version).toBe("0.1.0");
  });
  it("checks globalFallback when local is missing", () => {
    // Use a synthetic spec with a tmpDir-based globalFallback so we don't touch real ~.
    const globalPath = join(tmpDir, "global", "SKILL.md");
    const spec: AgentSkillSpec = {
      agent: "x",
      dir: ".x/skills/club",
      file: "SKILL.md",
      globalFallback: globalPath,
    };
    mkdirSync(dirname(globalPath), { recursive: true });
    writeFileSync(globalPath, SKILL("0.0.9"));
    const r = detectInstalled(spec, tmpDir);
    expect(r.version).toBe("0.0.9");
    expect(r.path).toBe(globalPath);
  });
  it("prefers local over globalFallback", () => {
    const globalPath = join(tmpDir, "global", "SKILL.md");
    const spec: AgentSkillSpec = {
      agent: "x",
      dir: ".x/skills/club",
      file: "SKILL.md",
      globalFallback: globalPath,
    };
    mkdirSync(dirname(globalPath), { recursive: true });
    writeFileSync(globalPath, SKILL("0.0.9"));
    const localDir = join(tmpDir, ".x", "skills", "club");
    mkdirSync(localDir, { recursive: true });
    writeFileSync(join(localDir, "SKILL.md"), SKILL("0.1.0"));
    expect(detectInstalled(spec, tmpDir).version).toBe("0.1.0");
  });
});

describe("needsUpdate", () => {
  it("true when not installed", () => {
    expect(needsUpdate({ version: null, path: "x" }, "0.1.0")).toBe(true);
  });
  it("true when installed is older", () => {
    expect(needsUpdate({ version: "0.0.9", path: "x" }, "0.1.0")).toBe(true);
  });
  it("false when same version", () => {
    expect(needsUpdate({ version: "0.1.0", path: "x" }, "0.1.0")).toBe(false);
  });
  it("false when installed is newer", () => {
    expect(needsUpdate({ version: "0.2.0", path: "x" }, "0.1.0")).toBe(false);
  });
});

describe("buildInstallMessage", () => {
  const bundled: BundledSkill = { text: "...", version: "0.1.0", path: "/bundled/SKILL.md" };

  it("includes bundled path, target path, version, and a mkdir+cp", () => {
    const spec = findAgentSkill("claude")!;
    const msg = buildInstallMessage(bundled, spec, "/proj");
    expect(msg).toContain("/bundled/SKILL.md");
    expect(msg).toContain("/proj/.claude/skills/club/SKILL.md");
    expect(msg).toContain("v0.1.0");
    expect(msg).toContain("mkdir -p");
    expect(msg).toContain("cp");
  });
  it("pi target is the flat club.md path", () => {
    const spec = findAgentSkill("pi")!;
    const msg = buildInstallMessage(bundled, spec, "/proj");
    expect(msg).toContain("/proj/.pi/skills/club.md");
  });
});

describe("decideSkillInstall", () => {
  const bundled: BundledSkill = { text: "...", version: "0.1.0", path: "/b/SKILL.md" };
  const deps = (b: BundledSkill | null, inst: InstalledSkill) => ({
    readBundledSkill: () => b,
    detectInstalled: () => inst,
  });

  it("disabled -> silent (no msg, no log)", () => {
    const d = decideSkillInstall("claude", "/p", { enabled: false }, deps(bundled, { version: null, path: "x" }));
    expect(d.msg).toBeNull();
    expect(d.log).toBeNull();
  });
  it("unknown cmd -> silent", () => {
    const d = decideSkillInstall("gemini", "/p", { enabled: true }, deps(bundled, { version: null, path: "x" }));
    expect(d.msg).toBeNull();
    expect(d.log).toBeNull();
  });
  it("bundled missing -> silent (fail-open)", () => {
    const d = decideSkillInstall("claude", "/p", { enabled: true }, deps(null, { version: null, path: "x" }));
    expect(d.msg).toBeNull();
    expect(d.log).toBeNull();
  });
  it("not installed -> install msg + 'not installed' log", () => {
    const d = decideSkillInstall("claude", "/p", { enabled: true }, deps(bundled, { version: null, path: "x" }));
    expect(d.msg).toContain("mkdir -p");
    expect(d.log).toContain("not installed");
  });
  it("outdated -> install msg with version bump in log", () => {
    const d = decideSkillInstall("claude", "/p", { enabled: true }, deps(bundled, { version: "0.0.9", path: "x" }));
    expect(d.msg).toContain("v0.1.0");
    expect(d.log).toContain("v0.0.9 -> v0.1.0");
  });
  it("current -> no msg, 'current' log", () => {
    const d = decideSkillInstall("claude", "/p", { enabled: true }, deps(bundled, { version: "0.1.0", path: "x" }));
    expect(d.msg).toBeNull();
    expect(d.log).toContain("current");
  });
  it("pi cmd produces a flat club.md install target", () => {
    const d = decideSkillInstall("pi", "/p", { enabled: true }, deps(bundled, { version: null, path: "x" }));
    expect(d.msg).toContain("/p/.pi/skills/club.md");
  });
});
