#!/usr/bin/env node
// Claude Code のトランスクリプト(~/.claude/projects/*/*.jsonl)から、1日分の作業を集める。
//
// 使い方:
//   node collect.mjs pending --out <日次ログのフォルダ> [--days 14]
//     セッションがあるのに日次ログがまだ無い日を、古い順に1行ずつ出す。今日は含めない
//   node collect.mjs digest --date YYYY-MM-DD
//     その日(ローカル時刻)のセッションを、要約の材料になる Markdown にして出す
//
// 依存ゼロ(Node 標準のみ)。日次ログ本文はここでは書かない(要約はスキル側の Claude が行う)。

import fs from "node:fs";
import path from "node:path";
import os from "node:os";

const PROJECTS_DIR =
  process.env.CLAUDE_PROJECTS_DIR || path.join(os.homedir(), ".claude", "projects");

// 自動実行(launchd → claude -p)のプロンプトに入れる目印。そのセッション自身は集計しない。
const AUTO_MARKER = "[daily-log:auto]";

// 1セッション・1日あたりに載せる量の上限(ダイジェストが大きくなりすぎないように)
const MAX_PROMPTS = 20;
const MAX_PROMPT_CHARS = 300;
const MAX_REPLY_CHARS = 500;

// ユーザーが書いた文章ではないタグ
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
  "browser_instruction",
];

// 使い捨ての作業ファイルは記録に残さない
const SCRATCH_RE = /(^|\/)(private\/)?tmp\/claude-\d+\//;

function main() {
  const [cmd, ...rest] = process.argv.slice(2);
  const args = parseArgs(rest);

  if (cmd === "pending") {
    if (!args.out) fail("--out <日次ログのフォルダ> が必要です");
    for (const d of pendingDates(args.out, Number(args.days) || 14)) console.log(d);
  } else if (cmd === "digest") {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(args.date || "")) fail("--date YYYY-MM-DD が必要です");
    process.stdout.write(renderDigest(args.date, collectDay(args.date)));
  } else {
    fail("使い方: collect.mjs pending --out <dir> [--days N] | digest --date YYYY-MM-DD");
  }
}

function fail(msg) {
  console.error(msg);
  process.exit(1);
}

function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i++) {
    const m = /^--(out|days|date)$/.exec(argv[i]);
    if (m) out[m[1]] = argv[++i];
  }
  return out;
}

// --- 日付 ---------------------------------------------------------------

