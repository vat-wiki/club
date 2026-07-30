import { describe, expect, it } from "vitest";

import { runSkillStatus } from "./skill.js";
import type { AgentSkillSpec, BundledSkill, InstalledSkill } from "../skill.js";

const bundled: BundledSkill = { text: "...", version: "0.1.0", path: "/b/SKILL.md" };

describe("runSkillStatus", () => {
  it("throws when bundled skill is missing (broken install)", () => {
    expect(() =>
      runSkillStatus(
        { cwd: "/p" },
        { readBundledSkill: () => null, detectInstalled: () => ({ version: null, path: "x" }) },
      ),
    ).toThrow(/bundled/);
  });

  it("reports per-agent status across all 4 agents", () => {
    const detect = (spec: AgentSkillSpec): InstalledSkill => {
      if (spec.agent === "claude") return { version: "0.1.0", path: "..." };
      if (spec.agent === "codex") return { version: "0.0.9", path: "..." };
      return { version: null, path: "..." };
    };
    const r = runSkillStatus(
      { cwd: "/p" },
      { readBundledSkill: () => bundled, detectInstalled: detect },
    );
    expect(r.bundledVersion).toBe("0.1.0");
    expect(r.agents).toHaveLength(4);
    const map = Object.fromEntries(r.agents.map((a) => [a.agent, a.status]));
    expect(map.claude).toBe("uptodate");
    expect(map.codex).toBe("outdated");
    expect(map.opencode).toBe("missing");
    expect(map.pi).toBe("missing");
  });

  it("labels installed-newer-than-bundled as 'newer'", () => {
    const r = runSkillStatus(
      { cwd: "/p" },
      {
        readBundledSkill: () => bundled,
        detectInstalled: () => ({ version: "0.2.0", path: "..." }),
      },
    );
    expect(r.agents.every((a) => a.status === "newer")).toBe(true);
  });

  it("labels installed-without-version as outdated (0.0.0 < bundled)", () => {
    const r = runSkillStatus(
      { cwd: "/p" },
      {
        readBundledSkill: () => bundled,
        detectInstalled: () => ({ version: "0.0.0", path: "..." }),
      },
    );
    expect(r.agents.every((a) => a.status === "outdated")).toBe(true);
  });
});
