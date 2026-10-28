#!/usr/bin/env node
// RSS / Atom フィードの新着を取り、ダイジェスト用の材料を出す。チェックした記事の本文を Markdown で保存する。
//
// 使い方:
//   node feed.mjs list      --root <保存先>
//     feeds.json に登録されたフィードを一覧する
//   node feed.mjs fetch     --root <保存先> [--feed <id>] [--file <ローカルのXML>]
//     新着を取り、<保存先>/<id>/.feed-cache/new.json に積む(未ダイジェスト分は持ち越す)
//     --file はテスト用。--feed と一緒に使う
//   node feed.mjs save      --root <保存先> [--feed <id>]
//     digest/*.md で「- [x] 本文を保存(id: …)」になった記事を articles/ に Markdown で保存する
//   node feed.mjs clear-new --root <保存先> --feed <id>
//     ダイジェストを書き終えたら new.json を空にする
//
// 保存先の構成:
//   <保存先>/feeds.json                     購読するフィードの一覧(ユーザーが書く)
//   <保存先>/<id>/digest/YYYY-MM-DD.md      ダイジェスト(スキルが書く)
//   <保存先>/<id>/articles/YYYY-MM-DD-<記事id>.md  チェックした記事の本文
//   <保存先>/<id>/.feed-cache/              取得済みID・原文キャッシュ・新着リスト
//
// 依存ゼロ(Node 18 以上の標準のみ)。要約はここでは書かない(スキル側の Claude が書く)。

import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";

const UA = "Mozilla/5.0 (feed-digest; +https://github.com/rinhanion/claude-plugins)";
// これより短い本文は「フィードには抜粋しか無い」とみなす
const EXCERPT_CHARS = 600;
// new.json に載せる本文テキストの上限(要約の材料として十分な量)
const MAX_TEXT_CHARS = 12000;

// ---------- 引数 ----------
function parseArgs(argv) {
  const [cmd, ...rest] = argv;
  const opts = {};
  for (let i = 0; i < rest.length; i++) {
    if (rest[i].startsWith("--")) {
      opts[rest[i].slice(2)] = rest[i + 1];
      i++;
    }
  }
  return { cmd, opts };
}

function die(msg) {
  console.error(msg);
  process.exit(1);
}

function expandHome(p) {
  return p.startsWith("~") ? path.join(process.env.HOME || "", p.slice(1)) : p;
}

// ---------- 日付(実行環境のローカル時刻) ----------
const pad = (n) => String(n).padStart(2, "0");
function fmtDate(d) {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}
function fmtDateTime(d) {
  return `${fmtDate(d)} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

// ---------- 文字参照 ----------
const NAMED = {
  amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ", hellip: "…", mdash: "—", ndash: "–",
  rsquo: "’", lsquo: "‘", rdquo: "”", ldquo: "“", copy: "©", reg: "®", trade: "™", middot: "·",
  bull: "•", laquo: "«", raquo: "»", times: "×", euro: "€", yen: "¥",
};
function decodeEntities(s) {
  return s.replace(/&(#x[0-9a-fA-F]+|#[0-9]+|[a-zA-Z]+);/g, (m, e) => {
    if (e[0] === "#") {
      const code = e[1] === "x" || e[1] === "X" ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      try {
        return String.fromCodePoint(code);
      } catch {
        return m;
      }
    }
    return NAMED[e] ?? m;
  });
}

// ---------- XML(フィード)の読み取り ----------
// 依存を足さないため、フィードに必要な範囲だけを正規表現で読む
function tagValue(block, names) {
  for (const name of names) {
    const esc = name.replace(":", "\\:");
    const re = new RegExp(`<${esc}(\\s[^>]*)?>([\\s\\S]*?)</${esc}>`, "i");
    const m = block.match(re);
    if (m) return xmlText(m[2]);
  }
  return "";
}
function xmlText(raw) {
  const trimmed = raw.trim();
  // CDATA は中身をそのまま、それ以外は XML の文字参照をほどく
  if (trimmed.includes("<![CDATA[")) {
    return trimmed.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1").trim();
  }
  return decodeEntities(trimmed);
}
function attr(tag, name) {
  const m = tag.match(new RegExp(`\\s${name}\\s*=\\s*("([^"]*)"|'([^']*)')`, "i"));
  return m ? decodeEntities(m[2] ?? m[3] ?? "") : "";
}
function atomLink(block) {
  const links = block.match(/<link\b[^>]*>/gi) || [];
  let fallback = "";
  for (const l of links) {
    const rel = attr(l, "rel");
    const href = attr(l, "href");
    if (!href) continue;
    if (!rel || rel === "alternate") return href;
    fallback ||= href;
  }
  return fallback;
}

