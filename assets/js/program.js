/**
 * プログラム表の操作（M3）。
 *
 * 旧版は各行に `id` を持たせて並び順を管理していたが、入れ替えのロジックが
 * 複雑になっていた（`sample/` の Editblock.vue 参照）。ここでは配列の並びを
 * そのまま正とし、DOM にも Firebase にも依存しない純粋関数として書く。
 * tests/program.test.js が Node で実行する。
 */

/**
 * RTDB から来た値を配列に正規化する。
 * RTDB は配列にもオブジェクトにもなりうるうえ、欠番があると穴あきになる。
 *
 * @param {unknown} value
 * @returns {{time: string, content: string}[]}
 */
export function normalizeProgram(value) {
  if (!value) return [];

  const rows = Array.isArray(value)
    ? value
    : Object.keys(value)
        .sort((a, b) => Number(a) - Number(b))
        .map((key) => value[key]);

  return rows
    .filter((row) => row && typeof row === "object")
    .map((row) => ({
      time: typeof row.time === "string" ? row.time : "",
      content: typeof row.content === "string" ? row.content : "",
    }));
}

/**
 * 行を入れ替えた新しい配列を返す。範囲外なら元の内容のまま返す。
 *
 * @param {{time: string, content: string}[]} rows
 * @param {number} from
 * @param {number} to
 */
export function moveRow(rows, from, to) {
  const next = rows.slice();
  if (!Number.isInteger(from) || !Number.isInteger(to)) return next;
  if (from < 0 || from >= next.length) return next;
  if (to < 0 || to >= next.length) return next;
  if (from === to) return next;

  const [moved] = next.splice(from, 1);
  next.splice(to, 0, moved);
  return next;
}

/**
 * 「いまここ」の添字を、行数に対して妥当な値に丸める。
 * 未指定・範囲外はすべて -1（ハイライトなし）にする。
 *
 * @param {unknown} index
 * @param {number} length
 * @returns {number}
 */
export function clampIndex(index, length) {
  if (typeof index !== "number" || !Number.isInteger(index)) return -1;
  if (length <= 0) return -1;
  if (index < 0 || index >= length) return -1;
  return index;
}

/**
 * 「いま」の目印を実際に表示する添字を返す（REQ-106）。
 *
 * 配信していない状態（`before` / `ended`）では、常に -1（表示しない）。
 * 大会当日は運営がてんやわんやで、配信の終了後に「いま」を戻し忘れることがある。
 * そのとき古い行が「いま」として残り続けると誤解を招くので、
 * **配信していないときは「いま」を出さない**ことで事故を防ぐ。
 *
 * 「いま」を出したくない場合は、管理画面から `currentProgramIndex` を -1 にする
 * （管理画面の「『いま』を消す」）。
 *
 * @param {unknown} stateName コートの状態（before / live / paused / ended）
 * @param {unknown} index `currentProgramIndex`
 * @param {number} length プログラムの行数
 * @returns {number} 表示する添字。表示しないなら -1
 */
export function visibleCurrentIndex(stateName, index, length) {
  if (stateName !== "live" && stateName !== "paused") return -1;
  return clampIndex(index, length);
}

/**
 * 「次の種目へ進む」の移動先を返す。
 * 未指定なら先頭へ。最終行では止まる（一周させない）。
 *
 * @param {unknown} index
 * @param {number} length
 * @returns {number}
 */
export function nextIndex(index, length) {
  if (length <= 0) return -1;
  const current = clampIndex(index, length);
  if (current < 0) return 0;
  return Math.min(current + 1, length - 1);
}
