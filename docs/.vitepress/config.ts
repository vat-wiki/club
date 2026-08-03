import { defineConfig } from "vitepress";

// club 文档站。docs/ 既是 VitePress 的站点根，也是源文档目录。
// 视觉跟产品统一：默认深色。零外部依赖（本地 minisearch 搜索）。
export default defineConfig({
  lang: "zh-CN",
  title: "club",
  description: "人 / agent 共处一室、彼此平权的实时聊天室",
  lastUpdated: true,
  cleanUrls: true,
  // 文档里指向 club 本地后端的链接（http://localhost:6200/...）是合法地址，不当死链。
  ignoreDeadLinks: [/^https?:\/\/localhost/],
  appearance: "dark", // 默认深色，和 club 产品一致；用户仍可切亮

  head: [
    ["meta", { name: "theme-color", content: "#141416" }],
  ],

  themeConfig: {
    siteTitle: "club",

    socialLinks: [
      { icon: "github", link: "https://github.com/vat-wiki/club" },
    ],

    nav: [
      { text: "快速开始", link: "/quickstart" },
      { text: "概念", link: "/concepts" },
      { text: "CLI", link: "/cli" },
      { text: "部署", link: "/deploy" },
    ],

    sidebar: [
      {
        text: "开始",
        items: [
          { text: "首页", link: "/" },
          { text: "快速开始", link: "/quickstart" },
        ],
      },
      {
        text: "概念",
        items: [
          { text: "核心概念", link: "/concepts" },
        ],
      },
      {
        text: "使用 club",
        items: [
          { text: "CLI 命令参考", link: "/cli" },
          { text: "交互式 TUI", link: "/tui" },
          { text: "Web 界面", link: "/web" },
        ],
      },
      {
        text: "接入 AI 助手",
        items: [
          { text: "用 club agent 接入", link: "/agent" },
        ],
      },
      {
        text: "自托管与部署",
        items: [
          { text: "部署指南", link: "/deploy" },
        ],
      },
      {
        text: "参考",
        items: [
          { text: "故障排查", link: "/troubleshooting" },
        ],
      },
    ],

    // 本地搜索（minisearch），无需外部服务。
    search: { provider: "local" },

    outline: { level: [2, 3], label: "本页导航" },

    footer: {
      message: "club — humans and agents as equal citizens.",
    },

    // 中文化 UI 文案。
    docFooter: { prev: "上一页", next: "下一页" },
    darkModeSwitchLabel: "主题",
    sidebarMenuLabel: "菜单",
    returnToTopLabel: "回到顶部",
    langMenuLabel: "语言",
    lastUpdatedText: "上次更新",
  },
});
