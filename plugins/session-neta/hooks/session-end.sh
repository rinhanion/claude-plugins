#!/usr/bin/env bash
# SessionEnd フックの入口。node を見つけて harvest.mjs に stdin をそのまま渡す。
#
# セッションの終了を絶対に妨げないこと。node が無い・スクリプトが落ちる・
# トランスクリプトが読めない、どの場合でも黙って exit 0 する。

set -u

find_node() {
  if command -v node >/dev/null 2>&1; then
    command -v node
    return
  fi
  # フックは非対話シェルで走るので nvm の PATH が通っていないことがある。
  # インストール済みの中でいちばん新しいものを使う。
  local candidate
  candidate=$(ls -d "$HOME"/.nvm/versions/node/*/bin/node 2>/dev/null | sort -V | tail -1)
  if [ -n "$candidate" ] && [ -x "$candidate" ]; then
    echo "$candidate"
    return
  fi
  for candidate in /usr/local/bin/node /opt/homebrew/bin/node; do
    if [ -x "$candidate" ]; then
      echo "$candidate"
      return
    fi
  done
}

NODE_BIN=$(find_node)
[ -z "$NODE_BIN" ] && exit 0

SCRIPT_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
"$NODE_BIN" "$SCRIPT_DIR/../scripts/harvest.mjs" || true

exit 0
