#!/usr/bin/env node
// RSS 2.0 / Atom フィードの新着を集め、チェックされた記事の本文を Markdown で保存する。
//
// 使い方(<dir> は保存先フォルダ。feeds.json を置く):
//   node feed.mjs fetch --dir <dir> [--feed <id>]
//     各フィードを取得し、まだ見ていない記事だけを JSON で出す(キャッシュに new として記録)
//   node feed.mjs list --dir <dir> [--feed <id>] [--new]
//     キャッシュ済みの記事を JSON で出す。--new でダイジェスト未作成のものだけ
//   node feed.mjs clear-new --dir <dir>
//     ダイジェストを書き終えた記事の new 印を外す
//   node feed.mjs save --dir <dir> --digest <ダイジェストの.md>
//     [x] の付いた行の記事を <dir>/articles/<feedId>/ に保存し、その行を「保存済み → [[…]]」に置き換える
//
// 依存ゼロ(Node 標準のみ)。要約はここでは書かない(スキル側の Claude が行う)。

import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";

// fetch の出力に載せる本文の長さ(要約の材料として十分な分だけ)
const EXCERPT_CHARS = 1500;
const FETCH_TIMEOUT_MS = 30_000;

// ダイジェストのチェック行につける目印。<!-- feed-digest:<feedId>/<key> -->
const MARK_RE = /<!--\s*feed-digest:([A-Za-z0-9_-]+)\/([0-9a-f]+)\s*-->/;

async function main() {
  const [cmd, ...rest] = process.argv.slice(2);
  const args = parseArgs(rest);
  if (!args.dir) fail("--dir <保存先フォルダ> が必要です");
  const dir = path.resolve(args.dir);

  if (cmd === "fetch") {
    printJson(await fetchAll(dir, args.feed));
  } else if (cmd === "list") {
    printJson(listCached(dir, args.feed, args.new));
  } else if (cmd === "clear-new") {
    console.log(`new 印を外した記事: ${clearNew(dir)} 件`);
  } else if (cmd === "save") {
    if (!args.digest) fail("--digest <ダイジェストのファイル> が必要です");
    printJson(saveChecked(dir, path.resolve(args.digest)));
  } else {
    fail("使い方: feed.mjs fetch|list|clear-new|save --dir <dir> [--feed id] [--new] [--digest file]");
  }
}

function fail(msg) {
  console.error(msg);
  process.exit(1);
}

function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i++) {
    const m = /^--(dir|feed|digest|new)$/.exec(argv[i]);
    if (!m) continue;
    if (m[1] === "new") out.new = true;
    else out[m[1]] = argv[++i];
  }
  return out;
}

function printJson(v) {
  process.stdout.write(JSON.stringify(v, null, 2) + "\n");
}

// --- 設定とキャッシュ -----------------------------------------------------

function loadFeeds(dir, only) {
  const file = path.join(dir, "feeds.json");
  if (!fs.existsSync(file)) fail(`${file} がありません`);
  let feeds;
  try {
    feeds = JSON.parse(fs.readFileSync(file, "utf8"));
  } catch (e) {
    fail(`feeds.json が読めません: ${e.message}`);
  }
  if (!Array.isArray(feeds)) fail("feeds.json は配列で書いてください");
  for (const f of feeds) {
    if (!/^[A-Za-z0-9_-]+$/.test(f.id || "")) fail(`id は英数字・_・- で書いてください: ${JSON.stringify(f)}`);
    if (!f.url) fail(`url がありません: ${f.id}`);
  }
  if (only) {
    feeds = feeds.filter((f) => f.id === only);
    if (!feeds.length) fail(`feeds.json に id "${only}" がありません`);
  }
  return feeds;
}

function cachePath(dir, feedId) {
  return path.join(dir, ".cache", `${feedId}.json`);
}

function loadCache(dir, feedId) {
  try {
    return JSON.parse(fs.readFileSync(cachePath(dir, feedId), "utf8"));
  } catch {
    return { items: {} };
  }
}

function saveCache(dir, feedId, cache) {
  const file = cachePath(dir, feedId);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(cache, null, 2) + "\n");
}