// ISO 時刻をローカルの YYYY-MM-DD にする(夜遅くの作業をその日のものとして数えるため)
function localDate(ts) {
  const d = new Date(ts);
  if (Number.isNaN(d.getTime())) return "";
  const p = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

function localTime(ts) {
  const d = new Date(ts);
  const p = (n) => String(n).padStart(2, "0");
  return `${p(d.getHours())}:${p(d.getMinutes())}`;
}

// --- 読み込み -----------------------------------------------------------

function transcriptFiles() {
  if (!fs.existsSync(PROJECTS_DIR)) return [];
  const files = [];
  for (const dir of fs.readdirSync(PROJECTS_DIR)) {
    const p = path.join(PROJECTS_DIR, dir);
    let entries;
    try {
      entries = fs.readdirSync(p);
    } catch {
      continue;
    }
    // サブエージェントの記録は <session>/ 配下にあるので、直下の .jsonl だけ見る
    for (const f of entries) if (f.endsWith(".jsonl")) files.push(path.join(p, f));
  }
  return files;
}

function readJsonl(file) {
  try {
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
  } catch {
    return [];
  }
}

// --- 秘匿情報の伏字化 ---------------------------------------------------

function redact(text) {
  if (!text) return "";
  return text
    .replace(/\b(gh[pousr]_|sk-(ant-)?|xox[baprs]-)[A-Za-z0-9_\-]{10,}/g, "$1***")
    .replace(
      /\b([A-Z0-9_]*(PASSWORD|PASSWD|SECRET|TOKEN|API_?KEY|CREDENTIAL)[A-Z0-9_]*)\s*[=:]\s*\S+/gi,
      "$1=***",
    )
    .replace(/(--?(?:password|passwd|token|secret|api[-_]?key)[= ]+)(\S+)/gi, "$1***")
    .replace(/("(?:password|passwd|token|secret|api[_-]?key)"\s*:\s*")[^"]*(")/gi, "$1***$2")
    .replace(/[\w.+-]+@[\w-]+\.[\w.-]+/g, "<メール>");
}

// --- 本文の掃除 ---------------------------------------------------------

function textOf(content) {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content
    .filter((b) => b && b.type === "text" && typeof b.text === "string")
    .map((b) => b.text)
    .join("\n");
}

function cleanPrompt(text) {
  let t = text;
  for (const tag of STRIP_BLOCKS) {
    t = t.replace(new RegExp(`<${tag}>[\\s\\S]*?</${tag}>`, "g"), "");
    t = t.replace(new RegExp(`<${tag}>[\\s\\S]*$`, "g"), "");
  }
  t = t.trim();
  if (/^\[Request interrupted/.test(t)) return "";
  return t;
}

// 本人が打ったプロンプトか。サブエージェントの報告や他セッションからの伝言は除く
function isHumanPrompt(e) {
  if (e.type !== "user" || e.isMeta || e.isSidechain || e.isCompactSummary) return false;
  if (e.origin && e.origin.kind !== "human") return false;
  return true;
}

function clip(s, n) {
  const one = s.replace(/\s+/g, " ").trim();
  return one.length > n ? one.slice(0, n - 1) + "…" : one;
}

// --- 集計 ---------------------------------------------------------------

// その日にプロンプトがあったセッションを集める。日をまたぐセッションは、その日の分だけ数える
function collectDay(date) {
  const sessions = [];
  for (const file of transcriptFiles()) {
    const entries = readJsonl(file);
    if (entries.length === 0) continue;

    const prompts = [];
    let auto = false;
    for (const e of entries) {
      if (!isHumanPrompt(e) || !e.timestamp) continue;
      const clean = cleanPrompt(textOf(e.message?.content));
      if (!clean) continue;
      if (clean.includes(AUTO_MARKER)) auto = true;
      if (localDate(e.timestamp) === date) prompts.push({ ts: e.timestamp, text: clean });
    }
    if (auto || prompts.length === 0) continue;

    const meta = entries.find((e) => e.cwd) || {};
    const workdir = meta.cwd || "";
    const title =
      [...entries].reverse().find((e) => e.type === "custom-title")?.customTitle ||
      [...entries].reverse().find((e) => e.type === "ai-title")?.aiTitle ||
      "";

    const files = new Set();
    const git = [];
    let lastReply = "";
    for (const e of entries) {
      if (e.type !== "assistant" || e.isSidechain || !e.timestamp) continue;
      if (localDate(e.timestamp) !== date) continue;
      const content = e.message?.content || [];
      const text = textOf(content);
      if (text.trim()) lastReply = text;
      for (const b of content) {
        if (!b || b.type !== "tool_use") continue;
        if (["Edit", "Write", "NotebookEdit"].includes(b.name)) {
          const fp = b.input?.file_path;
          if (fp && !SCRATCH_RE.test(fp)) files.add(rel(fp, workdir));
        }
        if (b.name === "Bash" && typeof b.input?.command === "string") {
          collectGit(b.input.command, git);
        }
      }
    }

    sessions.push({
      id: path.basename(file, ".jsonl").slice(0, 8),
      project: path.basename(workdir) || "unknown",
      title,
      start: prompts[0].ts,
      end: prompts[prompts.length - 1].ts,
      prompts,
      files: [...files],
      git: [...new Set(git)],
      lastReply,
    });
  }
  return sessions.sort((a, b) => a.start.localeCompare(b.start));
}

function rel(fp, workdir) {
  return workdir && fp.startsWith(workdir + "/") ? fp.slice(workdir.length + 1) : fp;
}

// コミット・PR・Issue の1行目を拾う。引数で直接渡した文字列を優先し、
// `-m "$(cat <<'EOF'` のようにヒアドキュメントで渡したときはその1行目を使う
function collectGit(cmd, out) {
  const pick = (after, flag) => {
    const from = cmd.slice(cmd.search(after));
    const m = new RegExp(`${flag}\\s+(["'])([\\s\\S]*?)\\1`).exec(from);
    if (!m) return "";
    const heredoc = /^\$\(\s*cat\s+<<-?\s*['"]?\w+['"]?\s*\n\s*(.+)/.exec(m[2]);
    return (heredoc ? heredoc[1] : m[2].split("\n")[0]).trim();
  };
  if (/\bgit commit\b/.test(cmd)) {
    const t = pick(/\bgit commit\b/, "-m");
    if (t) out.push(`commit: ${t}`);
  }
  if (/\bgh pr create\b/.test(cmd)) {
    out.push(`PR: ${pick(/\bgh pr create\b/, "--title") || "(作成)"}`);
  }
  if (/\bgh pr merge\b/.test(cmd)) out.push("PR をマージ");
  if (/\bgh issue create\b/.test(cmd)) {
    out.push(`Issue: ${pick(/\bgh issue create\b/, "--title") || "(作成)"}`);
  }
}

// --- 未作成の日 ---------------------------------------------------------

function pendingDates(outDir, days) {
  const today = localDate(new Date().toISOString());
  const oldest = new Date();
  oldest.setDate(oldest.getDate() - days);
  const from = localDate(oldest.toISOString());

  const dates = new Set();
  for (const file of transcriptFiles()) {
    let auto = false;
    const seen = new Set();
    for (const e of readJsonl(file)) {
      if (!isHumanPrompt(e) || !e.timestamp) continue;
      const clean = cleanPrompt(textOf(e.message?.content));
      if (!clean) continue;
      if (clean.includes(AUTO_MARKER)) auto = true;
      seen.add(localDate(e.timestamp));
    }
    if (auto) continue;
    for (const d of seen) if (d >= from && d < today) dates.add(d);
  }
  return [...dates]
    .filter((d) => !fs.existsSync(path.join(outDir, `${d}.md`)))
    .sort();
}

// --- 出力 ---------------------------------------------------------------

function renderDigest(date, sessions) {
  const L = [];
  L.push(`# ${date} のセッション(${sessions.length} 件)`);
  L.push("");
  if (sessions.length === 0) {
    L.push("この日のセッションはありません。");
    return L.join("\n") + "\n";
  }
  sessions.forEach((s, i) => {
    L.push(`## ${i + 1}. ${s.project}${s.title ? ` — ${redact(s.title)}` : ""}`);
    L.push(`${localTime(s.start)}〜${localTime(s.end)} / session ${s.id}`);
    L.push("");
    L.push("プロンプト:");
    const shown =
      s.prompts.length > MAX_PROMPTS
        ? [...s.prompts.slice(0, MAX_PROMPTS - 5), null, ...s.prompts.slice(-5)]
        : s.prompts;
    for (const p of shown) {
      if (!p) {
        L.push(`- …(${s.prompts.length - MAX_PROMPTS} 件省略)`);
        continue;
      }
      L.push(`- [${localTime(p.ts)}] ${redact(clip(p.text, MAX_PROMPT_CHARS))}`);
    }
    if (s.files.length > 0) {
      L.push("");
      L.push(`変更したファイル: ${s.files.slice(0, 15).map(redact).join(", ")}`);
    }
    if (s.git.length > 0) {
      L.push("");
      for (const g of s.git) L.push(`- ${redact(g)}`);
    }
    if (s.lastReply) {
      L.push("");
      L.push(`最後の応答: ${redact(clip(s.lastReply, MAX_REPLY_CHARS))}`);
    }
    L.push("");
  });
  return L.join("\n");
}

main();
