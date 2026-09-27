#!/data/data/com.termux/files/usr/bin/sh

set -u

log_file="${FLAY_DEV_LOG:-/data/data/com.termux/files/usr/tmp/flay-dev.log}"

while :; do
  npm run dev >> "$log_file" 2>&1
  exit_code=$?
  timestamp=$(date -u '+%Y-%m-%dT%H:%M:%SZ')
  printf '%s Flay development server exited with code %s; restarting in 2 seconds.\n' "$timestamp" "$exit_code" >> "$log_file"
  sleep 2
done
