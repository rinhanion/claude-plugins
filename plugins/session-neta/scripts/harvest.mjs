#!/usr/bin/env node
// Claude Code のトランスクリプト(JSONL)を読んで、ブログのネタ帳 Markdown を1枚書き出す。
//
// 使い方は2通り:
//   1. SessionEnd フックから。フック JSON を stdin で受け取る(通常はこちら)
//   2. 手動 / スキルから。 node harvest.mjs --transcript <path> [--session <id>] [--cwd <path>]
//      進行中のセッションをその場でネタ帳にしたいときに使う
//
// 依存ゼロ(Node 標準のみ)。何があってもセッション終了を妨げないよう、
// 失敗しても exit 0 で静かに終わる。

import fs from "node:fs";
import path from "node:path";
import os from "node:os";

const NETA_DIR = process.env.BLOG_NETA_DIR || path.join(os.homedir(), "blog-neta");
const OUT_DIR = path.join(NETA_DIR, "sessions");

// 「中身のあるセッション」の閾値。どちらかを満たせばネタ帳にする。
const MIN_EDITS = 1;
const MIN_PROMPTS = 3;

// 使い捨ての作業ファイル。記事の材料にならないので触ったファイル一覧から除く。
const SCRATCH_RE = /(^|\/)(private\/)?tmp\/claude-\d+\//;

// 会話本文から丸ごと取り除くタグ(ユーザーが書いた文章ではないもの)
const STRIP_BLOCKS = [
  "system-reminder",
  "local-command-caveat",
  "local-command-stdout",
  "local-command-stderr",
  "command-name",
  "command-message",
  "command-args",
  "ide_selection",
  "task-notification",
  "user-memory-input",
];

function main() {
  const args = parseArgs(process.argv.slice(2));
  const hook = args.transcript ? {} : readStdinJson();

  const transcriptPath = args.transcript || hook.transcript_path;
  if (!transcriptPath || !fs.existsSync(transcriptPath)) return;

  const sessionId = args.session || hook.session_id || path.basename(transcriptPath, ".jsonl");
  const entries = readJsonl(transcriptPath);
  if (entries.length === 0) return;

  const s = summarize(entries, { sessionId, cwd: args.cwd || hook.cwd });

  // 中身の薄いセッション(調べものだけ・一発質問だけ)は残さない
  if (s.editCount < MIN_EDITS && s.prompts.length < MIN_PROMPTS) return;

  fs.mkdirSync(OUT_DIR, { recursive: true });
  const file = path.join(OUT_DIR, `${s.date}-${s.project}-${sessionId.slice(0, 8)}.md`);
  fs.writeFileSync(file, render(s), "utf8");

  // 手動実行のときだけ、どこに書いたか教える(フック実行時は静かにしておく)
  if (args.transcript) console.log(file);
}

// --- 入力 ---------------------------------------------------------------

function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i++) {
    const m = /^--(transcript|session|cwd)$/.exec(argv[i]);
    if (m) out[m[1]] = argv[++i];
  }
  return out;
}

function readStdinJson() {
  try {
    return JSON.parse(fs.readFileSync(0, "utf8"));
  } catch {
    return {};
  }
}

function readJsonl(file) {
  return fs
    .readFileSync(file, "utf8")
    .split("\n")
    .map((line) => {
      try {
        return JSON.parse(line);
      } catch {
        return null;
      }
    })
    .filter(Boolean);
}

// --- 秘匿情報の伏字化 ---------------------------------------------------
// トランスクリプトにはログイン情報が普通に混ざる(同期ツールの .env など)。
// ネタ帳はあとで note に貼る前提なので、書き出す前に必ず通す。

