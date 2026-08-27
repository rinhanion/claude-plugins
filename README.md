# claude-plugins

自分用のClaudeプラグインをまとめておくマーケットプレイスリポジトリ。新しいプラグインを作るたびに `plugins/` 以下にフォルダを追加し、`.claude-plugin/marketplace.json` の `plugins` 配列にエントリを足していく。

## 使い方

このリポジトリをClaude Codeにマーケットプレイスとして追加する(最初の1回だけ):

```
/plugin marketplace add <あなたのGitHubアカウント>/claude-plugins
```

プラグインをインストールする:

```
/plugin install <プラグイン名>@claude-plugins
```

このリポジトリを更新(git push)した後、インストール済みのプラグインを最新化する:

```
/plugin update <プラグイン名>@claude-plugins
```

marketplace.jsonの各プラグインエントリに `version` を書いていないので、pushしたコミットが自動で追跡される(バージョン番号を上げる必要はない)。

## 収録プラグイン

| プラグイン | 内容 |
|---|---|
| [idea-coach](plugins/idea-coach/README.md) | アプリ・Webサービスのアイデアをストックする壁打ち相手 + 本気で詰めるコーチエージェント |