function parseFeed(xml) {
  const items = [];
  const isAtom = /<feed\b[^>]*>/i.test(xml) && !/<rss\b/i.test(xml);
  const re = isAtom ? /<entry\b[^>]*>([\s\S]*?)<\/entry>/gi : /<item\b[^>]*>([\s\S]*?)<\/item>/gi;
  for (const m of xml.matchAll(re)) {
    const b = m[1];
    const title = decodeEntities(tagValue(b, ["title"]).replace(/<[^>]+>/g, "")).trim();
    let link = isAtom ? atomLink(b) : tagValue(b, ["link"]);
    const guid = tagValue(b, isAtom ? ["id"] : ["guid"]) || link || title;
    if (!link && /^https?:/.test(guid)) link = guid;
    const full = tagValue(b, ["content:encoded", "content"]);
    const summary = tagValue(b, ["description", "summary"]);
    const html = full || summary;
    const author = isAtom
      ? tagValue(b, ["name"])
      : tagValue(b, ["dc:creator", "author"]).replace(/^\S+@\S+\s*\((.*)\)$/, "$1");
    const pub = tagValue(b, ["pubDate", "published", "dc:date", "updated"]);
    const d = new Date(pub);
    const valid = !isNaN(d.getTime());
    items.push({
      guid,
      title,
      link,
      author,
      published: valid ? fmtDateTime(d) : pub,
      date: valid ? fmtDate(d) : fmtDate(new Date()),
      html,
    });
  }
  return items;
}

// ---------- HTML → Markdown ----------
const BLOCK = new Set(["p", "div", "section", "article", "figure", "figcaption", "table", "tr", "header", "footer"]);
const SKIP_CONTENT = new Set(["script", "style", "noscript"]);
const VOID = new Set(["br", "img", "hr", "input", "meta", "link", "source", "wbr"]);

