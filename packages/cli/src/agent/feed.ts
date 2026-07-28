// club 消息 → 单行注入文本的格式化 + 直连 SSE 订阅器。
//
// 这是 `club agent` 的数据源:直接用 ClubClient.stream() 订阅实时消息,
// 每条消息格式化成"给 agent 看的一条用户消息"压成严格单行,塞进
// QueuedInjector。**不经过 notify-panel** —— club stream 自身的 ulid 去重
// 已经保证了 exactly-once,无需"注入成功才标已读"那套契约。
//
// 对照 notify-panel-tui 的 watcher:那里轮询 daemon 的未读队列,注入成功才
// 标记已读;这里订阅 SSE 活流,消息天然不重复,投递即"已读"。

import type { ClubClient } from "@club/sdk";
import { mentionMatches,type Message } from "@club/shared";

/** 注入器接口:QueuedInjector 暴露的入队口(解耦,便于测试)。 */
export interface Enqueuer {
  enqueue(text: string): void;
}

export interface FeedOptions {
  /** 注入器(通常是 QueuedInjector)。 */
  inject: Enqueuer;
  /** 只订阅这个房间(默认:所有房间)。 */
  room?: string;
  /**
   * 只投递 @<mention> 的消息(默认:投递所有非自己发的消息)。
   * 用于"只被 @ 时才唤醒 agent"。
   */
  mention?: string;
  /** 当前自己的 participant id,用于跳过自己发的消息(避免回声)。 */
  meId?: string;
  /** 每次成功投递时回调(日志)。 */
  onDelivered?: (count: number) => void;
  /** stream 错误/重连时回调(日志)。 */
  onError?: (err: Error) => void;
}

/**
 * 单条注入文本长度上限。claude/codex 这类 TUI 的输入框遇到换行会进入多行
 * 编辑模式(回车变成"换行"而非"提交"),所以注入文本必须压成严格单行;
 * 超长截断并提示,agent 可自行用工具查详情。
 */
const MAX_INJECT_LEN = 500;

function severityEmoji(mentioned: boolean): string {
  return mentioned ? "🟡" : "🔵";
}

/**
 * 把一条 club 消息格式化成注入给 agent 的单行文本。
 *
 * 形如:`🟡[@dev] rex: @bot 帮我看下日志`(被 @ → 🟡 warning,否则 🔵 info)。
 * 强制去 `\r\n\t`、折叠空白、超长截断,保证回车 = 提交。
 */
export function formatForInject(m: Message, mentioned: boolean): string {
  const emoji = severityEmoji(mentioned);
  const room = m.room;
  const author = m.authorName;
  const body = m.content.trim();
  const head = `${emoji}[@${room}] ${author}:`;
  let text = body ? `${head} ${body}` : head;
  text = text.replace(/[\r\n\t]+/g, " ").replace(/\s+/g, " ").trim();
  if (text.length > MAX_INJECT_LEN) {
    text = text.slice(0, MAX_INJECT_LEN) + "…(已截断)";
  }
  return text;
}

/**
 * 一条消息是否应投递给 agent。
 *
 * 两个过滤,任一不满足就跳过:
 * 1. 自回声过滤:跳过自己发的消息(否则 agent 每发一条就被自己触发一次)。
 * 2. mention 过滤:设了 `mention` 时,只投递 @该名字 的消息。
 */
export function shouldDeliver(
  m: Message,
  opts: { meId?: string; mention?: string } = {},
): boolean {
  if (opts.meId && m.participantId === opts.meId) return false;
  if (opts.mention && !mentionMatches(m.content, opts.mention)) return false;
  return true;
}

/**
 * 启动 club SSE 订阅,把匹配的消息单行化后塞进注入器队列。
 *
 * 返回一个 `stop()` 句柄:关闭流、取消重连。进程退出前必须调用。
 * stream 自带断线重连 + since 游标补漏 + ulid 去重,这里不再做任何额外去重。
 *
 * @returns 停止句柄。
 */
export function startFeed(client: ClubClient, opts: FeedOptions): () => void {
  let delivered = 0;
  const streamOpts: Parameters<ClubClient["stream"]>[1] = {
    onError: opts.onError,
  };
  if (opts.room) streamOpts.room = opts.room;

  const handle = client.stream((m: Message) => {
    if (!shouldDeliver(m, { meId: opts.meId, mention: opts.mention })) return;
    const mentioned = opts.mention
      ? mentionMatches(m.content, opts.mention)
      : false;
    opts.inject.enqueue(formatForInject(m, mentioned));
    delivered++;
    opts.onDelivered?.(delivered);
  }, streamOpts);

  return () => handle.stop();
}
