import test from "node:test";
import assert from "node:assert/strict";

import { parseVideoId, isVideoId, watchUrl } from "../assets/js/youtube.js";

const ID = "dQw4w9WgXcQ";

test("parseVideoId: 動画 ID そのものを受け付ける", () => {
  assert.equal(parseVideoId(ID), ID);
  assert.equal(parseVideoId(`  ${ID}  `), ID);
});

test("parseVideoId: 視聴 URL を受け付ける（REQ-143）", () => {
  assert.equal(parseVideoId(`https://www.youtube.com/watch?v=${ID}`), ID);
  assert.equal(parseVideoId(`https://youtube.com/watch?v=${ID}`), ID);
  assert.equal(parseVideoId(`http://www.youtube.com/watch?v=${ID}&t=42s`), ID);
  assert.equal(parseVideoId(`https://m.youtube.com/watch?v=${ID}`), ID);
});

test("parseVideoId: 短縮 URL を受け付ける", () => {
  assert.equal(parseVideoId(`https://youtu.be/${ID}`), ID);
  assert.equal(parseVideoId(`https://youtu.be/${ID}?t=10`), ID);
});

test("parseVideoId: ライブ・埋め込み形式を受け付ける", () => {
  assert.equal(parseVideoId(`https://www.youtube.com/live/${ID}`), ID);
  assert.equal(parseVideoId(`https://www.youtube.com/live/${ID}?feature=share`), ID);
  assert.equal(parseVideoId(`https://www.youtube.com/embed/${ID}`), ID);
  assert.equal(parseVideoId(`https://www.youtube-nocookie.com/embed/${ID}`), ID);
  assert.equal(parseVideoId(`https://www.youtube.com/shorts/${ID}`), ID);
});

test("parseVideoId: スキーム省略を受け付ける", () => {
  assert.equal(parseVideoId(`youtu.be/${ID}`), ID);
  assert.equal(parseVideoId(`www.youtube.com/watch?v=${ID}`), ID);
});

test("parseVideoId: 受け付けられない入力は null を返す（無言で誤った値を返さない）", () => {
  assert.equal(parseVideoId(""), null);
  assert.equal(parseVideoId("   "), null);
  assert.equal(parseVideoId("これはURLではありません"), null);
  assert.equal(parseVideoId("https://example.com/watch?v=" + ID), null);
  assert.equal(parseVideoId("https://vimeo.com/123456"), null);
  assert.equal(parseVideoId("https://www.youtube.com/"), null);
  assert.equal(parseVideoId("https://www.youtube.com/watch?v=short"), null);
  assert.equal(parseVideoId(`https://www.youtube.com/watch?v=${ID}xxxx`), null);
  assert.equal(parseVideoId(null), null);
  assert.equal(parseVideoId(undefined), null);
  assert.equal(parseVideoId(42), null);
});

test("parseVideoId: チャンネルページは動画 ID を持たないので null", () => {
  assert.equal(parseVideoId("https://www.youtube.com/@yushinmon"), null);
  assert.equal(parseVideoId("https://www.youtube.com/@yushinmon/live"), null);
});

test("isVideoId", () => {
  assert.equal(isVideoId(ID), true);
  assert.equal(isVideoId("short"), false);
  assert.equal(isVideoId(null), false);
});

test("watchUrl: 視聴者向けの直リンクを作る（REQ-104）", () => {
  assert.equal(watchUrl(ID), `https://www.youtube.com/watch?v=${ID}`);
  assert.equal(watchUrl(null), null);
  assert.equal(watchUrl("short"), null);
});
