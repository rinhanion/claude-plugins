# learning-loop

セッションの作業をふりかえり、そこで得た学びをプロジェクトの `LEARNINGS.md` に追記し、定期的に統合して原則にまとめるプラグイン。あわせて、スキルの使われ方を観察して修正案をステージする。[claude-plugins](../../README.md) マーケットプレイスの1つ。

## 何ができるか

- `/update-learnings`(または「今日の学びを記録して」「セッション振り返って」)で、このセッションの作業から新しい学び(効いた型・失敗・業務知識・覚えておく価値のある解法)を洗い出し、`LEARNINGS.md` の該当セクションに簡潔な項目として追記する
- すでに同じ内容の項目があれば新しく足さず、既存の項目を補強する
- `LEARNINGS.md` が無いプロジェクトでは、5 セクションの雛形を作ってから追記する
- 追記後に総項目数と前回の統合日を確認し、80 件以上、または前回の統合から 7 日以上たっていれば `/consolidate-learnings` を回すよう案内する
- `/consolidate-learnings`(または「LEARNINGS を統合して」)で、全項目を見直して古い項目の削除・重複のマージ・原則の抽出を行う。削除・マージした項目は変更前後がわかる形で報告し、黙って消さない
- `task-observer` で、スキルの使われ方から「抜けていたルール」「既存スキルがカバーしていない繰り返し」「特に効いたテクニック」を `skill-observations/log.md` に記録し、修正案を `skill-updates/<日付>/<スキル名>/` にステージする。スキル本体は書き換えない

## 構成

| コンポーネント | 種類 | 役割 |
|---|---|---|
| `update-learnings` | Skill | セッションをふりかえり、学びを `LEARNINGS.md` の該当セクションに追記する |
| `consolidate-learnings` | Skill | `LEARNINGS.md` の全項目を見直し、削除・マージ・原則の抽出を行う |
| `task-observer` | Skill | スキルの使われ方を観察してログに残し、修正案をステージする |

## 統合の回し方

- 週 1 回、または項目数が 80 件に達したときに手動で `/consolidate-learnings` を実行する(`/update-learnings` がリマインドする)
- 前回の統合日は `Consolidated Principles` 直下の `最終統合: YYYY-MM-DD` に残る
- スキルはコミットしない。統合の結果は Issue → ブランチ → PR の流れに乗せ、削除・マージの前後を差分として残す

## スキル観察の回し方

使うプロジェクトの `CLAUDE.md` に次の 1 行を足すと、定期的に呼ばれるようになる。

```markdown
作業を 3 件完了するたびに task-observer を呼び、観察した内容を skill-observations/log.md に追記すること(1 件 = ユーザーの依頼 1 回)。
```

| 操作 | 扱い |
|---|---|
| `skill-observations/log.md` への追記・`skill-updates/` への修正案の配置 | 確認なしで自動で行う |
| 構造変更にあたる修正案(書き換え・削除・再編・frontmatter 変更・分割統合) | 配置したうえで報告する |
| スキル本体への反映 | しない。別の作業として Issue → PR で行う |

`skill-observations/` と `skill-updates/` はループの材料になるのでコミットする。役割は `LEARNINGS.md` = プロジェクトの学び、`log.md` = スキルに対する観察、で分ける。

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
- `/task-observer`
- 「スキルの改善案をステージして」
