// club 消息 → 单行注入文本的格式化 + 直连 SSE 订阅器。
//
// 这是 `club agent` 的数据源:直接用 ClubClient.stream() 订阅实时消息,
// 每条消息格式化成"给 agent 的一条通知"(只含来源/房间/消息 id,不发正文)
// 压成严格单行,塞进 QueuedInjector。**不经过 notify-panel** —— club stream
// 自身的 ulid 去重已经保证了 exactly-once,无需"注入成功才标已读"那套契约。
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
 * 把一条 club 消息格式化成注入给 agent 的单行**通知**。
 *
 * club 的职责只是告诉 agent「有事找你」;要不要 `club read` 取正文、要不要
 * 回复,是 agent 自己的事。所以注入文本只是一条通知头:来源(club)、房间、
 * 消息 id(供 agent 拉上下文 `club read --since <id>`),外加一句「是否查看/
 * 回复由你定」把可选性讲死 —— 避免把 `@bot 去做X` 这种正文直接灌进去,被
 * agent 当成必须执行的任务。
 *
 * 严格单行:claude/codex 这类 TUI 输入框遇换行会进多行编辑模式(回车变
 * "换行"而非"提交")。这里只含受控字段(房间 slug / ulid id),无自由文本,
 * 天然无换行/超长风险。
 */
export function formatForInject(m: Message): string {
  return `🔔 club 发来一条通知 · #${m.room} · ${m.id} · 是否查看/回复由你定`;
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
    opts.inject.enqueue(formatForInject(m));
    delivered++;
    opts.onDelivered?.(delivered);
  }, streamOpts);

  return () => handle.stop();
}