function cachedFeedIds(dir) {
  try {
    return fs
      .readdirSync(path.join(dir, ".cache"))
      .filter((f) => f.endsWith(".json"))
      .map((f) => f.slice(0, -5));
  } catch {
    return [];
  }
}

// --- fetch / list / clear-new ----------------------------------------------

async function fetchAll(dir, only) {
  const result = { total: 0, feeds: [] };
  for (const feed of loadFeeds(dir, only)) {
    const entry = { id: feed.id, name: feed.name || feed.id, lens: feed.lens || "", items: [] };
    try {
      const items = parseFeed(await readSource(feed.url, dir));
      const cache = loadCache(dir, feed.id);
      const now = new Date().toISOString();
      for (const it of items) {
        if (cache.items[it.key]) continue;
        cache.items[it.key] = { ...it, new: true, fetchedAt: now };
        entry.items.push(summarize(it));
      }
      saveCache(dir, feed.id, cache);
    } catch (e) {
      // 1つのフィードが落ちても他は続ける
      entry.error = e.message;
    }
    result.total += entry.items.length;
    result.feeds.push(entry);
  }
  return result;
}

function listCached(dir, only, onlyNew) {
  const names = new Map();
  try {
    for (const f of loadFeeds(dir)) names.set(f.id, f);
  } catch {
    // feeds.json が無くてもキャッシュは見られるようにする
  }
  const ids = only ? [only] : cachedFeedIds(dir);
  const result = { total: 0, feeds: [] };
  for (const id of ids) {
    const f = names.get(id) || {};
    const items = Object.values(loadCache(dir, id).items)
      .filter((it) => !onlyNew || it.new)
      .map((it) => ({ ...summarize(it), new: !!it.new, saved: it.saved || null }));
    result.total += items.length;
    result.feeds.push({ id, name: f.name || id, lens: f.lens || "", items });
  }
  return result;
}

function clearNew(dir) {
  let n = 0;
  for (const id of cachedFeedIds(dir)) {
    const cache = loadCache(dir, id);
    for (const it of Object.values(cache.items)) {
      if (it.new) {
        it.new = false;
        n++;
      }
    }
    saveCache(dir, id, cache);
  }
  return n;
}

function summarize(it) {
  const md = htmlToMarkdown(it.html, it.link);
  return {
    key: it.key,
    title: it.title,
    link: it.link,
    published: localDate(it.published),
    excerpt: md.length > EXCERPT_CHARS ? md.slice(0, EXCERPT_CHARS) + "…" : md,
  };
}

