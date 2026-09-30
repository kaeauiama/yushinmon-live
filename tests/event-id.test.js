import test from "node:test";
import assert from "node:assert/strict";

import { isValidEventId, describeEventIdProblem } from "../assets/js/event-id.js";

test("isValidEventId: 既存のイベント ID の形は通る（後方互換）", () => {
  assert.equal(isValidEventId("2026-autumn"), true);
  assert.equal(isValidEventId("2025-01-kangeiko"), true);
  assert.equal(isValidEventId("sample"), true);
  assert.equal(isValidEventId("2027"), true);
});

test("isValidEventId: RTDB のキーに使えない文字を弾く", () => {
  for (const bad of ["a.b", "a$b", "a#b", "a[b", "a]b", "a/b", "a b", "a	b"]) {
    assert.equal(isValidEventId(bad), false, bad);
  }
});

test("isValidEventId: 大文字・記号・空・長すぎるものを弾く", () => {
  assert.equal(isValidEventId("2026-Autumn"), false);
  assert.equal(isValidEventId("イベント"), false);
  assert.equal(isValidEventId("-leading"), false, "先頭のハイフンは不可");
  assert.equal(isValidEventId(""), false);
  assert.equal(isValidEventId("a".repeat(40)), true, "40 文字は可");
  assert.equal(isValidEventId("a".repeat(41)), false, "41 文字は不可");
  assert.equal(isValidEventId(null), false);
  assert.equal(isValidEventId(123), false);
});

test("describeEventIdProblem: 問題がなければ null", () => {
  assert.equal(describeEventIdProblem("2027-spring", { "2026-autumn": {} }), null);
  assert.equal(describeEventIdProblem("2027-spring", null), null);
});

test("describeEventIdProblem: 既存の ID は理由を返す（上書き防止）", () => {
  const message = describeEventIdProblem("2026-autumn", { "2026-autumn": {} });
  assert.match(message, /既にあります/);
});

test("describeEventIdProblem: 未入力と形式違反も理由を返す", () => {
  assert.match(describeEventIdProblem("", null), /入力してください/);
  assert.match(describeEventIdProblem("2026 Autumn", null), /英小文字/);
});

test("describeEventIdProblem: prototype 由来のキーを既存と誤判定しない", () => {
  assert.equal(describeEventIdProblem("constructor", {}), null);
  assert.equal(describeEventIdProblem("tostring", {}), null);
});
