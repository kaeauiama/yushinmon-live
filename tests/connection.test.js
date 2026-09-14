/**
 * 「通信が不安定です」の表示判定（REQ-128）。
 *
 * 実運用で見つかった不具合の回帰テスト:
 * 回線が正常でも、ページを開いた瞬間に「通信が不安定です」が表示されていた。
 * Firebase の `.info/connected` が接続確立前にまず false を返すため。
 */

import test from "node:test";
import assert from "node:assert/strict";

import { ConnectionWatcher, CONNECTION_WARNING_DELAY_MS } from "../assets/js/connection.js";

/** 時間を手で進められる偽のタイマー */
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
  const watcher = new ConnectionWatcher({
    onWarningChange: (warning) => changes.push(warning),
    schedule: clock.schedule,
    cancel: clock.cancel,
  });
  return { clock, changes, watcher };
}

test("開いた直後の false では警告を出さない（実際に起きていた不具合）", () => {
  const { clock, changes, watcher } = setup();

  watcher.update(false); // .info/connected の初期値
  clock.advance(CONNECTION_WARNING_DELAY_MS * 10);

  assert.deepEqual(changes, [], "一度もつながる前に警告してはいけない");
  assert.equal(watcher.warning, false);
  assert.equal(clock.pending, 0, "タイマーも仕掛けない");
});

test("正常な起動（false → true）では何も表示が変わらない", () => {
  const { clock, changes, watcher } = setup();

  watcher.update(false);
  watcher.update(true);
  clock.advance(CONNECTION_WARNING_DELAY_MS * 10);

  assert.deepEqual(changes, []);
  assert.equal(watcher.warning, false);
});

test("接続後に切れて、猶予時間を過ぎたら警告を出す", () => {
  const { clock, changes, watcher } = setup();

  watcher.update(true);
  watcher.update(false);

  clock.advance(CONNECTION_WARNING_DELAY_MS - 1);
  assert.deepEqual(changes, [], "猶予時間内はまだ出さない");

  clock.advance(1);
  assert.deepEqual(changes, [true]);
  assert.equal(watcher.warning, true);
});

test("瞬断（猶予時間内に復帰）では警告を出さない", () => {
  const { clock, changes, watcher } = setup();

  watcher.update(true);
  watcher.update(false);
  clock.advance(CONNECTION_WARNING_DELAY_MS / 2);
  watcher.update(true);
  clock.advance(CONNECTION_WARNING_DELAY_MS * 10);

  assert.deepEqual(changes, [], "ちらつかせない");
  assert.equal(clock.pending, 0, "待機中のタイマーは取り消されている");
});

test("警告中に復帰したら即座に消す", () => {
  const { clock, changes, watcher } = setup();

  watcher.update(true);
  watcher.update(false);
  clock.advance(CONNECTION_WARNING_DELAY_MS);
  watcher.update(true);

  assert.deepEqual(changes, [true, false]);
  assert.equal(watcher.warning, false);
});

test("false が続けて届いてもタイマーを重ねない", () => {
  const { clock, changes, watcher } = setup();

  watcher.update(true);
  watcher.update(false);
  watcher.update(false);
  watcher.update(false);
  assert.equal(clock.pending, 1);

  clock.advance(CONNECTION_WARNING_DELAY_MS);
  watcher.update(false);
  assert.deepEqual(changes, [true], "警告は 1 回だけ通知する");
  assert.equal(clock.pending, 0);
});

test("切断と復帰を繰り返しても、毎回正しく判定する", () => {
  const { clock, changes, watcher } = setup();

  watcher.update(true);
  for (let i = 0; i < 3; i++) {
    watcher.update(false);
    clock.advance(CONNECTION_WARNING_DELAY_MS);
    watcher.update(true);
  }
  assert.deepEqual(changes, [true, false, true, false, true, false]);
});

test("既定のタイマーで this が外れない（ブラウザでの Illegal invocation 対策）", () => {
  const changes = [];
  const watcher = new ConnectionWatcher({
    onWarningChange: (warning) => changes.push(warning),
    delayMs: 1,
  });
  watcher.update(true);
  assert.doesNotThrow(() => watcher.update(false));
  watcher.update(true); // 後始末（タイマーを取り消す）
  assert.equal(watcher.timer, null);
});
