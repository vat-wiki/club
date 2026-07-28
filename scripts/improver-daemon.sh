#!/usr/bin/env bash
# club-improver-daemon - 每30分钟运行一次项目改进
# 在容器中用 nohup 后台运行

set -e
PROJECT_DIR="/home/dev/repos/club"
LOG_DIR="$PROJECT_DIR/.claude"
PID_FILE="$LOG_DIR/improver.pid"
LOG_FILE="$LOG_DIR/improver.log"

mkdir -p "$LOG_DIR"

# 防止重复启动
if [ -f "$PID_FILE" ]; then
  OLD_PID=$(cat "$PID_FILE")
  if kill -0 "$OLD_PID" 2>/dev/null; then
    echo "Improver already running (pid $OLD_PID)"
    exit 1
  fi
  rm -f "$PID_FILE"
fi

echo $$ > "$PID_FILE"

log() {
  echo "[$(date '+%Y-%m-%d %H:%M:%S')] $*" | tee -a "$LOG_FILE"
}

run_improvement() {
  log "=== 开始改进轮次 ==="

  # 获取本次改进角度
  ANGLES=(
    "代码质量/重构:packages/**/*.ts:查找代码重复、可合并的函数、不优雅的写法"
    "性能优化:packages/server/**/*.ts:数据库查询、SSE 推送、不必要的遍历或序列化"
    "安全性审查:packages/server/**/*.ts,packages/shared/**/*.ts:输入校验、鉴权、密钥处理、XSS、SQL注入防护"
    "用户体验改进:packages/web/**/*:交互反馈、加载状态、错误提示、空状态设计"
    "测试覆盖:packages/**/*.test.*:缺少测试的核心逻辑，补全断言和边界 case"
    "文档完善:docs/**/*:API 文档、配置说明、操作指南是否完整准确"
    "架构改进:packages/**/*.ts:模块耦合度、接口设计、可测试性、可扩展性"
    "错误处理:packages/**/*.ts:未捕获的异常、try-catch 覆盖、错误信息友好度"
    "国际化/可访问性:packages/web/**/*:a11y、键盘导航、ARIA、文字内容"
    "类型安全:packages/**/*.ts:any 类型使用、类型推导、泛型约束"
  )

  # 轮换角度
  GLOBAL_IDX=$(cat "$LOG_DIR/.angle_idx" 2>/dev/null || echo 0)
  ANGLE="${ANGLES[$GLOBAL_IDX % ${#ANGLES[@]}]}"
  GLOBAL_IDX=$(( (GLOBAL_IDX + 1) % ${#ANGLES[@]} ))
  echo "$GLOBAL_IDX" > "$LOG_DIR/.angle_idx"

  ANGLE_NAME="${ANGLE%%:*}"
  ANGLE_FILE="${ANGLE#*:}"
  ANGLE_FILE="${ANGLE_FILE%%:*}"
  ANGLE_FOCUS="${ANGLE##*:}"

  log "角度: $ANGLE_NAME"
  log "文件: $ANGLE_FILE"
  log "关注: $ANGLE_FOCUS"

  # 使用 opencode 执行改进任务
  cd "$PROJECT_DIR"
  npm run typecheck >> "$LOG_FILE" 2>&1 || log "typecheck 有警告"

  log "=== 改进轮次结束 ==="
}

# 主循环
while true; do
  run_improvement
  sleep 1800  # 30分钟
done
