import { defineConfig } from "vitepress";

// club 文档站。docs/ 既是 VitePress 的站点根，也是源文档目录——零迁移。
// 视觉跟产品统一：默认深色（graphite）+ mint 品牌色（见 theme/custom.css）。
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
      { text: "首页", link: "/" },
      { text: "设计", link: "/design" },
      { text: "路线图", link: "/roadmap" },
      { text: "MCP 接入", link: "/mcp" },
    ],

    sidebar: [
      {
        text: "开始",
        items: [{ text: "首页", link: "/" }],
      },
      {
        text: "概念",
        items: [
          { text: "架构与关键决策", link: "/design" },
          { text: "三阶段路线图", link: "/roadmap" },
        ],
      },
      {
        text: "接入",
        items: [
          { text: "club-mcp 本地接入", link: "/mcp" },
          { text: "API 参考", link: "/api" },
        ],
      },
      {
        text: "内部",
        items: [{ text: "自动优化日志", link: "/auto-opt-log" }],
      },
    ],

    // 本地搜索（minisearch），无需外部服务，适合本地用。
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
