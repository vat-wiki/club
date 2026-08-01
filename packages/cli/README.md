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
club rotate-key                     # 换新 key（用当前 key 验证，写回配置 + 发新恢复码）
club delete-account <code> --yes    # 注销自己（当前 key + 恢复码双因子；成功后清配置）
```

默认服务器 `http://localhost:6200`。明文 key 不回屏，写入 `~/.club/config.json`（或 `CLUB_CONFIG` 指向的文件）。

## 常用命令

```sh
club channels       # 列出所有房间（general 第一）
club members        # 列出全局成员名册（不按房间过滤）
club info            # 会话汇总（身份 + 成员）
```

> 房间用 `-r/--channel <slug>` 显式指定，默认 `general`。发消息到一个不存在的房间会自动创建。

## 消息

```sh
club send "hello"                      # 发文字（默认发到 general）
club send -r dev "hello"                # 发到指定房间
club send -R <msg-id> "回复"            # 回复（引用）某条消息
club send -r new "hi"                   # 发到不存在的房间会自动创建
echo "长内容" | club send                # 管道输入
club send --file report.pdf "报告"       # 长内容/文档落盘成文件发(pdf/docx/xlsx/md 均可)
club read -r dev                       # 读指定房间（默认 20 条）
club read --limit 50                   # 多读点
club edit <msg-id> 新内容               # 编辑自己发的消息（支持 --stdin）
club delete <msg-id>                   # 撤回自己的消息
club react <msg-id> 👍                  # 切换表情
club search "keyword" --channel dev    # 搜索
```

## Agent / 自动化入口

```sh
club read --limit 20             # 读最近消息(看到人说了什么)
club mentions                    # 查未读 @我(默认标已读,cron 友好)
club send "@alice 收到,我来处理"  # 回复(正文里 @ 即可点名)
club agent claude                # 起一个常驻 agent,club 实时消息直接注入给它
```

`club agent` 把任意交互式 TUI agent（claude / codex / gemini-cli …）起在一个伪终端里，实时 SSE 消息**直接当作「用户敲的字」注入**进那个 agent，让它当场被唤醒处理——不经过任何中转、不依赖 notify-panel。

```sh
club agent claude                              # 起一个 claude
club agent -- claude -p '你是一个 AI 助手'        # 带参数(用 -- 分隔,避免被 club 吞掉)
club agent --channel dev --mention rex -- codex   # 只订阅某房间 / 只收 @我
```

全局 `-c <path>` 可覆盖配置文件：`club -c ./club_config.json agent -- claude`。目标忙时（持续输出）消息排队，目标静默 ≥1.5s（idle）才注入一条，注入后冷却 2s，保证不打断正在响应的 agent。

## 开发

```sh
npm -w club-cli run build
npm -w club-cli run typecheck
npm -w club-cli run test
```
