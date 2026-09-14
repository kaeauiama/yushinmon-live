/**
 * Hard Constraints の回帰テスト。
 *
 * docs/requirements.md の HC-1 / HC-2 / HC-4 / HC-6 は
 * 「実装しない」だけでなく「越えようとしたら弾く」ことで担保する。
 * 文章だけの制約は必ず溶けるため、ここで機械的に検査する。
 *
 * HC-8（Firebase の新規サインアップ無効化）は Firebase Emulator が必要なため、
 * 認証を実装する M2 で追加する。現時点では未担保である。
 */

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const ROOT = fileURLToPath(new URL("..", import.meta.url));

/** 公開される実装ファイル（docs は検査対象外。説明のために例示を書くため） */
const SOURCE_DIRS = ["assets", "admin"];
const SOURCE_ROOT_FILES = ["index.html"];

function collectSources() {
  const files = [];

  for (const name of SOURCE_ROOT_FILES) {
    const full = path.join(ROOT, name);
    if (exists(full)) files.push(full);
  }

  for (const dir of SOURCE_DIRS) {
    const full = path.join(ROOT, dir);
    if (exists(full)) walk(full, files);
  }

  return files;
}

function walk(dir, out) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, out);
    else if (/\.(js|html|css)$/.test(entry.name)) out.push(full);
  }
}

function exists(p) {
  try {
    statSync(p);
    return true;
  } catch {
    return false;
  }
}

function relative(file) {
  return path.relative(ROOT, file).split(path.sep).join("/");
}

function read(file) {
  return readFileSync(file, "utf8");
}

/**
 * コメントを除いたソースを返す。
 *
 * 「コードがそう書かれていないこと」を検査する項目に使う。制約の説明文が
 * コメントに書かれているだけで検査が落ちるのを避けるため。
 * ただし HC-1（メールアドレス）はコメントも公開されるので raw のまま検査する。
 *
 * 行コメントは行頭にあるものだけを除く。行中の "//" を落とすと
 * URL（https://...）を巻き込んでしまうため。
 */
function readCode(file) {
  return read(file)
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/^[ \t]*\/\/.*$/gm, " ");
}

// ---------------------------------------------------------------------------

