// idle 推断 + 注入排队 —— "忙就不注入"的核心。
//
// 对任意 TUI 通用的策略:**基于输出活动推断 busy/idle**。
//   - TUI 忙时持续刷新输出(spinner / 进度 / token 计数 / 流式文本)
//   - TUI idle 时输出停止
//
// 用静默期(quiescence)作为 idle 判据:超过 IDLE_QUIET_MS 没有新输出 → idle。
// 这是唯一不依赖目标私有协议、对所有 TUI 都成立的启发式。代价:不是 100%
// 精确(一个慢吞吞等待的 prompt 也算 idle,但这正是我们想注入的时刻)。
//
// 状态机:
//   busy ──(静默超时)──▶ idle ──(队列非空)──▶ 注入一条 ──▶ busy(cooldown)
//   busy 期间来的注入请求进队列,不丢、不打断。
//
// 本文件从 notify-panel/extensions/tui/src/queue.ts 原样移植 —— 它是数据源
// 无关的纯逻辑(只依赖一个 inject(text) 回调),换成 club stream 做数据源后
// 行为完全一致。

/** 注入函数:把一段文本 + 回车写进目标。返回是否成功。 */
export type InjectFn = (text: string) => boolean;

/** idle 状态变化回调,供 UI 展示(可选)。 */
export type OnStateChange = (
  state: "busy" | "idle",
  queueDepth: number,
) => void;

/** 配置常量(按需调,默认值偏保守)。 */
export const IDLE_QUIET_MS = 1500; // 静默多久算 idle。claude spinner 帧间隔远小于此
export const POST_INJECT_COOLDOWN_MS = 2000; // 注入后强制 busy 多久,等目标"接住"输入

/**
 * 活动追踪 + 排队注入器。
 *
 * 用法:把它接到 child.onData(每次目标输出都喂 observeOutput),
 * 外部事件源调 enqueue(text) 排队;它自己决定何时真正 inject。
 */
export class QueuedInjector {
  private state: "busy" | "idle" = "idle";
  private lastOutputAt: number;
  private cooldownUntil = 0; // 注入后的强制 busy 截止时间
  private queue: string[] = [];
  private timer: ReturnType<typeof setTimeout> | undefined;

  constructor(
    private inject: InjectFn,
    private onChange?: OnStateChange,
  ) {
    // 初始化为当前时间:语义是"刚有过输出"(= 从未输出也算空闲)。
    // 若初始化为 0,会与假时钟的 epoch 错位,导致 since 巨大、timer 立即触发。
    this.lastOutputAt = Date.now();
  }

  /** 目标产生了输出 → 标记为 busy。由调用方在 child.onData 里调用。 */
  observeOutput(): void {
    this.lastOutputAt = Date.now();
    if (this.state === "idle") {
      this.setState("busy");
    }
    this.armTimer();
  }

  /** 外部事件来了,排队等注入。busy 时不会立刻注入,等 idle。 */
  enqueue(text: string): void {
    this.queue.push(text);
    // 即便 idle,也走 timer 路径注入,避免重入 + 跟输出观察争用
    this.armTimer();
  }

  /** 当前队列深度(供 UI / 测试)。 */
  get queueDepth(): number {
    return this.queue.length;
  }

  /** 当前状态。 */
  get currentState(): "busy" | "idle" {
    return this.state;
  }

  /** 停止所有定时器(进程退出时调)。 */
  dispose(): void {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = undefined;
    }
  }

  // ───────── 内部 ─────────

  private setState(s: "busy" | "idle"): void {
    if (this.state === s) return;
    this.state = s;
    this.onChange?.(s, this.queue.length);
  }

  /**
   * (重新)设定下次检查定时器。每次有输出或入队都重新对齐。
   * 定时器触发时:若已静默够久 → idle → 尝试出队注入。
   */
  private armTimer(): void {
    if (this.timer) clearTimeout(this.timer);
    // 计算距离 idle 还要多久(至少留一点缓冲,避免抖动)
    const since = Date.now() - this.lastOutputAt;
    const wait = Math.max(0, IDLE_QUIET_MS - since);
    this.timer = setTimeout(() => this.onTick(), wait);
  }

  private onTick(): void {
    const now = Date.now();
    // 冷却期内强制 busy,不给静默判定推翻。等冷却结束再判断。
    if (now < this.cooldownUntil) {
      if (this.timer) clearTimeout(this.timer);
      this.timer = setTimeout(() => this.onTick(), this.cooldownUntil - now);
      return;
    }
    // 判断是否已静默够久
    const quietFor = now - this.lastOutputAt;
    if (quietFor >= IDLE_QUIET_MS) {
      this.setState("idle");
      // idle 且队列有货 → 注入一条
      if (this.queue.length > 0) {
        const text = this.queue.shift()!;
        if (this.inject(text)) {
          // 注入成功:强制 busy 一段冷却期,等目标"接住"并开始响应。
          // 冷却期不被静默推翻(否则刚注入完的静默会被立刻判 idle 连注)。
          this.lastOutputAt = now;
          this.cooldownUntil = now + POST_INJECT_COOLDOWN_MS;
          this.setState("busy");
          this.timer = setTimeout(() => this.onTick(), POST_INJECT_COOLDOWN_MS);
          return;
        }
        // 注入失败(目标已退?):把消息放回队头,不丢。下次再试。
        this.queue.unshift(text);
        return;
      }
      // 队列空 + idle:无需再定时,等下次 observeOutput/enqueue 重新 arm
      this.timer = undefined;
      return;
    }
    // 还没静默够久:继续等
    this.armTimer();
  }
}
