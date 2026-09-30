/**
 * イベント ID の検証（REQ-152）。
 *
 * イベント ID は Firebase Realtime Database のキーになるため、
 * キーに使えない文字（`.` `$` `#` `[` `]` `/` と制御文字）を避ける必要がある。
 * ここではさらに狭めて、英小文字・数字・ハイフンだけにする。
 * URL やファイル名に貼っても困らず、大文字小文字の取り違えも起きないため。
 *
 * 既存のイベント（例: `2026-autumn`）もこの形に収まっているので、
 * 過去のデータが不正扱いになることはない。
 *
 * DOM にも Firebase にも依存させないこと（tests/event-id.test.js が Node で実行する）。
 */

const EVENT_ID_PATTERN = /^[a-z0-9][a-z0-9-]{0,39}$/;

/**
 * @param {unknown} value
 * @returns {boolean}
 */
export function isValidEventId(value) {
  return typeof value === "string" && EVENT_ID_PATTERN.test(value);
}

/**
 * 入力欄の下に出す説明。`null` なら問題なし。
 * 沈黙して弾かず、なぜ駄目なのかを画面に出すために使う。
 *
 * @param {unknown} value
 * @param {object|null} existingEvents 既存のイベント一覧（キーが ID）
 * @returns {string|null}
 */
export function describeEventIdProblem(value, existingEvents) {
  if (typeof value !== "string" || value === "") return "イベント ID を入力してください。";
  if (!isValidEventId(value)) {
    return "英小文字・数字・ハイフンだけが使えます（先頭は英小文字か数字、40 文字まで）。";
  }
  if (existingEvents && Object.prototype.hasOwnProperty.call(existingEvents, value)) {
    return "この ID のイベントは既にあります。別の ID にしてください。";
  }
  return null;
}