test("HC-1: 実装ファイルにメールアドレスを埋め込まない", () => {
  // 旧版は管理者の個人 Gmail を文字列分割で難読化していた。
  // 難読化は保護ではない。メールアドレスは config.json にのみ置く。
  const emailPattern = /[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+\.[A-Za-z][A-Za-z0-9.-]*/;

  for (const file of collectSources()) {
    const found = read(file).match(emailPattern);
    assert.equal(
      found,
      null,
      `${relative(file)} にメールアドレスらしき文字列があります: ${found && found[0]}`
    );
  }
});

test("HC-1: 旧版のソース（sample/）を公開対象から外している", () => {
  // sample/ には旧版のコードが入っており、管理者の個人メールアドレスを
  // 文字列分割で埋め込んだ実装を含む。難読化は保護ではないので、
  // 公開リポジトリに入れてはいけない。
  const gitignore = read(path.join(ROOT, ".gitignore"));
  assert.match(
    gitignore,
    /^sample\/\s*$/m,
    ".gitignore に sample/ の除外が必要です（HC-1）"
  );
});

test("HC-1: 実装ファイルに秘密情報らしき代入を書かない", () => {
  const secretPattern = /\b(password|passwd|secret|privateKey|clientSecret)\s*[:=]\s*["'][^"']{4,}["']/i;

  for (const file of collectSources()) {
    const found = read(file).match(secretPattern);
    assert.equal(found, null, `${relative(file)} に秘密情報らしき記述があります: ${found && found[0]}`);
  }
});

test("HC-6: iframe の src を書き換えて差し替えない", () => {
  // src を書き換えるとプレーヤーが作り直され、全画面と再生状態が壊れる。
  // 差し替えは必ず IFrame Player API の loadVideoById で行う。
  // IFrame API の script タグは index.html が読み込むため、
  // JavaScript 側に .src への代入は 1 つも存在しないはずである。
  const assignmentPattern = /\.src\s*=[^=]/;
  const setAttributePattern = /setAttribute\s*\(\s*["']src["']/;

  const jsFiles = collectSources().filter((file) => file.endsWith(".js"));
  assert.ok(jsFiles.length > 0, "検査対象の JavaScript が見つかりません");

  for (const file of jsFiles) {
    const source = readCode(file);
    assert.equal(
      assignmentPattern.test(source),
      false,
      `${relative(file)} に .src への代入があります（HC-6）`
    );
    assert.equal(
      setAttributePattern.test(source),
      false,
      `${relative(file)} に setAttribute("src") があります（HC-6）`
    );
  }
});

test("HC-6: 差し替えに loadVideoById を使っている", () => {
  const player = read(path.join(ROOT, "assets/js/player.js"));
  assert.match(player, /loadVideoById\s*\(/, "loadVideoById による差し替えが見当たりません");
});

test("HC-4: 視聴側のコードが認証を読み込まない", () => {
  // 視聴者は認証しない。認証ロジックは admin/ 配下にのみ置く。
  const viewerFiles = collectSources().filter((file) => !relative(file).startsWith("admin/"));

  for (const file of viewerFiles) {
    const source = readCode(file);
    assert.equal(
      /firebase-auth|getAuth\s*\(|signInWith/.test(source),
      false,
      `${relative(file)} が認証を参照しています（HC-4）`
    );
  }
});

test("HC-4: 視聴ページに合言葉・パスコードの入力欄を作らない", () => {
  const html = read(path.join(ROOT, "index.html"));
  assert.equal(
    /type\s*=\s*["']password["']/.test(html),
    false,
    "視聴ページにパスワード入力欄があります（HC-4）"
  );
});

test("HC-2: YouTube プレーヤーを覆う要素を置かない", () => {
  // プレーヤーのコンテナに position:relative を持たせないことで、
  // 後からオーバーレイを重ねにくい構造にしてある。
  const css = read(path.join(ROOT, "assets/css/style.css"));

  for (const block of cssBlocks(css)) {
    if (!/player/i.test(block.selector)) continue;
    assert.equal(
      /position\s*:\s*(absolute|fixed|relative)/.test(block.body),
      false,
      `${block.selector} に position 指定があります。プレーヤーを覆う土台になります（HC-2）`
    );
  }
});

test("HC-2: プレーヤーの入れ物の中には、プレーヤー以外を入れない", () => {
  // 中断中の帯などの案内は、プレーヤーに重ねず外側に置く。
  // 入れ物の中身が差し込み用の要素 1 つだけであることを確かめる。
  const html = readCode(path.join(ROOT, "index.html"));
  assert.match(
    html,
    /<div id="player-frame"[^>]*>\s*<div id="player-mount"><\/div>\s*<\/div>/,
    "player-frame の中に player-mount 以外の要素があります（HC-2）"
  );

  const noticeAt = html.indexOf('id="paused-notice"');
  const frameAt = html.indexOf('id="player-frame"');
  assert.ok(noticeAt !== -1, "中断中の帯（paused-notice）が見つかりません");
  assert.ok(noticeAt < frameAt, "中断中の帯はプレーヤーの外側（上）に置きます");
});

function cssBlocks(css) {
  const blocks = [];
  const pattern = /([^{}]+)\{([^{}]*)\}/g;
  let match;
  while ((match = pattern.exec(css)) !== null) {
    blocks.push({ selector: match[1].trim(), body: match[2] });
  }
  return blocks;
}

// ---------------------------------------------------------------------------

test("hidden 属性が display 指定つきのクラスに負けないこと", () => {
  // 実機で発覚した不具合の回帰テスト。
  // .placeholder / .banner-action は display:flex を持つため、
  // ブラウザ既定の [hidden] { display: none } を打ち消してしまう。
  const css = read(path.join(ROOT, "assets/css/style.css"));
  assert.match(
    css,
    /\[hidden\]\s*\{[^}]*display\s*:\s*none\s*!important/,
    "[hidden] { display: none !important } が必要です"
  );
});

test("REQ-110: 視聴ページに noindex がある", () => {
  const html = read(path.join(ROOT, "index.html"));
  assert.match(html, /<meta\s+name=["']robots["']\s+content=["'][^"']*noindex/i);
});

test("REQ-108 / REQ-109: 遅延と転載禁止の注意書きが常時ある", () => {
  const html = read(path.join(ROOT, "index.html"));
  assert.match(html, /遅れて表示されます/);
  assert.match(html, /転載は禁止/);
});

test("REQ-161: 実装ファイルに Firebase の設定値を直書きしない", () => {
  // 団体固有の値は config.json に集約する。
  for (const file of collectSources()) {
    const source = readCode(file);
    assert.equal(
      /AIza[0-9A-Za-z_-]{20,}/.test(source),
      false,
      `${relative(file)} に Firebase の apiKey が直書きされています（REQ-161）`
    );
    assert.equal(
      /firebaseio\.com|firebasedatabase\.app/.test(source),
      false,
      `${relative(file)} に databaseURL が直書きされています（REQ-161）`
    );
  }
});

test("REQ-163: config.sample.json が config.json と同じ項目を持つ", () => {
  const sample = JSON.parse(read(path.join(ROOT, "config.sample.json")));
  const actual = JSON.parse(read(path.join(ROOT, "config.json")));

  const keysOf = (o) => Object.keys(o).filter((k) => k !== "_comment").sort();
  assert.deepEqual(keysOf(sample), keysOf(actual), "config.sample.json の項目がずれています");
  assert.deepEqual(
    Object.keys(sample.firebase).sort(),
    Object.keys(actual.firebase).sort(),
    "config.sample.json の firebase 項目がずれています"
  );
});
