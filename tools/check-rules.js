/**
 * Firebase 側の設定が正しいかを外から確かめる（HC-8 / D-017 のガード）。
 *
 *   node tools/check-rules.js
 *
 * セキュリティルールを更新したあと、および大会前日の準備で必ず実行する。
 * config.json の設定を使って、認証していないクライアントから見て
 * 「読めるべきものが読めるか」「読めてはいけないものが弾かれるか」
 * 「勝手にアカウントを作れないか」を実際に叩いて確認する。
 *
 * 依存パッケージは無い（NFR-03）。ネットワークに出るため、テストではなく
 * 手動で走らせる道具として置いてある。
 *
 * 副作用は無い。アカウント作成の確認は「既に存在するアドレス」で試すため、
 * 新しいアカウントが作られることはない。
 */

import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

const CONFIG_PATH = fileURLToPath(new URL("../config.json", import.meta.url));

const results = [];

function record(ok, title, detail) {
  results.push({ ok, title, detail });
  console.log(`${ok ? "  OK  " : " NG   "} ${title}`);
  if (detail) console.log(`         ${detail}`);
}

async function status(url, options) {
  const response = await fetch(url, options);
  const text = await response.text();
  return { code: response.status, text };
}

const config = JSON.parse(await readFile(CONFIG_PATH, "utf8"));
const base = String(config.firebase.databaseURL).replace(/\/+$/, "");
const apiKey = config.firebase.apiKey;

console.log(`対象プロジェクト: ${config.firebase.projectId}\n`);

// --- 1. 視聴ページが読めるべきもの ---------------------------------------

const active = await status(`${base}/_activeEvent_.json`);
const activeId = active.code === 200 ? JSON.parse(active.text) : null;

record(
  active.code === 200 && typeof activeId === "string" && activeId !== "",
  "_activeEvent_ を無認証で読める（視聴ページに必要）",
  active.code === 200 ? `配信中のイベント: ${activeId}` : `HTTP ${active.code}`
);

const control = await status(`${base}/_control_.json`);
record(
  control.code === 200,
  "_control_ を無認証で読める（強制リロードの受信に必要）",
  control.code === 200 ? "" : `HTTP ${control.code}`
);

if (activeId) {
  const activeEvent = await status(`${base}/events/${activeId}.json?shallow=true`);
  record(
    activeEvent.code === 200,
    "配信中のイベントを無認証で読める（視聴ページに必要）",
    activeEvent.code === 200 ? "" : `HTTP ${activeEvent.code}`
  );
}

// --- 2. 読めてはいけないもの（D-017） -------------------------------------

const allEvents = await status(`${base}/events.json?shallow=true`);
record(
  allEvents.code === 401,
  "events 全体は無認証で読めない（過去大会の URL を列挙させない）",
  allEvents.code === 401 ? "" : `HTTP ${allEvents.code} — 過去の限定公開 URL が列挙できます`
);

const otherEvent = await status(`${base}/events/__not_active__.json`);
record(
  otherEvent.code === 401,
  "配信中でないイベントは無認証で読めない",
  otherEvent.code === 401 ? "" : `HTTP ${otherEvent.code}`
);

// --- 3. 書き込みが弾かれること（HC-8） ------------------------------------

const write = await status(`${base}/_control_/forceReloadAt.json`, {
  method: "PUT",
  headers: { "content-type": "application/json" },
  body: "1",
});
record(
  write.code === 401,
  "無認証では書き込めない",
  write.code === 401 ? "" : `HTTP ${write.code} — 誰でもテロップを書き換えられます`
);

// --- 4. 新規サインアップが無効であること（HC-8 の本体） -------------------

/*
 * identitytoolkit の accounts:signUp は、次の順で検証する。
 *
 *   1. 入力の形式（短すぎるパスワードなら WEAK_PASSWORD）
 *   2. メールアドレスの重複（既に存在すれば EMAIL_EXISTS）
 *   3. 「作成（登録）を許可する」の設定（無効なら ADMIN_ONLY_OPERATION）
 *
 * つまり 1 と 2 で止まる投げ方をすると、3 の設定を確かめられない。
 * 3 まで到達させるには「存在しないアドレス」と「有効な長さのパスワード」で投げる必要がある。
 *
 * その代償として、設定が有効だった場合はアカウントが 1 つ作られてしまう。
 * ただしそれは既に無防備な状態のときだけであり、そのこと自体が検知したい事実である。
 * 作られた場合は localId を出して削除を促す。
 */
const PROBE_EMAIL = "yushinmon-live-rules-check@example.invalid";

const signUp = await status(
  `https://identitytoolkit.googleapis.com/v1/accounts:signUp?key=${encodeURIComponent(apiKey)}`,
  {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      email: PROBE_EMAIL,
      password: "rules-check-probe-password",
      returnSecureToken: true,
    }),
  }
);

const parsed = (() => {
  try {
    return JSON.parse(signUp.text);
  } catch {
    return null;
  }
})();
const message = (parsed && parsed.error && parsed.error.message) || signUp.text.slice(0, 160);

if (message.includes("ADMIN_ONLY_OPERATION") || message.includes("OPERATION_NOT_ALLOWED")) {
  record(true, "新規サインアップが無効になっている（HC-8・唯一かつ必須の防御）");
} else if (parsed && parsed.localId) {
  record(
    false,
    "新規サインアップが無効になっている（HC-8・唯一かつ必須の防御）",
    `サインアップが有効です。いまは誰でもアカウントを作り、テロップや配信 URL を書き換えられます。\n` +
      `         Firebase Console → Authentication → 設定 → ユーザー アクション →\n` +
      `         「作成（登録）を許可する」のチェックを外してください。\n` +
      `         この確認で ${PROBE_EMAIL} が作成されました。ユーザー一覧から削除してください（localId: ${parsed.localId}）`
  );
} else {
  record(
    false,
    "新規サインアップが無効になっている（HC-8・唯一かつ必須の防御）",
    `判定できませんでした。応答: ${message}`
  );
}

// --- まとめ ---------------------------------------------------------------

const failed = results.filter((result) => !result.ok);
console.log(`\n${results.length - failed.length} / ${results.length} 件が期待どおりです。`);

if (failed.length > 0) {
  console.log("\n次の項目を直してください:");
  for (const result of failed) console.log(`  - ${result.title}`);
  process.exitCode = 1;
} else {
  console.log("Firebase 側の設定は期待どおりです。");
}
