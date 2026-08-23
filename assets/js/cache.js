/**
 * 直近に取得できたイベント情報の localStorage キャッシュ（REQ-131 / REQ-132）。
 *
 * 大会当日に Firebase が不調になっても、その時点までに取得できていた
 * 配信 URL とテロップを「最終取得 hh:mm 時点」と明示して見せられるようにする。
 * 当日の配信 URL は当日まで確定しないため、リポジトリ内の静的ファイルでは代替できない
 * （D-009）。
 */

const STORAGE_KEY = "yushinmon-live:last-event";

/**
 * @param {unknown} event RTDB から取得した events/{id} の内容
 */
export function saveSnapshot(event) {
  if (!event) return;
  try {
    const payload = JSON.stringify({ savedAt: Date.now(), event });
    window.localStorage.setItem(STORAGE_KEY, payload);
  } catch {
    // プライベートブラウズや容量超過で失敗しうる。キャッシュは best-effort。
  }
}

/**
 * @returns {{savedAt: number, event: object}|null}
 */
export function loadSnapshot() {
  let raw;
  try {
    raw = window.localStorage.getItem(STORAGE_KEY);
  } catch {
    return null;
  }
  if (!raw) return null;

  try {
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed.savedAt !== "number" || !parsed.event) return null;
    return parsed;
  } catch {
    return null;
  }
}

/** 「最終取得 10:32」の時刻部分を作る。 */
export function formatSavedAt(savedAt) {
  const date = new Date(savedAt);
  const hh = String(date.getHours()).padStart(2, "0");
  const mm = String(date.getMinutes()).padStart(2, "0");
  return `${hh}:${mm}`;
}
