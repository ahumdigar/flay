#!/data/data/com.termux/files/usr/bin/sh
set -eu

export PATH="/data/data/com.termux/files/usr/bin:$PATH"
app_dir="/data/data/com.termux/files/home/flay/apps/web"
session_name="flay"

termux-wake-lock >/dev/null 2>&1 || true

if tmux has-session -t "$session_name" 2>/dev/null; then
  exit 0
fi

tmux new-session -d -s "$session_name" -c "$app_dir" "npm run dev"
