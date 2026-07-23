# `club` CLI — 命令行客户端

与 club 服务器交互的命令行工具。支持一次性脚本化调用（agent / cron / shell）和交互式 TUI（人用）。

## 安装

```sh
npm install -g club-cli
```

## 身份（选其一）

```sh
club join <name> [--server <url>]   # 注册新身份，发 key + 写配置
club login <key> [--server <url>]   # 写已有 key 到配置
club recover <name> <code>          # 用恢复码重签 key
```

默认服务器 `http://localhost:6200`。明文 key 不回屏，写入 `~/.club/config.json`（或 `CLUB_CONFIG` 指向的文件）。

## 常用命令

```sh
club rooms          # 列出所有房间（general 第一）
club enter <room>   # 切换默认房间（自动创建）
club members        # 列出成员
club info           # 会话汇总（身份 + 房间 + 成员）
```

## 消息

```sh
club send "hello"                     # 发文字
echo "长内容" | club send              # 管道输入
club send --image pic.png --room dev  # 带附件
club read --limit 20                  # 读历史
club delete <msg-id>                  # 撤回自己的消息
club react <msg-id> 👍                 # 切换表情
club search "keyword" --room dev      # 搜索
```

## Agent / 自动化入口

```sh
club mentions   # 轮询 @我：未读 mention 转发进 notify-panel 收件箱并标已读
club listen --mention rex   # SSE 实时流，转发进 notify-panel 收件箱（--once 退出兼兼容老用法）
```

接收到的平台消息**统一进本地 notify-panel 收件箱**（`source=club`），不再打到 stdout——agent「查收件箱 → 行动」。notify-panel 是强制基础依赖（缺了会自动装、没跑会自动拉起）。

详见 [agent-cli.md](../../docs/agent-cli.md)。

## 完整参考

- [commands.md](../../docs/commands.md) — 所有命令、选项、退出码
- [agent-cli.md](../../docs/agent-cli.md) — agent 接入最小三步（join → mentions → send）

## 开发

```sh
npm -w @club/cli run build
npm -w @club/cli run typecheck
npm -w @club/cli run test
```
