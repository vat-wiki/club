#!/bin/bash
# 每18分钟用opencode从不同角度完善 ~/repos/club 项目
# 使用锁文件防止重叠运行

PROJECT_DIR="$HOME/repos/club"
LOG_DIR="$PROJECT_DIR/scripts/logs"
LOCK_FILE="$PROJECT_DIR/scripts/.opencode-pid"
LOCK_TIMEOUT=3600  # 锁文件超时(秒)，防止死锁

mkdir -p "$LOG_DIR"

# 检查是否已有 opencode 在运行
if [ -f "$LOCK_FILE" ]; then
    OLD_PID=$(cat "$LOCK_FILE")
    START_TIME=$(stat -c %Y "$LOCK_FILE" 2>/dev/null)
    NOW=$(date +%s)
    ELAPSED=$(( NOW - START_TIME ))
    
    # 检查 PID 是否存活
    if kill -0 "$OLD_PID" 2>/dev/null; then
        echo "WARN: opencode (pid=$OLD_PID, 运行${ELAPSED}s) 仍在执行中，跳过本次运行"
        exit 1
    else
        # PID 已死，锁超时了
        if [ "$ELAPSED" -gt "$LOCK_TIMEOUT" ]; then
            echo "WARN: 旧锁已超时(${ELAPSED}s > ${LOCK_TIMEOUT}s)，清理后继续"
            rm -f "$LOCK_FILE"
        else
            echo "WARN: PID($OLD_PID) 已死但锁未超时(${ELAPSED}s)，清理后继续"
            rm -f "$LOCK_FILE"
        fi
    fi
fi

# 角度列表（轮换使用）
ANGLES=(
  "Review recent code changes in the project. Identify 2-3 areas where code quality can be improved (naming, structure, duplication). Apply the improvements."
  "Check test coverage across all packages. Identify untested critical paths and add meaningful tests. Run the test suite to verify."
  "Review and improve documentation (README, JSDoc, inline comments). Add missing type definitions or clarify existing ones."
  "Profile for performance bottlenecks in the server package. Suggest and apply optimizations for database queries, event handling, or memory usage."
  "Security audit: review authentication, input validation, and error handling. Apply any missing security measures."
  "Review TypeScript type definitions across packages. Tighten loose types (any, unknown), improve generic usage, and ensure type safety."
  "Refactor for better modularity and separation of concerns. Extract utilities, improve error handling patterns, reduce coupling between packages."
  "Review adherence to Node.js and TypeScript best practices. Apply ESLint-compatible patterns, proper async/await usage, and graceful error handling."
)

# 计算当前轮次角度
ROUND=$(( ($(date +%H) * 3 + $(($(date +%M) / 18)) ) % ${#ANGLES[@]} ))
PROMPT="${ANGLES[$ROUND]}"

LOG_FILE="$LOG_DIR/opencode-$(date +%Y%m%d-%H%M).log"

# 写锁文件（PID = $$）
echo "$$" > "$LOCK_FILE"

echo "=== $(date '+%Y-%m-%d %H:%M:%S') ===" >> "$LOG_FILE"
echo "角度 [$ROUND]: $PROMPT" >> "$LOG_FILE"
echo "PID: $$" >> "$LOG_FILE"
echo "---" >> "$LOG_FILE"

cd "$PROJECT_DIR" || exit 1

# 用opencode run，非交互模式，自动批准
# 子进程在后台运行，以便监控
opencode run --auto --dir "$PROJECT_DIR" "$PROMPT" >> "$LOG_FILE" 2>&1
OPENCODE_EXIT=$?

echo "opencode 退出码: $OPENCODE_EXIT" >> "$LOG_FILE"
echo "完成时间: $(date '+%Y-%m-%d %H:%M:%S')" >> "$LOG_FILE"
echo "" >> "$LOG_FILE"

# 清理锁文件
rm -f "$LOCK_FILE"

exit $OPENCODE_EXIT
