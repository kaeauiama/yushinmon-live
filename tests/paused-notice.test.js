/**
 * 中断中の帯の表示判定（REQ-129）。
 *
 * 帯は「スタッフが中断中にしている」かつ「実際に映像が止まっている」ときだけ出す。
 * 復旧したのにスタッフの操作が遅れて「中断中」と見え続けることを避けるため。
 */

import test from "node:test";
import assert from "node:assert/strict";

import {
  PausedNotice,
  NOTICE_SHOW_DELAY_MS,
  NOTICE_HIDE_DELAY_MS,
} from "../assets/js/paused-notice.js";

function fakeClock() {
  let now = 0;
  let nextId = 1;
  const timers = new Map();
  return {
    schedule(callback, ms) {
      const id = nextId++;
      timers.set(id, { at: now + ms, callback });
      return id;
    },
    cancel(id) {
      timers.delete(id);
    },
    advance(ms) {
      now += ms;
      for (const [id, timer] of [...timers]) {
        if (timer.at <= now) {
          timers.delete(id);
          timer.callback();
        }
      }
    },
    get pending() {
      return timers.size;
    },
  };
}

function setup() {
  const clock = fakeClock();
  const changes = [];
  const notice = new PausedNotice({
    onChange: (visible) => changes.push(visible),
    schedule: clock.schedule,
    cancel: clock.cancel,
  });
  return { clock, changes, notice };
}

test("配信中は、映像が止まっても帯を出さない（中断中の判断はスタッフが行う）", () => {
  const { clock, changes, notice } = setup();

  notice.setPlaying(true);
  notice.setPlaying(false);
  clock.advance(NOTICE_SHOW_DELAY_MS * 10);

  assert.deepEqual(changes, []);
});

test("中断中にされ、映像が止まっていれば、すぐに帯を出す", () => {
  const { changes, notice } = setup();

  notice.setPaused(true);

  assert.deepEqual(changes, [true], "スタッフの操作には猶予を置かず即座に従う");
});

test("中断中にされても、映像が流れている間は帯を出さない（休憩中に映像を流し続ける場合など）", () => {
  const { clock, changes, notice } = setup();

  notice.setPlaying(true);
  notice.setPaused(true);
  clock.advance(NOTICE_SHOW_DELAY_MS * 10);

  assert.deepEqual(changes, []);
});

test("中断中にしたあと、手元に残っていた映像が尽きて止まったら、猶予ののち帯を出す", () => {
  // 配信は数十秒遅れるので、スタッフが中断中にした時点では視聴者側はまだ映像が流れている
  const { clock, changes, notice } = setup();

  notice.setPlaying(true);
  notice.setPaused(true);
  notice.setPlaying(false);

  clock.advance(NOTICE_SHOW_DELAY_MS - 1);
  assert.deepEqual(changes, [], "読み込みの一時停止でちらつかせない");

  clock.advance(1);
  assert.deepEqual(changes, [true]);
});

test("【勘違い防止】中断中のまま映像が戻ったら、スタッフの操作を待たずに帯を消す", () => {
  const { clock, changes, notice } = setup();

  notice.setPaused(true); // 帯が出る
  notice.setPlaying(true); // 配信が復旧して映像が流れ始めた（スタッフはまだ中断中のまま）

  clock.advance(NOTICE_HIDE_DELAY_MS - 1);
  assert.deepEqual(changes, [true], "すぐには消さない（復帰直後の揺れ対策）");

  clock.advance(1);
  assert.deepEqual(changes, [true, false], "映像が流れ続けたら消える");
  assert.equal(notice.visible, false);
});

test("復帰直後に映像が揺れても（再生→読み込み→再生）、帯はちらつかない", () => {
  const { clock, changes, notice } = setup();

  notice.setPaused(true); // 帯が出る
  notice.setPlaying(true);
  clock.advance(NOTICE_HIDE_DELAY_MS / 2);
  notice.setPlaying(false); // 一瞬の読み込み
  clock.advance(NOTICE_SHOW_DELAY_MS / 2);
  notice.setPlaying(true);
  clock.advance(NOTICE_HIDE_DELAY_MS);

  assert.deepEqual(changes, [true, false], "出たまま揺れを挟み、最後に 1 回だけ消える");
});

test("映像が流れている中断中に、一瞬だけ読み込みが挟まっても帯は出さない", () => {
  const { clock, changes, notice } = setup();

  notice.setPlaying(true);
  notice.setPaused(true);
  notice.setPlaying(false);
  clock.advance(NOTICE_SHOW_DELAY_MS / 2);
  notice.setPlaying(true);
  clock.advance(NOTICE_SHOW_DELAY_MS * 10);

  assert.deepEqual(changes, []);
  assert.equal(clock.pending, 0);
});

test("「配信中にする」が押されたら、猶予なく即座に帯を消す", () => {
  const { clock, changes, notice } = setup();

  notice.setPaused(true);
  notice.setPaused(false);

  assert.deepEqual(changes, [true, false]);
  assert.equal(clock.pending, 0);
});

test("「配信中にする」は、帯を出す待機中でも取り消す", () => {
  const { clock, changes, notice } = setup();

  notice.setPlaying(true);
  notice.setPaused(true);
  notice.setPlaying(false); // 帯を出す待機が始まる
  notice.setPaused(false);
  clock.advance(NOTICE_SHOW_DELAY_MS * 10);

  assert.deepEqual(changes, []);
  assert.equal(clock.pending, 0);
});

test("描画のたびに同じ状態が届いても、待機中の判定をやり直さない", () => {
  // テロップの書き換えなどで render() は何度も呼ばれ、そのたびに setPaused(true) が届く
  const { clock, changes, notice } = setup();

  notice.setPaused(true); // 帯が出る
  notice.setPlaying(true); // 消す待機
  clock.advance(NOTICE_HIDE_DELAY_MS / 2);
  notice.setPaused(true); // テロップ更新による再描画
  clock.advance(NOTICE_HIDE_DELAY_MS / 2);

  assert.deepEqual(changes, [true, false], "再描画で待機がリセットされない");
});

test("既定のタイマーで this が外れない", () => {
  const notice = new PausedNotice({ onChange: () => {}, showDelayMs: 1 });
  notice.setPlaying(true);
  notice.setPaused(true);
  assert.doesNotThrow(() => notice.setPlaying(false));
  notice.setPaused(false); // 後始末
  assert.equal(notice.timer, null);
});