function parseAttrs(s) {
  const a = {};
  for (const m of s.matchAll(/([^\s=\/]+)(?:\s*=\s*("([^"]*)"|'([^']*)'|([^\s>]+)))?/g)) {
    a[m[1].toLowerCase()] = decodeEntities(m[3] ?? m[4] ?? m[5] ?? "");
  }
  return a;
}

export function htmlToMarkdown(html) {
  const out = [];
  const lists = []; // [{type, n}]
  let link = null; // {href, text: []}
  let inPre = false;
  let quote = 0;
  let skip = 0; // visually-hidden などの中
  let skipTag = null; // script / style

  const buf = () => (link ? link.text : out);
  const w = (s) => buf().push(s);
  const nl = (n = 2) => out.push("\n".repeat(n) + (quote ? "> " : ""));
  const close = (mark) => {
    // 強調の閉じ記号の直前の空白は記号の外に出す(「*foo *」は強調にならないため)
    const b = buf();
    let trail = "";
    while (b.length && / $/.test(b[b.length - 1]) && !/ {2}\n$/.test(b[b.length - 1])) {
      const s = b[b.length - 1].replace(/ +$/, "");
      trail = " ";
      if (s) {
        b[b.length - 1] = s;
        break;
      }
      b.pop();
    }
    b.push(mark + trail);
  };

  const tokenRe = /<!--[\s\S]*?-->|<!\[CDATA\[[\s\S]*?\]\]>|<(\/?)([a-zA-Z][a-zA-Z0-9:-]*)([^>]*?)(\/?)>|([^<]+)|</g;
  for (const m of html.matchAll(tokenRe)) {
    const [whole, slash, rawTag, attrStr, selfClose, text] = m;
    if (whole.startsWith("<!")) continue;
    if (text !== undefined || whole === "<") {
      if (skip || skipTag) continue;
      let t = decodeEntities(text ?? "<");
      if (!inPre) t = t.replace(/\s+/g, " ");
      w(t);
      continue;
    }
    const tag = rawTag.toLowerCase();
    const closing = slash === "/";

    if (skipTag) {
      if (closing && tag === skipTag) skipTag = null;
      continue;
    }
    if (skip) {
      if (tag === "div" || tag === "span") skip += closing ? -1 : selfClose ? 0 : 1;
      continue;
    }
    if (!closing && SKIP_CONTENT.has(tag)) {
      skipTag = tag;
      continue;
    }

    if (!closing) {
      const a = parseAttrs(attrStr);
      if ((a.class || "").includes("visually-hidden") || (a.class || "").includes("sr-only")) {
        if (!VOID.has(tag) && !selfClose) skip = 1;
        continue;
      }
      if (/^h[1-6]$/.test(tag)) {
        nl();
        w("#".repeat(Number(tag[1])) + " ");
      } else if (BLOCK.has(tag)) {
        if (!lists.length) nl();
      } else if (tag === "br") {
        w("  \n");
      } else if (tag === "strong" || tag === "b") {
        w("**");
      } else if (tag === "em" || tag === "i") {
        w("*");
      } else if (tag === "a") {
        link = { href: a.href || "", text: [] };
      } else if (tag === "img") {
        const src = a.src || a["data-src"] || "";
        if (src) w(`![${(a.alt || "").replace(/\s+/g, " ")}](${src})`);
      } else if (tag === "iframe" || tag === "video" || tag === "audio") {
        const src = a.src || "";
        if (src) {
          nl();
          w(`[埋め込み: ${a.title || src}](${src})`);
          nl();
        }
      } else if (tag === "ul" || tag === "ol") {
        lists.push({ type: tag, n: Number(a.start) || 1 });
        nl(1);
      } else if (tag === "li") {
        const depth = Math.max(lists.length - 1, 0);
        nl(1);
        const top = lists[lists.length - 1];
        if (top && top.type === "ol") {
          w("   ".repeat(depth) + `${top.n}. `);
          top.n++;
        } else {
          w("   ".repeat(depth) + "- ");
        }
      } else if (tag === "blockquote") {
        quote++;
        nl();
      } else if (tag === "pre") {
        inPre = true;
        nl();
        w("```\n");
      } else if (tag === "code" && !inPre) {
        w("`");
      } else if (tag === "hr") {
        nl();
        w("---");
        nl();
      } else if (tag === "td" || tag === "th") {
        w(" | ");
      }
      continue;
    }

    // 閉じタグ
    if (/^h[1-6]$/.test(tag) || (BLOCK.has(tag) && !lists.length)) {
      nl();
    } else if (tag === "strong" || tag === "b") {
      close("**");
    } else if (tag === "em" || tag === "i") {
      close("*");
    } else if (tag === "a" && link) {
      const t = link.text.join("").trim();
      const href = link.href;
      link = null;
      out.push(href && t ? `[${t}](${href})` : t);
    } else if (tag === "ul" || tag === "ol") {
      lists.pop();
      nl();
    } else if (tag === "blockquote") {
      quote = Math.max(quote - 1, 0);
      nl();
    } else if (tag === "pre") {
      w("\n```");
      inPre = false;
      nl();
    } else if (tag === "code" && !inPre) {
      w("`");
    }
  }

  let s = out.join("").replace(/ /g, " ");
  s = s
    .split("\n")
    .map((l) => (/ {2}$/.test(l) ? l : l.replace(/\s+$/, "")))
    .join("\n");
  s = s.replace(/\*\*\s*\*\*/g, ""); // 空の太字
  s = s.replace(/\n{3,}/g, "\n\n");
  s = s.replace(/^>\s*$\n?/gm, ""); // 中身の無い引用行
  s = s.replace(/(^> [^\n]*)\n+(?=> )/gm, "$1\n>\n"); // 引用内の段落
  s = s.replace(/\n{3,}/g, "\n\n");
  return s.trim() + "\n";
}

function htmlToText(html) {
  return decodeEntities(html.replace(/<(script|style)[\s\S]*?<\/\1>/gi, " ").replace(/<[^>]+>/g, " "))
    .replace(/\s+/g, " ")
    .trim();
}

// ---------- 設定と状態 ----------
function loadFeeds(root) {
  const f = path.join(root, "feeds.json");
  if (!fs.existsSync(f)) die(`feeds.json が見つかりません: ${f}`);
  let conf;
  try {
    conf = JSON.parse(fs.readFileSync(f, "utf8"));
  } catch (e) {
    die(`feeds.json を読めません: ${e.message}`);
  }
  const feeds = conf.feeds || [];
  for (const fd of feeds) {
    if (!fd.id || !fd.url) die(`feeds.json の各フィードには id と url が必要です: ${JSON.stringify(fd)}`);
    if (!/^[A-Za-z0-9_-]+$/.test(fd.id)) die(`id は英数字・-・_ だけにしてください: ${fd.id}`);
  }
  return feeds;
}

function pickFeeds(feeds, id) {
  if (!id) return feeds;
  const f = feeds.find((x) => x.id === id);
  if (!f) die(`feeds.json に id「${id}」がありません`);
  return [f];
}

function dirs(root, id) {
  const base = path.join(root, id);
  const meta = path.join(base, ".feed-cache");
  return {
    base,
    meta,
    cache: path.join(meta, "cache"),
    state: path.join(meta, "state.json"),
    newFile: path.join(meta, "new.json"),
    digest: path.join(base, "digest"),
    articles: path.join(base, "articles"),
  };
}

const readJson = (f, fallback) => (fs.existsSync(f) ? JSON.parse(fs.readFileSync(f, "utf8")) : fallback);
const writeJson = (f, v) => fs.writeFileSync(f, JSON.stringify(v, null, 1) + "\n");

// 記事ID: URL の最後の部分(ファイル名に使えない文字は - に)。空や重複のときはハッシュを足す
function makeId(item, taken) {
  let s = "";
  try {
    const u = new URL(item.link);
    s = decodeURIComponent(u.pathname.replace(/\/+$/, "").split("/").pop() || "");
  } catch {
    // link が URL でない
  }
  s = s.replace(/\.(html?|php|aspx?)$/i, "").replace(/[\\/:*?"<>|\s（）()\[\]#%]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 80);
  const hash = crypto.createHash("sha1").update(item.guid).digest("hex").slice(0, 6);
  if (!s) return hash;
  if (taken.has(s) && taken.get(s) !== item.guid) return `${s}-${hash}`;
  return s;
}

// ---------- コマンド ----------
function cmdList(root) {
  const feeds = loadFeeds(root);
  if (!feeds.length) return console.log("登録されたフィードはありません");
  for (const f of feeds) {
    const d = dirs(root, f.id);
    const st = readJson(d.state, {});
    const pending = readJson(d.newFile, []).length;
    console.log(`- ${f.id}: ${f.name || ""} <${f.url}> 最終取得 ${st.lastFetch || "なし"} / 未ダイジェスト ${pending} 件`);
  }
}

async function fetchXml(url) {
  const res = await fetch(url, { headers: { "User-Agent": UA, Accept: "application/rss+xml, application/atom+xml, application/xml, text/xml, */*" } });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return await res.text();
}

async function cmdFetch(root, feedId, file) {
  const feeds = pickFeeds(loadFeeds(root), feedId);
  if (file && feeds.length !== 1) die("--file を使うときは --feed も指定してください");
  let failed = 0;
  for (const feed of feeds) {
    const d = dirs(root, feed.id);
    fs.mkdirSync(d.cache, { recursive: true });
    let xml;
    try {
      xml = file ? fs.readFileSync(file, "utf8") : await fetchXml(feed.url);
    } catch (e) {
      console.log(`## ${feed.id}: 取得に失敗しました(${e.message})`);
      failed++;
      continue;
    }
    const items = parseFeed(xml);
    if (!items.length) {
      console.log(`## ${feed.id}: 記事が 1 件も読めませんでした(RSS/Atom でない可能性)`);
      failed++;
      continue;
    }
    const state = readJson(d.state, { seen: {} });
    const taken = new Map(Object.entries(state.seen).map(([guid, id]) => [id, guid]));
    const fresh = [];
    for (const it of items) {
      if (state.seen[it.guid]) continue;
      const id = makeId(it, taken);
      taken.set(id, it.guid);
      state.seen[it.guid] = id;
      writeJson(path.join(d.cache, `${id}.json`), { id, ...it });
      const text = htmlToText(it.html);
      fresh.push({
        id,
        title: it.title,
        author: it.author,
        published: it.published,
        link: it.link,
        excerptOnly: text.length < EXCERPT_CHARS,
        text: text.slice(0, MAX_TEXT_CHARS),
      });
    }
    const pending = readJson(d.newFile, []);
    const have = new Set(pending.map((x) => x.id));
    const merged = [...pending, ...fresh.filter((x) => !have.has(x.id))].sort((a, b) =>
      b.published.localeCompare(a.published),
    );
    writeJson(d.newFile, merged);
    state.lastFetch = fmtDateTime(new Date());
    writeJson(d.state, state);
    console.log(`## ${feed.id}: フィード内 ${items.length} 件 / 今回の新着 ${fresh.length} 件 / 未ダイジェスト ${merged.length} 件`);
    for (const x of merged) console.log(`- ${x.published}  ${x.title}  (${x.id})${x.excerptOnly ? " ※抜粋のみ" : ""}`);
    if (merged.length) console.log(`材料: ${d.newFile}`);
  }
  if (failed === feeds.length) process.exit(1);
}

const CHECK_RE = /^(\s*)- \[[xX]\] 本文を保存（id: ([^）\s]+)）\s*$/;

function cmdSave(root, feedId) {
  const feeds = pickFeeds(loadFeeds(root), feedId);
  for (const feed of feeds) {
    const d = dirs(root, feed.id);
    if (!fs.existsSync(d.digest)) continue;
    const saved = [];
    const missing = [];
    for (const name of fs.readdirSync(d.digest).filter((n) => n.endsWith(".md")).sort()) {
      const file = path.join(d.digest, name);
      const lines = fs.readFileSync(file, "utf8").split("\n");
      let changed = false;
      lines.forEach((ln, i) => {
        const m = ln.match(CHECK_RE);
        if (!m) return;
        const [, indent, id] = m;
        const cacheFile = path.join(d.cache, `${id}.json`);
        if (!fs.existsSync(cacheFile)) {
          missing.push(id);
          return;
        }
        const it = readJson(cacheFile);
        const base = `${it.date}-${id}`;
        const outFile = path.join(d.articles, `${base}.md`);
        if (!fs.existsSync(outFile)) {
          fs.mkdirSync(d.articles, { recursive: true });
          const q = (s) => JSON.stringify(s || "");
          const body = htmlToMarkdown(it.html);
          const excerpt = htmlToText(it.html).length < EXCERPT_CHARS;
          const md = [
            "---",
            `title: ${q(it.title)}`,
            `author: ${q(it.author)}`,
            `published: ${q(it.published)}`,
            `source: ${q(it.link)}`,
            `feed: ${feed.id}`,
            `saved: ${fmtDate(new Date())}`,
            "---",
            "",
            `# ${it.title}`,
            "",
            [it.author, it.published, `[元記事](${it.link})`].filter(Boolean).join(" ・ "),
            "",
            "## 自分メモ",
            "",
            "- ",
            "",
            "## 本文",
            "",
            excerpt ? "> フィードには抜粋しか無いため、全文は元記事で読む。\n" : "",
            body,
          ].join("\n");
          fs.writeFileSync(outFile, md);
        }
        lines[i] = `${indent}- [x] 保存済み → [[${base}]]`;
        changed = true;
        saved.push(base);
      });
      if (changed) fs.writeFileSync(file, lines.join("\n"));
    }
    console.log(`## ${feed.id}: 本文を保存 ${saved.length} 件`);
    for (const s of saved) console.log(`- ${path.join(d.articles, s + ".md")}`);
    if (missing.length) console.log(`キャッシュが無く保存できなかった id: ${missing.join(", ")}`);
  }
}

function cmdClearNew(root, feedId) {
  if (!feedId) die("--feed を指定してください");
  pickFeeds(loadFeeds(root), feedId);
  const d = dirs(root, feedId);
  fs.mkdirSync(d.meta, { recursive: true });
  writeJson(d.newFile, []);
  console.log(`## ${feedId}: new.json を空にしました`);
}

// ---------- 入口 ----------
const isMain = import.meta.url === `file://${process.argv[1]}` || process.argv[1]?.endsWith("feed.mjs");
if (isMain) {
  const { cmd, opts } = parseArgs(process.argv.slice(2));
  if (!opts.root) die("--root <保存先> を指定してください");
  const root = path.resolve(expandHome(opts.root));
  if (cmd === "list") cmdList(root);
  else if (cmd === "fetch") await cmdFetch(root, opts.feed, opts.file);
  else if (cmd === "save") cmdSave(root, opts.feed);
  else if (cmd === "clear-new") cmdClearNew(root, opts.feed);
  else die("コマンドは list / fetch / save / clear-new のどれかです");
}
