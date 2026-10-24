#!/usr/bin/env bash
# 毎朝、未作成の日次ログをまとめて作る launchd ジョブを登録・解除する(macOS 用)。
#
#   bash schedule.sh install <日次ログの保存先> [HH:MM]   既定は 07:00
#   bash schedule.sh uninstall
#   bash schedule.sh run                                 登録済みのジョブを今すぐ1回動かす
#
# Mac がスリープしていた場合は、起きたときに1回走る。電源が切れていて走らなかった日も、
# 次に走ったときに pending で拾われるので、あとから作られる。

set -eu

LABEL="local.claude.daily-log"
PLIST="$HOME/Library/LaunchAgents/$LABEL.plist"
LOG="$HOME/Library/Logs/daily-log.log"

case "${1:-}" in
  install)
    OUT="${2:?日次ログの保存先を指定してください}"
    TIME="${3:-07:00}"
    HOUR=$((10#${TIME%%:*}))
    MINUTE=$((10#${TIME##*:}))
    CLAUDE_BIN=$(command -v claude || true)
    [ -z "$CLAUDE_BIN" ] && { echo "claude コマンドが見つかりません" >&2; exit 1; }
    [ -d "$OUT" ] || { echo "フォルダがありません: $OUT" >&2; exit 1; }

    # [daily-log:auto] は「自動実行のセッションだ」という目印。翌日のログに自分自身を混ぜないために使う
    PROMPT="[daily-log:auto] daily-log スキルで、保存先 $OUT に未作成の日次ログをすべて作ってください。質問はせず、終わったら作った日付だけを出力してください。"

    mkdir -p "$(dirname "$PLIST")" "$(dirname "$LOG")"
    cat >"$PLIST" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>$LABEL</string>
  <key>ProgramArguments</key>
  <array>
    <string>/bin/zsh</string>
    <string>-lc</string>
    <string>echo "=== \$(date)"; "$CLAUDE_BIN" -p "\$DAILY_LOG_PROMPT" --allowedTools "Bash(node:*)" Read Write Glob Grep</string>
  </array>
  <key>EnvironmentVariables</key>
  <dict>
    <key>DAILY_LOG_PROMPT</key><string>$PROMPT</string>
  </dict>
  <key>WorkingDirectory</key><string>$OUT</string>
  <key>StartCalendarInterval</key>
  <dict>
    <key>Hour</key><integer>$HOUR</integer>
    <key>Minute</key><integer>$MINUTE</integer>
  </dict>
  <key>StandardOutPath</key><string>$LOG</string>
  <key>StandardErrorPath</key><string>$LOG</string>
</dict>
</plist>
EOF
    launchctl bootout "gui/$(id -u)/$LABEL" 2>/dev/null || true
    launchctl bootstrap "gui/$(id -u)" "$PLIST"
    echo "登録しました: 毎日 $TIME / ログ: $LOG"
    ;;
  uninstall)
    launchctl bootout "gui/$(id -u)/$LABEL" 2>/dev/null || true
    rm -f "$PLIST"
    echo "解除しました"
    ;;
  run)
    launchctl kickstart "gui/$(id -u)/$LABEL"
    echo "起動しました。ログ: $LOG"
    ;;
  *)
    echo "使い方: schedule.sh install <保存先> [HH:MM] | uninstall | run" >&2
    exit 1
    ;;
esac
