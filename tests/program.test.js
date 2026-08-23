import test from "node:test";
import assert from "node:assert/strict";

import { normalizeProgram, moveRow, clampIndex, nextIndex } from "../assets/js/program.js";

const rows = [
  { time: "10:30", content: "開会式" },
  { time: "11:00", content: "演武" },
  { time: "11:30", content: "組手の部" },
];

test("normalizeProgram: 配列をそのまま正規化する", () => {
  assert.deepEqual(normalizeProgram(rows), rows);
});

test("normalizeProgram: RTDB がオブジェクトで返しても数値順に並べる", () => {
  const asObject = { 2: rows[2], 0: rows[0], 1: rows[1] };
  assert.deepEqual(normalizeProgram(asObject), rows);
});

test("normalizeProgram: 10 行以上でも辞書順ではなく数値順に並ぶ", () => {
  const many = {};
  for (let i = 0; i < 12; i++) many[i] = { time: `${i}`, content: `行${i}` };
  const result = normalizeProgram(many);
  assert.equal(result.length, 12);
  assert.deepEqual(
    result.map((row) => row.content),
    Array.from({ length: 12 }, (_, i) => `行${i}`)
  );
});

test("normalizeProgram: 穴あき・欠損に耐える", () => {
  assert.deepEqual(normalizeProgram(null), []);
  assert.deepEqual(normalizeProgram(undefined), []);
  assert.deepEqual(normalizeProgram([]), []);
  assert.deepEqual(normalizeProgram([null, rows[0]]), [rows[0]]);
  assert.deepEqual(normalizeProgram([{ time: "10:00" }]), [{ time: "10:00", content: "" }]);
  assert.deepEqual(normalizeProgram([{ content: "開会式" }]), [{ time: "", content: "開会式" }]);
});

test("moveRow: 上下に動かす", () => {
  assert.deepEqual(
    moveRow(rows, 0, 1).map((row) => row.content),
    ["演武", "開会式", "組手の部"]
  );
  assert.deepEqual(
    moveRow(rows, 2, 0).map((row) => row.content),
    ["組手の部", "開会式", "演武"]
  );
});

test("moveRow: 元の配列を書き換えない", () => {
  const before = rows.map((row) => row.content);
  moveRow(rows, 0, 2);
  assert.deepEqual(rows.map((row) => row.content), before);
});

test("moveRow: 範囲外や同一位置なら内容が変わらない", () => {
  for (const [from, to] of [[-1, 0], [0, -1], [3, 0], [0, 3], [1, 1]]) {
    assert.deepEqual(
      moveRow(rows, from, to).map((row) => row.content),
      rows.map((row) => row.content),
      `from=${from} to=${to}`
    );
  }
});

test("clampIndex: 範囲外・未指定はすべて -1", () => {
  assert.equal(clampIndex(0, 3), 0);
  assert.equal(clampIndex(2, 3), 2);
  assert.equal(clampIndex(3, 3), -1);
  assert.equal(clampIndex(-1, 3), -1);
  assert.equal(clampIndex(0, 0), -1);
  assert.equal(clampIndex(null, 3), -1);
  assert.equal(clampIndex("1", 3), -1);
  assert.equal(clampIndex(1.5, 3), -1);
});

test("nextIndex: 未指定なら先頭、最終行では止まる", () => {
  assert.equal(nextIndex(-1, 3), 0);
  assert.equal(nextIndex(null, 3), 0);
  assert.equal(nextIndex(0, 3), 1);
  assert.equal(nextIndex(1, 3), 2);
  assert.equal(nextIndex(2, 3), 2);
  assert.equal(nextIndex(0, 0), -1);
});
