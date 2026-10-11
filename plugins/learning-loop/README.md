# learning-loop

セッションの作業をふりかえり、そこで得た学びをプロジェクトの `LEARNINGS.md` に追記し、定期的に統合して原則にまとめるプラグイン。[claude-plugins](../../README.md) マーケットプレイスの1つ。

## 何ができるか

- `/update-learnings`(または「今日の学びを記録して」「セッション振り返って」)で、このセッションの作業から新しい学び(効いた型・失敗・業務知識・覚えておく価値のある解法)を洗い出し、`LEARNINGS.md` の該当セクションに簡潔な項目として追記する
- すでに同じ内容の項目があれば新しく足さず、既存の項目を補強する
- `LEARNINGS.md` が無いプロジェクトでは、5 セクションの雛形を作ってから追記する
- 追記後に総項目数と前回の統合日を確認し、80 件以上、または前回の統合から 7 日以上たっていれば `/consolidate-learnings` を回すよう案内する
- `/consolidate-learnings`(または「LEARNINGS を統合して」)で、全項目を見直して古い項目の削除・重複のマージ・原則の抽出を行う。削除・マージした項目は変更前後がわかる形で報告し、黙って消さない

## 構成

| コンポーネント | 種類 | 役割 |
|---|---|---|
| `update-learnings` | Skill | セッションをふりかえり、学びを `LEARNINGS.md` の該当セクションに追記する |
| `consolidate-learnings` | Skill | `LEARNINGS.md` の全項目を見直し、削除・マージ・原則の抽出を行う |

## 統合の回し方

- 週 1 回、または項目数が 80 件に達したときに手動で `/consolidate-learnings` を実行する(`/update-learnings` がリマインドする)
- 前回の統合日は `Consolidated Principles` 直下の `最終統合: YYYY-MM-DD` に残る
- スキルはコミットしない。統合の結果は Issue → ブランチ → PR の流れに乗せ、削除・マージの前後を差分として残す

## LEARNINGS.md のセクション

| セクション | 書くもの |
|---|---|
| Patterns That Work | 効いたやり方・型 |
| Mistakes to Avoid | 失敗とその再発防止 |
| Domain Knowledge | そのプロジェクト固有の業務知識・仕様・解法 |
| Open Questions | まだ答えの出ていない問い |
| Consolidated Principles | 統合してできた原則(`consolidate-learnings` だけが書く) |

## 使い方の例

- `/update-learnings`
- 「今日の学びを記録して」
- 「セッション振り返って LEARNINGS に残して」
- `/consolidate-learnings`
- 「LEARNINGS を統合して」
