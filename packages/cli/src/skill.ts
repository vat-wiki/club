// club skill 同步核心 -- 让任意 TUI agent(claude/opencode/codex/pi) 在当前项目里
// 装上最新的 club skill。
//
// 设计：CLI **只检测 + 通知**，不直接写 agent 目录。
//   club agent <cmd> 启动 -> 据 cmd 查 per-agent 适配表 -> 在 cwd 下找已装 club skill
//   -> 读 frontmatter version -> 对比 bundled -> 缺失/更旧则往 PTY 注入一条"安装消息"，
//   agent 收到后自己 cp 落地(它懂自己的目录与格式)。格式差异(pi 平铺 .md、codex 全局
//   skills)天然交给 agent，CLI 无写权限/格式负担。
//
// 4 家 skill 文件都是 markdown + YAML frontmatter，故版本检索统一：解析 frontmatter
// 的 version 字段(无依赖正则)。bundled 单源 packages/cli/skill/SKILL.md，frontmatter
// 带 version；claude/opencode/codex 原生 <dir>/SKILL.md，pi 由 agent 适配成 .pi/skills/club.md。

import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { isNewer } from "./update.js";

/**
 * Bundled SKILL.md 的绝对路径。
 *
 * `import.meta.url` 在 dev(src/index.ts)与 prod(dist/index.js)下都指向运行文件本身，
 * 其上一级就是 `skill/` 目录(dev: src/../skill，prod: dist/../skill)，故统一用 `..`。
 */
export function bundledSkillPath(): string {
  return join(dirname(fileURLToPath(import.meta.url)), "..", "skill", "SKILL.md");
}

// --- frontmatter version 解析(无依赖) ----------------------------------------

const FRONTMATTER_RE = /^---\r?\n([\s\S]*?)\r?\n---/;
const VERSION_LINE_RE = /^version:\s*(.+?)\s*$/m;
const VERSION_VALID_RE = /^\d+\.\d+\.\d+/; // 接受任意 x.y.z 前缀(与 update.ts 一致)

/**
 * 从 skill markdown 文本解析 frontmatter 的 `version` 字段。
 *
 * 跨 claude/opencode/codex/pi 统一:4 家 skill 文件都是 markdown+YAML frontmatter，
 * `version:` 作为顶层 YAML 行无论 agent 是否"使用"它都会被保留在文件里，CLI 直接读。
 * 无 frontmatter / 无 version / 非法 -> null。
 */