function redact(text) {
  if (!text) return "";
  return (
    text
      // gh / OpenAI / Anthropic 風のトークン
      .replace(/\b(gh[pousr]_|sk-(ant-)?|xox[baprs]-)[A-Za-z0-9_\-]{10,}/g, "$1***")
      // KEY=VALUE 形式の秘密(.env の中身、export、CLI 引数)
      .replace(
        /\b([A-Z0-9_]*(PASSWORD|PASSWD|SECRET|TOKEN|API_?KEY|CREDENTIAL)[A-Z0-9_]*)\s*[=:]\s*\S+/gi,
        "$1=***",
      )
      // --password xxx / "password": "xxx" のような書き方
      .replace(
        /(--?(?:password|passwd|token|secret|api[-_]?key)[= ]+)(\S+)/gi,
        "$1***",
      )
      .replace(
        /("(?:password|passwd|token|secret|api[_-]?key)"\s*:\s*")[^"]*(")/gi,
        "$1***$2",
      )
  );
}

// --- 本文の掃除 ---------------------------------------------------------

function cleanPrompt(text) {
  let t = text;
  for (const tag of STRIP_BLOCKS) {
    t = t.replace(new RegExp(`<${tag}>[\\s\\S]*?</${tag}>`, "g"), "");
    t = t.replace(new RegExp(`<${tag}>[\\s\\S]*$`, "g"), "");
  }
  return t.trim();
}

function textOf(content) {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content
    .filter((b) => b && b.type === "text" && typeof b.text === "string")
    .map((b) => b.text)
    .join("\n");
}

// --- 集計 ---------------------------------------------------------------

function summarize(entries, { sessionId, cwd }) {
  const meta = entries.find((e) => e.cwd) || {};
  const workdir = cwd || meta.cwd || "";
  const project = path.basename(workdir) || "unknown";

  const title =
    [...entries].reverse().find((e) => e.type === "ai-title")?.aiTitle || "";

  // 時刻は会話の行だけから取る。queue-operation などの管理行は順序が前後するので混ぜない。
  const msgTimes = entries
    .filter((e) => (e.type === "user" || e.type === "assistant") && e.timestamp)
    .map((e) => e.timestamp)
    .sort();
  const firstTs = msgTimes[0] || "";
  const lastTs = msgTimes[msgTimes.length - 1] || "";
  const date = (firstTs || new Date().toISOString()).slice(0, 10);

  // 本人が書いたプロンプトだけを拾う
  const prompts = [];
  for (const e of entries) {
    if (e.type !== "user" || e.isMeta || e.isSidechain || e.isCompactSummary) continue;
    const raw = textOf(e.message?.content);
    if (!raw.trim()) continue;
    const clean = cleanPrompt(raw);
    if (!clean) continue;
    prompts.push({ ts: e.timestamp || "", text: redact(clean) });
  }

  // ツール使用: 触ったファイル / 実行コマンド / エラー
  const toolNames = new Map(); // tool_use_id -> ツール名(エラーのラベル用)
  const tools = {};
  const files = new Set();
  const commands = [];
  const gitActions = [];
  let editCount = 0;

  for (const e of entries) {
    if (e.type !== "assistant" || e.isSidechain) continue;
    for (const b of e.message?.content || []) {
      if (!b || b.type !== "tool_use") continue;
      tools[b.name] = (tools[b.name] || 0) + 1;
      toolNames.set(b.id, b.name);

      if (["Edit", "Write", "NotebookEdit"].includes(b.name)) {
        editCount++;
        const fp = b.input?.file_path;
        if (fp && !SCRATCH_RE.test(fp)) files.add(fp);
      }

      if (b.name === "Bash" && typeof b.input?.command === "string") {
        const cmd = redact(b.input.command.trim());
        commands.push(cmd.split("\n")[0]);
        collectGit(cmd, gitActions);
      }
    }
  }

  // 失敗したツール呼び出し = つまずいたところ
  const errors = [];
  for (const e of entries) {
    if (e.type !== "user" || e.isSidechain) continue;
    const content = e.message?.content;
    if (!Array.isArray(content)) continue;
    for (const b of content) {
      if (!b || b.type !== "tool_result" || !b.is_error) continue;
      const body = typeof b.content === "string" ? b.content : textOf(b.content);
      if (!body.trim()) continue;
      const text = redact(body.trim().split("\n").slice(0, 3).join(" "))
        .replace(/\/(private\/)?tmp\/claude-\d+\/\S*/g, "<scratch>")
        .slice(0, 240);
      errors.push({ tool: toolNames.get(b.tool_use_id) || "tool", text });
    }
  }

  return {
    sessionId,
    title,
    date,
    project,
    workdir,
    branch: meta.gitBranch || "",
    startedAt: firstTs || "",
    endedAt: lastTs || "",
    prompts,
    files: [...files],
    commands,
    gitActions,
    errors,
    tools,
    editCount,
  };
}

function collectGit(cmd, out) {
  if (/\bgit commit\b/.test(cmd)) {
    const msg = extractMessage(cmd, /\bgit commit\b/);
    if (msg) out.push({ kind: "commit", text: msg });
  }
  if (/\bgh pr create\b/.test(cmd)) {
    out.push({ kind: "pr", text: extractMessage(cmd, /\bgh pr create\b/) || "(PR 作成)" });
  }
  if (/\bgh pr merge\b/.test(cmd)) out.push({ kind: "merge", text: "PR をマージ" });
  if (/\bgh issue create\b/.test(cmd)) {
    out.push({ kind: "issue", text: extractMessage(cmd, /\bgh issue create\b/) || "(Issue 作成)" });
  }
}

// `-m "..."` / `--title "..."` の中身を取る。
// このリポジトリでは長文を `-m "$(cat <<'EOF' ... EOF)"` で渡すので、
// ヒアドキュメントのときは開始マーカーの次の行(=1行目のサマリ)を採用する。
function extractMessage(cmd, after) {
  const from = cmd.slice(cmd.search(after));
  const flag = /(?:-m|--title)\s+([\s\S]*)/.exec(from);
  if (!flag) return "";
  const rest = flag[1];

  // `-m "$(cat <<'EOF'` … EOF` の形。マーカーの次の非空行がコミットの1行目。
  const heredoc = /^['"]?\$\(\s*cat\s+<<-?\s*(['"]?)\w+\1\s*\n([\s\S]*)/.exec(rest);
  if (heredoc) return heredoc[2].split("\n").find((l) => l.trim())?.trim() || "";

  // 素直に引用符で囲まれている形。--body など後続のフラグまで飲み込まないよう閉じ引用符で切る。
  const quote = rest[0];
  if (quote === '"' || quote === "'") {
    const end = rest.indexOf(quote, 1);
    const body = end === -1 ? rest.slice(1) : rest.slice(1, end);
    return body.split("\n")[0].trim();
  }
  return rest.split(/\s/)[0];
}

// --- 出力 ---------------------------------------------------------------

function rel(fp, workdir) {
  return workdir && fp.startsWith(workdir + "/") ? fp.slice(workdir.length + 1) : fp;
}

function hhmm(ts) {
  return ts ? ts.slice(11, 16) : "--:--";
}

function yamlString(s) {
  return `"${String(s).replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
}

function render(s) {
  const L = [];

  L.push("---");
  L.push(`title: ${yamlString(s.title || `${s.project} の作業`)}`);
  L.push(`date: ${s.date}`);
  L.push(`project: ${s.project}`);
  L.push(`branch: ${s.branch}`);
  L.push(`session: ${s.sessionId.slice(0, 8)}`);
  L.push(`prompts: ${s.prompts.length}`);
  L.push(`files_changed: ${s.files.length}`);
  L.push("status: ネタ");
  L.push('note_url: ""');
  L.push("---");
  L.push("");
  L.push(`# ${s.title || `${s.project} の作業`}`);
  L.push("");
  // 日をまたいだセッション(翌日に再開した等)は終了側にも日付を出す
  const endedSameDay = s.endedAt.slice(0, 10) === s.date;
  const span = endedSameDay
    ? `${s.date} ${hhmm(s.startedAt)}〜${hhmm(s.endedAt)}`
    : `${s.date} ${hhmm(s.startedAt)}〜${s.endedAt.slice(0, 10)} ${hhmm(s.endedAt)}`;
  L.push(`${span} / \`${s.project}\`` + (s.branch ? ` (\`${s.branch}\`)` : ""));
  L.push("");

  if (s.prompts.length > 0) {
    L.push("## やろうとしたこと");
    L.push("");
    L.push(s.prompts[0].text);
    L.push("");

    L.push("## 会話の流れ");
    L.push("");
    s.prompts.forEach((p, i) => {
      const body = p.text.split("\n").filter((x) => x.trim());
      L.push(`${i + 1}. **[${hhmm(p.ts)}]** ${body[0]}`);
      for (const extra of body.slice(1)) L.push(`   ${extra}`);
    });
    L.push("");
  }

  if (s.files.length > 0) {
    L.push("## 触ったファイル");
    L.push("");
    for (const f of s.files) L.push(`- \`${rel(f, s.workdir)}\``);
    L.push("");
  }

  if (s.errors.length > 0) {
    L.push("## つまずき・エラー");
    L.push("");
    // 同じエラーの繰り返しは1回にまとめる
    const seen = new Set();
    for (const e of s.errors) {
      const key = `${e.tool}:${e.text.slice(0, 80)}`;
      if (seen.has(key)) continue;
      seen.add(key);
      L.push(`- **${e.tool}**: ${e.text}`);
    }
    L.push("");
  }

  if (s.gitActions.length > 0) {
    L.push("## git");
    L.push("");
    const label = { commit: "commit", pr: "PR", merge: "merge", issue: "Issue" };
    const seenGit = new Set();
    for (const g of s.gitActions) {
      const key = `${g.kind}:${g.text}`;
      if (seenGit.has(key)) continue;
      seenGit.add(key);
      L.push(`- ${label[g.kind]}: ${g.text}`);
    }
    L.push("");
  }

  const notableCommands = pickNotableCommands(s.commands);
  if (notableCommands.length > 0) {
    L.push("## 実行したコマンド（抜粋）");
    L.push("");
    L.push("```sh");
    for (const c of notableCommands) L.push(c);
    L.push("```");
    L.push("");
  }

  const toolLine = Object.entries(s.tools)
    .sort((a, b) => b[1] - a[1])
    .map(([k, v]) => `${k}×${v}`)
    .join(" / ");
  if (toolLine) {
    L.push("## ツール使用");
    L.push("");
    L.push(toolLine);
    L.push("");
  }

  L.push("---");
  L.push("");
  L.push(
    "> このネタ帳は session-neta が自動生成したもの。「何をしたか」しか入っていないので、",
  );
  L.push("> 記事にするときは「なぜやったか」「そのときどう思ったか」を足すこと。");
  L.push("");

  return L.join("\n");
}

// ノイズ(ls, cat, echo などの確認コマンド)を落として、意味のある行だけ残す
function pickNotableCommands(commands) {
  const noise = /^(ls|cat|pwd|echo|head|tail|wc|which|find|grep|sed -n|cd|printf|file|pgrep|ps|lsof|sleep|curl -s -o)\b/;
  // commit / PR / Issue は「git」の節で扱うので重複させない
  const coveredByGit = /^(git commit|gh pr create|gh issue create)\b/;
  const seen = new Set();
  const out = [];
  for (const raw of commands) {
    const c = tidyCommand(raw);
    if (!c || noise.test(c) || coveredByGit.test(c)) continue;
    if (seen.has(c)) continue;
    seen.add(c);
    out.push(c);
    if (out.length >= 20) break;
  }
  return out;
}

function tidyCommand(cmd) {
  const c = cmd
    // 使い捨ての作業ファイルの長いパスは記事の役に立たない
    .replace(/["']?\/(private\/)?tmp\/claude-\d+\/[^\s"']*["']?/g, "<scratch>")
    // ヒアドキュメントで長文を渡している箇所は、開き口だけ残っても読めない
    .replace(/["']?\$\(\s*cat\s+<<-?\s*['"]?\w+['"]?\s*$/, "<本文>")
    .trim();
  return c.length > 140 ? c.slice(0, 137) + "..." : c;
}

try {
  main();
} catch {
  // ネタ帳が作れなかったくらいでセッション終了を邪魔しない
}
