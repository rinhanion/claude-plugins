# learning-loop

セッションの作業をふりかえり、そこで得た学びをプロジェクトの `LEARNINGS.md` に追記していくプラグイン。[claude-plugins](../../README.md) マーケットプレイスの1つ。

## 何ができるか

- `/update-learnings`(または「今日の学びを記録して」「セッション振り返って」)で、このセッションの作業から新しい学び(効いた型・失敗・業務知識・覚えておく価値のある解法)を洗い出し、`LEARNINGS.md` の該当セクションに簡潔な項目として追記する
- すでに同じ内容の項目があれば新しく足さず、既存の項目を補強する
- `LEARNINGS.md` が無いプロジェクトでは、5 セクションの雛形を作ってから追記する
- 追記後に総項目数を数え、80 件以上なら統合(Consolidated Principles への集約)を回す時期だと案内する

## 構成

| コンポーネント | 種類 | 役割 |
|---|---|---|
| `update-learnings` | Skill | セッションをふりかえり、学びを `LEARNINGS.md` の該当セクションに追記する |

## LEARNINGS.md のセクション

| セクション | 書くもの |
|---|---|
| Patterns That Work | 効いたやり方・型 |
| Mistakes to Avoid | 失敗とその再発防止 |
| Domain Knowledge | そのプロジェクト固有の業務知識・仕様・解法 |
| Open Questions | まだ答えの出ていない問い |
| Consolidated Principles | 項目が溜まったときに統合してできた原則(このスキルは直接書かない) |

## 使い方の例

- `/update-learnings`
- 「今日の学びを記録して」
- 「セッション振り返って LEARNINGS に残して」
