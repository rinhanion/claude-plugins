# claude-plugins

自作 Claude Code プラグインをまとめた個人用マーケットプレイスリポジトリ。
マーケットプレイス名は `hiroki-plugins`、リポジトリ名は `claude-plugins`
(`claude-*` は予約されているため別名にしてある)。

## 技術スタック

ビルドもパッケージマネージャも無い。中身は次の 4 種類だけ。

- **Markdown** — `SKILL.md` / `agents/*.md` / `README.md`。プラグインの本体はほぼこれ
- **JSON** — `marketplace.json` / `plugin.json` / `hooks.json`
- **Node.js スクリプト**(`.mjs`, ESM) — フックから呼ぶ処理。**Node 標準ライブラリのみ・依存ゼロ**。
  `package.json` も `node_modules` も置かない
- **bash** — フックの入口スクリプト(`hooks/*.sh`)

## 構成

```
.claude-plugin/marketplace.json   マーケットプレイス定義。plugins 配列が唯一の入口
plugins/<name>/
  .claude-plugin/plugin.json       プラグイン manifest(name / version / description / author / keywords)
  README.md                        そのプラグインの説明(ルート README の表からリンク)
  skills/<skill>/SKILL.md           スキル本体。frontmatter は name と description のみ
  agents/<agent>.md                サブエージェント定義(あれば)
  hooks/hooks.json                 フック定義(あれば)
  scripts/ | hooks/*.sh            フックから呼ぶスクリプト
```

## 収録プラグイン

| プラグイン | 役割 |
|---|---|
| `idea-coach` | アイデアを壁打ちで 1 枚の Markdown ストックに蓄積 + 深掘り用コーチエージェント |
| `marketplace-ping` | 配信・インストール・スキル発動の疎通確認だけの最小プラグイン(`pong 🏓`) |
| `note-draft` | note アカウント(hiroking22)の文体プロファイルで下書きを生成し note-api で下書き投稿 |
| `session-neta` | SessionEnd フックで作業内容をネタ帳 Markdown に自動書き出し、note-draft に橋渡し |

`note-draft` と `session-neta` は連携する: `session-neta` が `~/blog-neta/sessions/` の
ネタ帳を選んで文脈を補い、本文執筆は文体プロファイル(`STYLE.md`)を持つ `note-draft` に渡す。
文体の定義を session-neta 側に複製しないこと。

## プラグインを追加するとき

1. `plugins/<name>/` を作り、最低限 `.claude-plugin/plugin.json` と `README.md` を置く
2. `.claude-plugin/marketplace.json` の `plugins` 配列にエントリを足す
   (`name` / `source: "./plugins/<name>"` / `description`)
3. ルート `README.md` の「収録プラグイン」表に 1 行足す
4. `plugin.json` と `marketplace.json` の `description` は日本語で、粒度をそろえる

- push したコミットが自動で追跡される。`plugin.json` 側の `version` は目安で更新判定には使われない
- スキルの `SKILL.md` frontmatter は基本 `name` と `description` の 2 つ。`description` は
  「どういうときに使う / 使わない」を発動トリガーの言い回しごと具体的に書く(既存スキル参照)。
  `model` / `allowed-tools` など、Claude Codeが公式にサポートするfrontmatterフィールドは、
  明確な理由がある場合は追加してよい

## 動作確認

対話 UI ではなく `claude plugin` CLI を使う(このリポジトリ自身のルールとして)。

```
claude plugin marketplace add rinhanion/claude-plugins   # 最初の1回
claude plugin install <名前>@hiroki-plugins
claude plugin update <名前>@hiroki-plugins                # push 後に最新化
```

`marketplace-ping` をインストールして `ping` スキルが `pong 🏓` を返せば配信は通っている。

## 開発フロー

- **Issue → ブランチ → PR**。`main` に直接コミットしない
- ブランチ名: `feat/<短い説明>` / `fix/<...>` / `chore/<...>`
- コミット・PR タイトルは Conventional Commits(`feat:` `fix:` `chore:` `docs:`)
- コード中のコメントは日本語(既存ファイルが英語で統一されていればそれに合わせる)
- リモート: `github.com/rinhanion/claude-plugins`(private)

## 禁止事項

- `main` に直接コミット / push しない(必ず Issue → ブランチ → PR)
- Node スクリプトに npm 依存を足さない。`package.json` / `node_modules` を作らない
- フックスクリプトを失敗時に非ゼロ終了させない。node が無い・落ちる・読めない、
  どの場合でも黙って `exit 0`(セッション終了を妨げないため。`session-neta/hooks/session-end.sh` 参照)
- `marketplace.json` のプラグインエントリに `version` を書かない(コミット追跡に任せる)
- 手順やドキュメントで対話 UI(`/plugin`)を前提にしない。`claude plugin` CLI に統一する
- `note-draft` の文体プロファイル(`STYLE.md`)を `session-neta` 側に複製しない
- ドキュメントに飾りの固有名(人名・ハンドル)を書かない。動作に効く識別子だけ残す
