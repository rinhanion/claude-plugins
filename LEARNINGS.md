# LEARNINGS.md

このリポジトリでの作業を繰り返す中で得た学びを蓄積する記録。
セッション開始時に読み、セッション終了時に(`/update-learnings` などで)追記する。

`~/.claude/memory/` の自動メモリや `~/.claude/CLAUDE.md` との違い:

- **`LEARNINGS.md`** — このリポジトリでの反復から得た、このリポジトリ固有の学び
  (効いた型・失敗の再発防止・ドメイン知識・統合した原則)。git 管理され、誰が見ても文脈がわかる
- **自動メモリ**(`~/.claude/memory/`) — ユーザー個人の作業文脈・好み。プロジェクトを横断する
- **`CLAUDE.md`** — 変わらない事実やルール(構成・禁止事項・開発フロー)

同じ内容を両方に書かない。プロジェクト固有かつ「反復して初めてわかったこと」は `LEARNINGS.md` に、
それ以外はどちらか適切な方に置く。

## Patterns That Work

- Issue に「やること」と「完了条件」を具体的に書いておくと、着手から PR・マージまで
  確認を挟まずに進められる(#13 で採用)

## Mistakes to Avoid

- 日本語で依頼されたのに、構築報告を英語のまま返してしまった。応答言語は毎回日本語で統一する
- 1 ステップごとに「進めてよいですか？」と確認を取り、「お願いします」を何度も言わせてしまった。
  Issue の設計が固まっていれば、確認を挟まずマージまで進めてよい
- `/plugin` や `/mcp reconnect` のようなスラッシュコマンドを、どこで・誰が打つのか明示しないまま
  案内し、ターミナルに打たせてしまった。案内するときは実行場所を必ず明示する

## Domain Knowledge

- `SKILL.md` の frontmatter は基本 `name` と `description` のみだが、`model` など
  Claude Code が公式サポートするフィールドは明確な理由があれば追加してよい
  (例: `rinteq-slides` の `model: claude-opus-5`)

## Open Questions

(まだなし)

## Consolidated Principles

(まだなし。`consolidate-learnings` スキルの導入後、週次または項目数80〜100件到達時にここへ集約する)
