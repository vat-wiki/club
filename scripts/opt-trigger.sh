#!/bin/bash
# Trigger guard: only fire if no optimization is currently in progress.
# The agent-side mark/unmark logic handles this, but this script provides
# a quick filesystem check so the cron job can short-circuit early.
if [ -f "/home/dev/.openclaw/workspace/.opt-in-progress" ]; then
  echo '{"fire":false,"reason":"optimization already running"}'
else
  echo '{"fire":true}'
fi
