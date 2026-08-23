/**
 * YouTube の URL / ID を扱う純粋関数。
 *
 * REQ-143: 管理画面では watch / youtu.be / live / embed のどの形式で貼られても
 * 受け付ける。旧版は /embed/ 形式を手打ちさせており、それが当日の事故源だった。
 * DOM にも Firebase にも依存させないこと（tests/youtube.test.js が Node で実行する）。
 */

const VIDEO_ID_PATTERN = /^[A-Za-z0-9_-]{11}$/;

const YOUTUBE_HOSTS = new Set([
  "youtube.com",
  "m.youtube.com",
  "music.youtube.com",
  "youtube-nocookie.com",
]);

const PATH_PATTERN = /^\/(?:live|embed|shorts|v)\/([A-Za-z0-9_-]{11})(?:[/?#]|$)/;

/**
 * 動画 ID として妥当な文字列かどうか。
 * @param {unknown} value
 * @returns {boolean}
 */
export function isVideoId(value) {
  return typeof value === "string" && VIDEO_ID_PATTERN.test(value);
}

/**
 * 貼り付けられた文字列から YouTube の動画 ID を取り出す。
 *
 * 受け付ける形式:
 *   - 動画 ID そのもの            dQw4w9WgXcQ
 *   - https://www.youtube.com/watch?v=ID
 *   - https://youtu.be/ID
 *   - https://www.youtube.com/live/ID
 *   - https://www.youtube.com/embed/ID
 *   - https://www.youtube.com/shorts/ID
 *   - スキームなし（youtu.be/ID）や余分なクエリ・前後の空白も許容する
 *
 * @param {unknown} input
 * @returns {string|null} 動画 ID。取り出せなければ null
 */
export function parseVideoId(input) {
  if (typeof input !== "string") return null;

  const text = input.trim();
  if (text === "") return null;

  if (VIDEO_ID_PATTERN.test(text)) return text;

  let url;
  try {
    url = new URL(/^https?:\/\//i.test(text) ? text : `https://${text}`);
  } catch {
    return null;
  }

  const host = url.hostname.replace(/^www\./i, "").toLowerCase();

  if (host === "youtu.be") {
    const id = url.pathname.split("/")[1] || "";
    return VIDEO_ID_PATTERN.test(id) ? id : null;
  }

  if (!YOUTUBE_HOSTS.has(host)) return null;

  const v = url.searchParams.get("v");
  if (v && VIDEO_ID_PATTERN.test(v)) return v;

  const matched = url.pathname.match(PATH_PATTERN);
  return matched ? matched[1] : null;
}

/**
 * 視聴者向けの「YouTube で直接開く」リンク（REQ-104）。
 * @param {string} videoId
 * @returns {string|null}
 */
export function watchUrl(videoId) {
  return isVideoId(videoId) ? `https://www.youtube.com/watch?v=${videoId}` : null;
}
