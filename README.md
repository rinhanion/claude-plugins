# claude-plugins

自分用のClaudeプラグインをまとめておくマーケットプレイスリポジトリ。マーケットプレイス名は `hiroki-plugins`(リポジトリ名は `claude-plugins`)。新しいプラグインを作るたびに `plugins/` 以下にフォルダを追加し、`.claude-plugin/marketplace.json` の `plugins` 配列にエントリを足していく。

## 使い方

このリポジトリをClaude Codeにマーケットプレイスとして追加する(最初の1回だけ):

```
/plugin marketplace add rinhanion/claude-plugins
```

対話UIが使えない環境ではCLIでも同じことができる:

```
claude plugin marketplace add rinhanion/claude-plugins
```

プラグインをインストールする:

```
/plugin install <プラグイン名>@hiroki-plugins
```

このリポジトリを更新(git push)した後、インストール済みのプラグインを最新化する:

```
/plugin update <プラグイン名>@hiroki-plugins
```

marketplace.jsonの各プラグインエントリに `version` を書いていないので、pushしたコミットが自動で追跡される(バージョン番号を上げる必要はない)。

## 収録プラグイン

| プラグイン | 内容 |
|---|---|
| [idea-coach](plugins/idea-coach/README.md) | アプリ・Webサービスのアイデアをストックする壁打ち相手 + 本気で詰めるコーチエージェント |
| [note-draft](plugins/note-draft/README.md) | 過去のnote記事から抽出した本人の文体で、noteの下書き記事を生成するプラグイン |
| [session-neta](plugins/session-neta/README.md) | Claude Codeでの作業内容をセッション終了時にブログのネタ帳として自動で書き出し、note-draftに渡して記事化するプラグイン |
| [rinteq-slides](plugins/rinteq-slides/README.md) | 学会・カンファレンス発表用の個人スライドテンプレートを適用してpptxスライドを生成するプラグイン |