async function readSource(url, dir) {
  if (/^https?:\/\//i.test(url)) {
    const res = await fetch(url, {
      headers: {
        "user-agent": "feed-digest (Claude Code plugin)",
        accept: "application/rss+xml, application/atom+xml, application/xml;q=0.9, text/xml;q=0.9, */*;q=0.8",
      },
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status} ${url}`);
    return await res.text();
  }
  // 動作確認用にローカルファイルも読めるようにする(相対パスは保存先から)
  const p = url.replace(/^file:\/\//i, "");
  return fs.readFileSync(path.resolve(dir, p), "utf8");
}

// --- save ---------------------------------------------------------------

function saveChecked(dir, digestFile) {
  const lines = fs.readFileSync(digestFile, "utf8").split("\n");
  const caches = new Map();
  const getCache = (id) => {
    if (!caches.has(id)) caches.set(id, loadCache(dir, id));
    return caches.get(id);
  };
  const feedNames = new Map();
  try {
    for (const f of loadFeeds(dir)) feedNames.set(f.id, f.name || f.id);
  } catch {
    // 名前が引けなくても保存はできる
  }

  const saved = [];
  const errors = [];
  for (let i = 0; i < lines.length; i++) {
    const check = /^(\s*)[-*] \[[xX]\] /.exec(lines[i]);
    const mark = MARK_RE.exec(lines[i]);
    if (!check || !mark) continue;
    const [, feedId, key] = mark;
    const it = getCache(feedId).items[key];
    if (!it) {
      errors.push({ line: i + 1, feed: feedId, key, error: "キャッシュに記事がありません" });
      continue;
    }
    const name = it.saved || writeArticle(dir, feedId, feedNames.get(feedId) || feedId, it);
    it.saved = name;
    lines[i] = `${check[1]}- 保存済み → [[${name}]]`;
    saved.push({ feed: feedId, title: it.title, file: path.join("articles", feedId, `${name}.md`) });
  }

  for (const [id, cache] of caches) saveCache(dir, id, cache);
  if (saved.length) fs.writeFileSync(digestFile, lines.join("\n"));
  return { saved, errors };
}

// 本文を書き、ウィキリンク用のファイル名(拡張子なし)を返す
function writeArticle(dir, feedId, feedName, it) {
  const date = localDate(it.published) || localDate(it.fetchedAt);
  const outDir = path.join(dir, "articles", feedId);
  fs.mkdirSync(outDir, { recursive: true });
  let name = `${date}-${slugify(it.title) || it.key}`;
  if (fs.existsSync(path.join(outDir, `${name}.md`))) name += `-${it.key.slice(0, 6)}`;

  const body = [
    "---",
    `title: ${JSON.stringify(it.title)}`,
    `url: ${JSON.stringify(it.link)}`,
    `published: ${date}`,
    `feed: ${JSON.stringify(feedName)}`,
    `saved: ${localDate(new Date().toISOString())}`,
    "---",
    "",
    `# ${it.title}`,
    "",
    `元記事: <${it.link}>`,
    "",
    htmlToMarkdown(it.html, it.link),
    "",
  ].join("\n");
  fs.writeFileSync(path.join(outDir, `${name}.md`), body);
  return name;
}

// ファイル名とウィキリンクで困る文字を除く。日本語はそのまま残す
function slugify(s) {
  return String(s || "")
    .replace(/[\\/:*?"<>|#^[\]{}%&$!@`'=+,;]/g, " ")
    .trim()
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .slice(0, 60)
    .replace(/-$/, "")
    .toLowerCase();
}

function localDate(ts) {
  const d = new Date(ts || "");
  if (Number.isNaN(d.getTime())) return "";
  const p = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

// --- フィードの解析(RSS 2.0 / Atom) ------------------------------------

function parseFeed(xml) {
  const blocks = [...xml.matchAll(/<item\b[\s\S]*?<\/item>/gi), ...xml.matchAll(/<entry\b[\s\S]*?<\/entry>/gi)];
  if (!blocks.length && !/<(rss|feed|rdf:RDF)\b/i.test(xml)) throw new Error("RSS/Atom として読めません");
  return blocks.map(([b]) => {
    const title = textOf(tag(b, "title")).replace(/\s+/g, " ").trim() || "(無題)";
    const link = atomLink(b) || xmlText(tag(b, "link")).trim();
    const id = xmlText(tag(b, "guid") ?? tag(b, "id")).trim();
    const published = xmlText(tag(b, "pubDate") ?? tag(b, "published") ?? tag(b, "updated") ?? tag(b, "dc:date")).trim();
    // 本文は content:encoded → content → description / summary の順で取る
    const html =
      xmlText(tag(b, "content:encoded")) ||
      contentOf(b) ||
      xmlText(tag(b, "description")) ||
      xmlText(tag(b, "summary"));
    const key = crypto.createHash("sha1").update(id || link || title).digest("hex").slice(0, 12);
    return { key, id, title, link, published, html };
  });
}

// <name ...>中身</name> の中身(無ければ undefined)。<content> が <content:encoded> に当たらないよう属性の前で区切る
function tag(block, name) {
  const re = new RegExp(`<${name.replace(":", "\\:")}(\\s[^>]*)?>([\\s\\S]*?)</${name.replace(":", "\\:")}>`, "i");
  const m = re.exec(block);
  return m ? m[2] : undefined;
}

function contentOf(block) {
  const m = /<content(\s[^>]*)?>([\s\S]*?)<\/content>/i.exec(block);
  if (!m) return "";
  // type="xhtml" は中身がそのまま HTML。それ以外はエスケープされた HTML(または CDATA)
  return /type\s*=\s*["']xhtml["']/i.test(m[1] || "") ? m[2].replace(/^\s*<div[^>]*>|<\/div>\s*$/gi, "") : xmlText(m[2]);
}

function atomLink(block) {
  const links = [...block.matchAll(/<link\b([^>]*?)\/?>/gi)].map((m) => attrs(m[1]));
  const alt = links.find((a) => a.href && (!a.rel || a.rel === "alternate"));
  return alt ? alt.href : "";
}

// XML の文字データ: CDATA はそのまま、それ以外は実体参照を戻す
function xmlText(s) {
  if (s == null) return "";
  let out = "";
  let last = 0;
  for (const m of s.matchAll(/<!\[CDATA\[([\s\S]*?)\]\]>/g)) {
    out += decodeEntities(s.slice(last, m.index)) + m[1];
    last = m.index + m[0].length;
  }
  return out + decodeEntities(s.slice(last));
}

// タイトルに HTML が入っていることがあるので、タグを落としてテキストにする
function textOf(s) {
  return decodeEntities(xmlText(s).replace(/<[^>]+>/g, ""));
}

const NAMED = {
  amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ",
  hellip: "…", mdash: "—", ndash: "–", lsquo: "‘", rsquo: "’", ldquo: "“", rdquo: "”",
  laquo: "«", raquo: "»", copy: "©", reg: "®", trade: "™", middot: "·", bull: "•", times: "×",
};

function decodeEntities(s) {
  return String(s).replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (all, e) => {
    if (e[0] === "#") {
      const cp = e[1].toLowerCase() === "x" ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      try {
        return String.fromCodePoint(cp);
      } catch {
        return all;
      }
    }
    return NAMED[e.toLowerCase()] ?? all;
  });
}

function attrs(s) {
  const out = {};
  for (const m of (s || "").matchAll(/([^\s=\/]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+)))?/g)) {
    out[m[1].toLowerCase()] = decodeEntities(m[2] ?? m[3] ?? m[4] ?? "");
  }
  return out;
}

// --- HTML → Markdown -----------------------------------------------------

const VOID = new Set(["br", "img", "hr", "input", "meta", "link", "source", "wbr", "col", "area"]);
const BLOCK = new Set([
  "p", "div", "section", "article", "header", "footer", "main", "aside", "nav", "figure", "figcaption",
  "h1", "h2", "h3", "h4", "h5", "h6", "ul", "ol", "li", "blockquote", "pre", "hr",
  "table", "thead", "tbody", "tfoot", "tr", "dl", "dt", "dd",
]);

function htmlToMarkdown(html, base) {
  const root = parseHtml(String(html || ""));
  return blocks(root.children, { base })
    .join("\n\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function parseHtml(html) {
  html = html.replace(/<(script|style|noscript|iframe|svg)\b[\s\S]*?<\/\1\s*>/gi, "");
  const root = { tag: "#root", attrs: {}, children: [] };
  const stack = [root];
  const top = () => stack[stack.length - 1];
  const re = /<!--[\s\S]*?-->|<!\[CDATA\[[\s\S]*?\]\]>|<!(?:[^>]*)>|<(\/?)([a-zA-Z][a-zA-Z0-9:-]*)([^>]*?)(\/?)>|([^<]+)|</g;
  for (const m of html.matchAll(re)) {
    const [all, close, rawName, rawAttrs, selfClose, text] = m;
    if (text !== undefined || all === "<") {
      top().children.push({ text: all });
      continue;
    }
    if (!rawName) continue; // コメント・DOCTYPE
    const name = rawName.toLowerCase();
    if (close) {
      const idx = stack.map((n) => n.tag).lastIndexOf(name);
      if (idx > 0) stack.length = idx;
      continue;
    }
    // 閉じタグの省略(<li>…<li>、<p>…<p>)に対応
    if ((name === "li" || name === "p" || name === "dt" || name === "dd") && top().tag === name) stack.pop();
    const node = { tag: name, attrs: attrs(rawAttrs), children: [] };
    top().children.push(node);
    if (!VOID.has(name) && !selfClose) stack.push(node);
  }
  return root;
}

const isBlock = (n) => n.tag && BLOCK.has(n.tag);

// 子ノードを Markdown のブロック(段落ごとの文字列)の配列にする
function blocks(children, ctx) {
  const out = [];
  let buf = "";
  const flush = () => {
    const t = buf
      .split("\n")
      .map((l) => l.trim())
      .filter(Boolean)
      .join("\n");
    if (t) out.push(t);
    buf = "";
  };
  for (const c of children) {
    if (isBlock(c)) {
      flush();
      out.push(...block(c, ctx));
    } else {
      buf += inline(c, ctx);
    }
  }
  flush();
  return out;
}

function block(n, ctx) {
  const t = n.tag;
  if (/^h[1-6]$/.test(t)) {
    const text = inlineAll(n.children, ctx).replace(/\s+/g, " ").trim();
    return text ? [`${"#".repeat(Number(t[1]))} ${text}`] : [];
  }
  if (t === "hr") return ["---"];
  if (t === "pre") {
    const code = decodeEntities(rawText(n)).replace(/^\n+|\n+$/g, "");
    return code ? ["```\n" + code + "\n```"] : [];
  }
  if (t === "blockquote") {
    const inner = blocks(n.children, ctx).join("\n\n");
    return inner ? [inner.split("\n").map((l) => (l ? `> ${l}` : ">")).join("\n")] : [];
  }
  if (t === "ul" || t === "ol") return list(n, ctx);
  if (t === "li") return list({ tag: "ul", children: [n] }, ctx);
  if (t === "tr") {
    const cells = n.children.filter((c) => c.tag === "td" || c.tag === "th");
    const row = cells.map((c) => inlineAll(c.children, ctx).replace(/\s+/g, " ").trim()).join(" | ");
    return row.trim() ? [row] : [];
  }
  return blocks(n.children, ctx);
}

function list(n, ctx) {
  const items = n.children.filter((c) => c.tag === "li");
  const start = Number(n.attrs?.start) || 1;
  const lines = items.map((li, i) => {
    const marker = n.tag === "ol" ? `${start + i}. ` : "- ";
    const pad = " ".repeat(marker.length);
    const content = blocks(li.children, ctx).join("\n").split("\n");
    return content.map((l, j) => (j === 0 ? marker + l : l ? pad + l : "")).join("\n");
  });
  return lines.length ? [lines.join("\n")] : [];
}

function inlineAll(children, ctx) {
  return children.map((c) => inline(c, ctx)).join("");
}

function inline(n, ctx) {
  if (n.text !== undefined) return decodeEntities(n.text).replace(/\s+/g, " ");
  const t = n.tag;
  if (t === "br") return "\n";
  if (t === "img") {
    const src = absUrl(n.attrs.src || n.attrs["data-src"], ctx.base);
    return src ? `![${(n.attrs.alt || "").replace(/[\[\]]/g, "")}](${src})` : "";
  }
  if (isBlock(n)) return " " + blocks(n.children, ctx).join(" ") + " ";
  const inner = inlineAll(n.children, ctx);
  if (t === "a") {
    const href = absUrl(n.attrs.href, ctx.base);
    const text = inner.replace(/\s+/g, " ").trim();
    if (!href || href.startsWith("javascript:")) return inner;
    if (!text) return "";
    return text === href ? `<${href}>` : `[${text}](${href})`;
  }
  if (t === "strong" || t === "b") return wrap(inner, "**");
  if (t === "em" || t === "i") return wrap(inner, "*");
  if (t === "code" || t === "kbd") return wrap(inner, "`");
  if (t === "del" || t === "s") return wrap(inner, "~~");
  return inner;
}

// 前後の空白を記号の外に出す(「** 太字 **」にならないように)
function wrap(s, mark) {
  const m = /^(\s*)([\s\S]*?)(\s*)$/.exec(s);
  return m[2] ? `${m[1]}${mark}${m[2]}${mark}${m[3]}` : s;
}

function rawText(n) {
  if (n.text !== undefined) return n.text;
  if (n.tag === "br") return "\n";
  return n.children.map(rawText).join("");
}

function absUrl(u, base) {
  if (!u) return "";
  try {
    return new URL(u.trim(), base || undefined).href;
  } catch {
    return u.trim();
  }
}

main().catch((e) => fail(e.stack || e.message));
