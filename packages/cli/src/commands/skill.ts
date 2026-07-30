// club skill
//
// 查看 club skill 在各 TUI agent(claude/opencode/codex/pi) 当前项目下的安装状态，
// 以及 bundled skill 的路径。**不直接安装**--装的动作归 agent 自己(见 skill.ts 设计):
//   club skill status   各 agent 目录下 club skill 版本 vs bundled
//   club skill path     bundled 绝对路径 + 各 agent 目标路径(调试/手装参考)
//
// 与 `club agent <cmd>` 的自动同步配合:agent 启动时自检并在缺失/更旧时被通知装;
// 此命令给人主动看一眼当前装到哪了。

import { Command } from "commander";

import { withCatchExit } from "../catch-exit.js";
import {
  AGENTS,
  type AgentSkillSpec,
  type BundledSkill,
  detectInstalled,
  type InstalledSkill,
  readBundledSkill,
} from "../skill.js";
import { isNewer } from "../update.js";

/** 单个 agent 的状态行。 */
export interface AgentStatus {
  agent: string;
  /** missing=未装；uptodate=与 bundled 同版；outdated=比 bundled 旧；newer=比 bundled 还新。 */
  status: "missing" | "uptodate" | "outdated" | "newer";
  /** 已装版本(缺失为 null)。 */
  installed: string | null;
  /** 检测到的文件路径。 */
  path: string;
}

/** `club skill status` 的聚合结果。 */
export interface SkillStatusResult {
  bundledVersion: string;
  bundledPath: string;
  agents: AgentStatus[];
}

/** Inputs for `runSkillStatus`. */
export interface SkillStatusInput {
  /** 项目根(cwd)，agent 目录在其下查找。 */
  cwd: string;
}

/** Dependency shape for `runSkillStatus`, injected by the CLI action or by tests. */
export interface SkillStatusDeps {
  readBundledSkill: () => BundledSkill | null;
  detectInstalled: (spec: AgentSkillSpec, cwd: string) => InstalledSkill;
}

/**
 * 把已装版本 + bundled 版本归并为一个状态标签。
 */
function statusLabel(installed: InstalledSkill, bundledVersion: string): AgentStatus["status"] {
  if (installed.version === null) return "missing";
  if (installed.version === bundledVersion) return "uptodate";
  return isNewer(bundledVersion, installed.version) ? "outdated" : "newer";
}

/**
 * 计算 `club skill status` 的结果而不触及 commander / 真实 fs(通过 deps 注入)。
 * bundled 缺失时抛错--这表示 club-cli 安装损坏，应让用户看见。
 */
export function runSkillStatus(input: SkillStatusInput, deps: SkillStatusDeps): SkillStatusResult {
  const bundled = deps.readBundledSkill();
  if (!bundled) {
    throw new Error("bundled club skill not found (club-cli install broken?)");
  }
  const agents: AgentStatus[] = AGENTS.map((spec) => {
    const inst = deps.detectInstalled(spec, input.cwd);
    return {
      agent: spec.agent,
      status: statusLabel(inst, bundled.version),
      installed: inst.version,
      path: inst.path,
    };
  });
  return { bundledVersion: bundled.version, bundledPath: bundled.path, agents };
}

/** 左对齐填充到固定宽度，供表格化输出。 */
function pad(s: string, w: number): string {
  return s.length >= w ? s : s + " ".repeat(w - s.length);
}

/**
 * `club skill status` - 打印各 agent 下 club skill 的安装状态。
 */
export function makeSkillCommand(): Command {
  const skill = new Command("skill").description(
    "check club skill install state across agents (claude/opencode/codex/pi)",
  );

  skill
    .command("status")
    .description("show each agent's installed club skill version vs bundled")
    .action(
      withCatchExit(() => {
        const r = runSkillStatus(
          { cwd: process.cwd() },
          { readBundledSkill, detectInstalled },
        );
        console.log(`club skill v${r.bundledVersion} (bundled: ${r.bundledPath})\n`);
        for (const a of r.agents) {
          const ver = a.installed ? `v${a.installed}` : "-";
          console.log(`${pad(a.agent, 10)} ${pad(a.status, 9)} ${pad(ver, 10)} ${a.path}`);
        }
      }),
    );

  skill
    .command("path")
    .description("print bundled skill path and each agent's target path")
    .action(
      withCatchExit(() => {
        const bundled = readBundledSkill();
        const cwd = process.cwd();
        if (!bundled) {
          console.error("error: bundled club skill not found (club-cli install broken?)");
          process.exit(1);
        }
        console.log(`bundled: ${bundled.path}\n`);
        for (const spec of AGENTS) {
          const target = `${spec.dir}/${spec.file}`;
          console.log(`${pad(spec.agent, 10)} -> ${target}`);
        }
        console.log(`\n(cwd: ${cwd})`);
      }),
    );

  return skill;
}