export function readSkillVersion(text: string): string | null {
  const fm = FRONTMATTER_RE.exec(text);
  if (!fm) return null;
  const m = VERSION_LINE_RE.exec(fm[1]);
  if (!m) return null;
  const v = m[1].trim().replace(/^["']|["']$/g, "");
  return VERSION_VALID_RE.test(v) ? v : null;
}

/** Bundled skill 的完整快照。 */
export interface BundledSkill {
  /** SKILL.md 全文。 */
  text: string;
  /** frontmatter version；缺失视为 "0.0.0" 以便旧的无 version 装被判为更旧。 */
  version: string;
  /** bundled 绝对路径(注入给 agent 做 cp 源)。 */
  path: string;
}

/**
 * 读取 bundled skill。缺失/读不到 -> null(fail-open，调用方据此跳过同步)。
 */
export function readBundledSkill(): BundledSkill | null {
  const p = bundledSkillPath();
  let text: string;
  try {
    text = readFileSync(p, "utf8");
  } catch {
    return null;
  }
  const version = readSkillVersion(text) ?? "0.0.0";
  return { text, version, path: p };
}

// --- per-agent 适配表(硬编码 4 家，不数据驱动) --------------------------------

/**
 * 一个 agent 的 club skill 落点约定。
 *
 * `dir`+`file` 拼成 cwd 下的相对路径:claude/opencode/codex 是 `<...>/club/SKILL.md`，
 * pi 是 `.pi/skills/club.md`(平铺单文件)。`globalFallback` 用于 codex--它的 skills
 * 主要装在全局 `~/.codex/skills/`，项目级 `.codex/skills/` 未必启用，故检测时双查。
 */
export interface AgentSkillSpec {
  /** agent 名(cmd basename 小写匹配)。 */
  agent: string;
  /** 二进制别名(不同发行版/包装名)。 */
  aliases?: string[];
  /** cwd 下 skill 所在目录(相对)。 */
  dir: string;
  /** skill 文件名。 */
  file: string;
  /** 全局 fallback 绝对路径(可选)。 */
  globalFallback?: string;
}

/** 4 家显式适配。未知 cmd(如 gemini)查不到 -> 调用方安静跳过。 */
export const AGENTS: readonly AgentSkillSpec[] = [
  { agent: "claude", dir: ".claude/skills/club", file: "SKILL.md" },
  { agent: "opencode", dir: ".opencode/skills/club", file: "SKILL.md" },
  { agent: "codex", dir: ".codex/skills/club", file: "SKILL.md", globalFallback: join(homedir(), ".codex", "skills", "club", "SKILL.md") },
  { agent: "pi", dir: ".pi/skills", file: "club.md" },
];

/**
 * 据 cmd 路径找适配表条目。取 basename 小写匹配 agent/aliases。未知 -> null。
 */
export function findAgentSkill(cmd: string): AgentSkillSpec | null {
  const name = basename(cmd).toLowerCase();
  for (const a of AGENTS) {
    if (a.agent === name) return a;
    if (a.aliases?.includes(name)) return a;
  }
  return null;
}

/** 已装 skill 的检测结果。 */
export interface InstalledSkill {
  /** 已装版本；文件存在但无 version 字段 -> "0.0.0"；文件不存在 -> null。 */
  version: string | null;
  /** 检测到的文件路径(不存在时为 cwd 下应有路径，供安装消息引用)。 */
  path: string;
}

/**
 * 检测 cwd 下某 agent 已装的 club skill。codex 同时查 globalFallback。
 *
 * 命中第一个存在的文件即返回其版本(无 version 字段视为 "0.0.0"，判为更旧需更新)。
 * 全都不存在 -> { version: null, path: cwd 下应有路径 }。
 */
export function detectInstalled(spec: AgentSkillSpec, cwd: string): InstalledSkill {
  const local = resolve(cwd, spec.dir, spec.file);
  const candidates = [local];
  if (spec.globalFallback) candidates.push(spec.globalFallback);
  for (const p of candidates) {
    if (!existsSync(p)) continue;
    try {
      const text = readFileSync(p, "utf8");
      return { version: readSkillVersion(text) ?? "0.0.0", path: p };
    } catch {
      /* 读失败当未装，继续查下一个候选 */
    }
  }
  return { version: null, path: local };
}

/**
 * 是否需要同步:未装(installed.version===null)或 bundled 更新都返回 true。
 */
export function needsUpdate(installed: InstalledSkill, bundledVersion: string): boolean {
  if (installed.version === null) return true;
  return isNewer(bundledVersion, installed.version);
}

/**
 * 组装注入给 agent 的安装指令文本。
 *
 * 给出 bundled 绝对路径 + 目标路径 + 一条现成 `mkdir -p && cp`，agent 收到后直接执行
 * 即可落地(它懂自己格式:pi 会得到 .pi/skills/club.md，其余 <dir>/SKILL.md)。
 * 语气是指令而非提问，且明说"不用回复"以降低噪音。
 */
export function buildInstallMessage(bundled: BundledSkill, spec: AgentSkillSpec, cwd: string): string {
  const target = resolve(cwd, spec.dir, spec.file);
  const dir = dirname(target);
  return [
    `[club-cli] club skill 有更新(v${bundled.version})，请在当前项目装一下:`,
    `  mkdir -p "${dir}" && cp "${bundled.path}" "${target}"`,
    `装好就行，不用回复我，继续你手头的事。`,
  ].join("\n");
}

/** `club agent <cmd>` 启动时的 skill 同步决策结果。 */
export interface SkillSyncDecision {
  /** 注入给 agent 的安装消息；null=无需同步/未命中/被禁用/bundled 缺失。 */
  msg: string | null;
  /** 给 stderr 的人类可读一行日志；null=静默(未命中/被禁用)。 */
  log: string | null;
}

/** decideSkillInstall 的依赖(测试可注入 mock fs)。 */
export interface SkillSyncDeps {
  readBundledSkill: () => BundledSkill | null;
  detectInstalled: (spec: AgentSkillSpec, cwd: string) => InstalledSkill;
}

/**
 * 决定 `club agent <cmd>` 启动时是否通知 agent 装 skill。纯逻辑,所有 fs 读通过
 * deps 注入(默认用真实实现)。agent.ts 调用它并把 msg 入队、log 写 stderr。
 *
 * - 禁用 / 未命中 cmd / bundled 缺失 -> {msg:null, log:null}(静默)
 * - 需更新(未装或更旧) -> {msg: 安装消息, log: 版本变化}
 * - 已最新 -> {msg:null, log: "skill current"}
 */
export function decideSkillInstall(
  cmd: string,
  cwd: string,
  opts: { enabled: boolean },
  deps: SkillSyncDeps = { readBundledSkill, detectInstalled },
): SkillSyncDecision {
  if (!opts.enabled) return { msg: null, log: null };
  const spec = findAgentSkill(cmd);
  if (!spec) return { msg: null, log: null };
  const bundled = deps.readBundledSkill();
  if (!bundled) return { msg: null, log: null };
  const inst = deps.detectInstalled(spec, cwd);
  if (needsUpdate(inst, bundled.version)) {
    return {
      msg: buildInstallMessage(bundled, spec, cwd),
      log: `club agent: skill ${
        inst.version ? `v${inst.version} -> v${bundled.version}` : `v${bundled.version} (not installed)`
      }; asked agent to install`,
    };
  }
  return { msg: null, log: `club agent: skill current (v${bundled.version})` };
}
