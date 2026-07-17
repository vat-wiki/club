#!/usr/bin/env node
/**
 * club-improver - 每30分钟对 club 项目从一个角度进行改进
 * 通过 opencode cron gateway 调用，或者直接作为 daemon 运行
 */
import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_DIR = path.resolve(__dirname, "..");

const ANGLES = [
  {
    name: "代码质量/重构",
    files: "packages/**/*.ts",
    focus: "寻找代码重复、可合并的函数、不优雅的写法",
  },
  {
    name: "性能优化",
    files: "packages/server/**/*,packages/sdk/**/*",
    focus: "数据库查询、SSE 推送、不必要的遍历或序列化",
  },
  {
    name: "安全性审查",
    files: "packages/server/**/*,packages/shared/**/*",
    focus: "输入校验、鉴权、密钥处理、XSS、SQL 注入防护",
  },
  {
    name: "用户体验改进",
    files: "packages/web/**/*",
    focus: "交互反馈、加载状态、错误提示、空状态设计",
  },
  {
    name: "测试覆盖",
    files: "packages/**/*.test.*",
    focus: "缺少测试的核心逻辑，补全断言和边界 case",
  },
  {
    name: "文档完善",
    files: "docs/**/*,README.md",
    focus: "API 文档、配置说明、操作指南是否完整准确",
  },
  {
    name: "架构改进",
    files: "packages/**/*.ts",
    focus: "模块耦合度、接口设计、可测试性、可扩展性",
  },
  {
    name: "错误处理",
    files: "packages/**/*.ts",
    focus: "未捕获的异常、try-catch 覆盖、错误信息友好度",
  },
  {
    name: "国际化/可访问性",
    files: "packages/web/**/*",
    focus: "a11y、键盘导航、ARIA、文字内容",
  },
  {
    name: "类型安全",
    files: "packages/**/*.ts",
    focus: "any 类型使用、类型推导、泛型约束",
  },
];

let angleIndex = 0;

function getRandomAngle() {
  const angle = ANGLES[angleIndex % ANGLES.length];
  angleIndex++;
  return angle;
}

function main() {
  const angle = getRandomAngle();

  console.log(`[${new Date().toISOString()}] 改进角度: ${angle.name}`);
  console.log(`  文件范围: ${angle.files}`);
  console.log(`  关注点: ${angle.focus}`);

  // 调用 opencode cron 执行改进任务
  // 这里通过 CLI 方式触发改进
  const prompt = `## 本次改进任务

### 角度：${angle.name}
### 文件范围：${angle.files}
### 关注点：${angle.focus}

**要求：**
1. 使用 explore subagent 调研当前角度，查找可改进的代码
2. 根据调研结果进行实际改进（如果不确定，先咨询相关 subagent）
3. 运行 \`npm run typecheck\` 验证
4. 如需查看测试环境视觉效果：https://club-test.vat.wiki/
5. 如需记录截图，使用 club-cli 发送图片
6. 将本次改进记录到 .claude/improvement-log.md
7. 如果该角度暂不需要改进，记录说明并跳过
`;

  // 输出 prompt 供调度器使用
  process.stdout.write(JSON.stringify({ prompt, angle: angle.name }));
  process.exit(0);
}

main();
