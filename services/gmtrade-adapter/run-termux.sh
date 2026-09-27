#!/data/data/com.termux/files/usr/bin/sh
set -eu
script_dir=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
binary="$script_dir/target/release/flay-gmtrade-adapter"
if [ ! -x "$binary" ]; then
  echo "GMTrade release binary is missing. Build services/gmtrade-adapter first." >&2
  exit 127
fi
exec proot-distro login ubuntu -- env \
  SOLANA_RPC_URL="${SOLANA_RPC_URL:-https://api.mainnet-beta.solana.com}" \
  RUST_LOG="${RUST_LOG:-error}" \
  "$binary"
