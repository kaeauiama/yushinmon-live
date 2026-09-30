/**
 * 管理画面の組み立て（M2）。
 *
 * 設計方針は「当日、デジタルに疎いスタッフが迷わず操作できること」。
 *
 *  - 緊急時に押すボタン（状態切替・予備 URL への切替）は、押した時点で即反映する。
 *    保存ボタンを押し忘れて反映されない、という事故を構造的に無くす。
 *  - 文字の入力（テロップなど）は「保存」でまとめて反映する。打ちかけが漏れないように。
 *  - 上の 2 つは書き込むフィールドが重ならないので、片方が他方の未保存分を壊さない。
 *
 * プログラム表の編集は M3、コートのタブ切替は M4。
 */

import { loadConfig } from "../../assets/js/config.js";
import { initFirebase } from "../../assets/js/firebase-app.js";
import { LivePlayer } from "../../assets/js/player.js";
import { parseVideoId, watchUrl } from "../../assets/js/youtube.js";
import { normalizeProgram, moveRow, clampIndex, nextIndex } from "../../assets/js/program.js";
import { createAuth, describeAuthError } from "./auth.js";

/** プレビューを更新するまでの待ち時間（ms）。打鍵のたびに読み込まないため */
const PREVIEW_DEBOUNCE_MS = 500;

/** 入力欄と RTDB のフィールドの対応 */
const FIELDS = [
  { id: "court-name", key: "name", kind: "text", label: "コート名" },
  { id: "video-url", key: "videoId", kind: "video", label: "本番の配信 URL" },
  { id: "backup-url", key: "backupVideoId", kind: "video", label: "予備の配信 URL" },
  { id: "headline", key: "headline", kind: "text", label: "テロップ" },
  { id: "scheduled-text", key: "scheduledStartText", kind: "text", label: "配信前に出す文言" },
  { id: "archive-url", key: "archiveVideoId", kind: "video", label: "アーカイブの URL" },
];

const STATE_LABELS = {
  before: "配信前",
  live: "配信中",
  paused: "中断中",
  ended: "終了",
};

const el = (id) => document.getElementById(id);

const dom = {
  eventTitle: el("event-title"),
  login: el("login"),
  loginAccount: el("login-account"),
  password: el("password"),
  loginError: el("login-error"),
  loginButton: el("login-button"),
  console: el("console"),
  consoleError: el("console-error"),
  eventMissing: el("event-missing"),
  eventSelect: el("event-select"),
  eventApply: el("event-apply"),
  previewFrame: el("preview-frame"),
  previewMount: el("preview-mount"),
  previewEmpty: el("preview-empty"),
  swapButton: el("swap-button"),
  forceReloadButton: el("force-reload-button"),
  signoutButton: el("signout-button"),
  savebar: el("savebar"),
  saveButton: el("save-button"),
  dirtyBadge: el("dirty-badge"),
  savedAt: el("saved-at"),
  programRows: el("program-rows"),
  programEmpty: el("program-empty"),
  programAdd: el("program-add"),
  programNext: el("program-next"),
  programClear: el("program-clear"),
  programLocked: el("program-locked"),
  courtTabs: el("admin-court-tabs"),
  courtAdd: el("court-add"),
  courtRemove: el("court-remove"),
  courtLocked: el("court-locked"),
};

/** コートを追加したときの初期値 */
function blankCourt(index) {
  return {
    name: `第${index + 1}コート`,
    state: "before",
    headline: "",
    videoId: "",
    backupVideoId: "",
    archiveVideoId: "",
    scheduledStartText: "",
    currentProgramIndex: -1,
  };
}

const state = {
  config: null,
  db: null,
  database: null,
  eventId: null,
  courtKey: null,
  event: null,
  court: null,
  dirty: new Set(),
  previewTimer: null,
  previewId: null,
  /** プログラムの編集中の写し。保存するまで RTDB には書かない */
  programRows: [],
  programIndex: -1,
};

const preview = new LivePlayer(dom.previewMount, {});

start();

async function start() {
  try {
    state.config = await loadConfig();
  } catch (error) {
    console.error(error);
    showConsoleError("config.json を読み込めませんでした。");
    return;
  }

  const firebase = await initFirebase(state.config);
  state.db = firebase.db;
  state.database = firebase.database;

  dom.loginAccount.textContent = state.config.staffEmail || "(config.json 未設定)";

  const auth = await createAuth(state.config);
  wireLogin(auth);
  wireConsole();

  auth.onChange((user) => {
    if (user) {
      dom.login.hidden = true;
      dom.console.hidden = false;
      dom.savebar.hidden = false;
      subscribe();
    } else {
      dom.login.hidden = false;
      dom.console.hidden = true;
      dom.savebar.hidden = true;
    }
  });
}

// ---------------------------------------------------------------- ログイン

function wireLogin(auth) {
  const attempt = async () => {
    dom.loginError.hidden = true;
    dom.loginButton.disabled = true;
    try {
      await auth.signIn(dom.password.value);
      dom.password.value = "";
    } catch (error) {
      dom.loginError.textContent = describeAuthError(error);
      dom.loginError.hidden = false;
    } finally {
      dom.loginButton.disabled = false;
    }
  };

  dom.loginButton.addEventListener("click", attempt);
  dom.password.addEventListener("keydown", (event) => {
    if (event.key === "Enter") attempt();
  });

  dom.signoutButton.addEventListener("click", () => {
    if (state.dirty.size > 0 && !confirm("未保存の変更があります。破棄してログアウトしますか？")) return;
    state.dirty.clear();
    auth.signOut();
  });
}

// ---------------------------------------------------------------- 購読

function subscribe() {
  const { ref, onValue } = state.database;

  onValue(ref(state.db, "_activeEvent_"), (snapshot) => {
    const eventId = snapshot.val();
    if (typeof eventId !== "string" || eventId === "") {
      showEventMissing("配信中のイベントが設定されていません（_activeEvent_ が空です）。");
      return;
    }
    if (eventId === state.eventId) return;

    state.eventId = eventId;
    dom.eventMissing.hidden = true;

    onValue(ref(state.db, `events/${eventId}`), (eventSnapshot) => {
      applyEvent(eventSnapshot.val());
    });
  });

  onValue(ref(state.db, "events"), (snapshot) => {
    fillEventSelect(snapshot.val());
  });
}

function fillEventSelect(events) {
  const ids = events ? Object.keys(events) : [];
  dom.eventSelect.replaceChildren(
    ...ids.map((id) => {
      const option = document.createElement("option");
      option.value = id;
      const title = events[id] && events[id].title;
      option.textContent = title ? `${title}（${id}）` : id;
      return option;
    })
  );
  if (state.eventId) dom.eventSelect.value = state.eventId;
}

function applyEvent(event) {
  if (!event) {
    showEventMissing(`イベント "${state.eventId}" のデータがありません。`);
    return;
  }

  const entries = courtEntries(event);
  if (entries.length === 0) {
    showEventMissing(`イベント "${state.eventId}" にコートが登録されていません。`);
    return;
  }

  dom.eventMissing.hidden = true;
  state.event = event;

  // 編集中のコートが消えていたら先頭に戻す
  const selected = entries.find(([key]) => key === state.courtKey) || entries[0];
  state.courtKey = selected[0];
  state.court = selected[1];
  renderCourtTabs(entries);

  dom.eventTitle.textContent = event.title || "";
  if (state.eventId) dom.eventSelect.value = state.eventId;

  // 打ちかけの入力は上書きしない（他端末からの更新で消えないように）
  for (const field of FIELDS) {
    if (state.dirty.has(field.id)) continue;
    el(field.id).value = toDisplay(field, state.court);
    refreshFieldStatus(field);
  }

  if (!state.dirty.has("program")) {
    state.programRows = normalizeProgram(state.court.program);
    state.programIndex = clampIndex(state.court.currentProgramIndex, state.programRows.length);
    renderProgramEditor();
  }

  refreshStateButtons(state.court.state);
  refreshSavedAt(event.updatedAt);
  schedulePreview();
}

/** @returns {[string, object][]} [キー, コート] の組を数値順に並べたもの */
function courtEntries(event) {
  const courts = event && event.courts;
  if (!courts) return [];

  if (Array.isArray(courts)) {
    return courts.map((court, index) => [String(index), court]).filter(([, court]) => court);
  }
  return Object.keys(courts)
    .sort((a, b) => Number(a) - Number(b))
    .map((key) => [key, courts[key]])
    .filter(([, court]) => court);
}

// ---------------------------------------------------------------- コート

/**
 * コートの追加・削除は `courts` を丸ごと書き換えるので、
 * 未保存のテキスト編集があると巻き添えで消えてしまう。
 * そのため未保存の変更があるあいだは操作を止めて、先に保存するよう促す。
 * プログラムの「いま」をロックしているのと同じ考え方（D-020）。
 */
function renderCourtTabs(entries) {
  dom.courtTabs.replaceChildren(
    ...entries.map(([key, court]) => {
      const tab = document.createElement("button");
      tab.type = "button";
      tab.className = "court-tab";
      tab.textContent = court.name || `コート ${Number(key) + 1}`;
      tab.setAttribute("aria-selected", key === state.courtKey ? "true" : "false");
      tab.addEventListener("click", () => selectCourt(key));
      return tab;
    })
  );
  dom.courtTabs.hidden = entries.length <= 1;
  dom.courtRemove.disabled = entries.length <= 1;
  refreshCourtLock();
}

function selectCourt(key) {
  if (key === state.courtKey) return;
  if (state.dirty.size > 0 && !confirm("未保存の変更があります。破棄して別のコートに切り替えますか？")) {
    return;
  }
  state.dirty.clear();
  refreshDirty();
  state.courtKey = key;
  state.previewId = null;
  if (state.event) applyEvent(state.event);
}

function refreshCourtLock() {
  const locked = state.dirty.size > 0;
  dom.courtAdd.disabled = locked;
  if (!dom.courtRemove.disabled) dom.courtRemove.disabled = locked;
  dom.courtLocked.textContent = locked
    ? "未保存の変更があります。コートを追加・削除する前に保存してください。"
    : "";
  dom.courtLocked.hidden = !locked;
}

async function addCourt() {
  if (!ready() || state.dirty.size > 0) return;

  const entries = courtEntries(state.event);
  const courts = entries.map(([, court]) => court);
  courts.push(blankCourt(courts.length));

  // 書き込みの await より先に onValue が発火するので、選択は書き込み前に決めておく。
  // 後から代入すると、再描画が済んだあとに切り替わって画面に反映されない。
  state.courtKey = String(courts.length - 1);
  state.previewId = null;

  try {
    await writeUpdates({ [`events/${state.eventId}/courts`]: courts });
    toast("コートを追加しました");
  } catch (error) {
    reportWriteError(error);
  }
}

async function removeCourt() {
  if (!ready() || state.dirty.size > 0) return;

  const entries = courtEntries(state.event);
  if (entries.length <= 1) {
    showConsoleError("コートは 1 つ以上必要です。");
    return;
  }

  const name = state.court.name || "このコート";
  if (!confirm(`「${name}」を削除します。配信 URL もプログラムも消えます。よろしいですか？`)) {
    return;
  }

  const courts = entries.filter(([key]) => key !== state.courtKey).map(([, court]) => court);

  // 追加と同じ理由で、選択の切り替えは書き込み前に済ませておく
  state.courtKey = "0";
  state.previewId = null;

  try {
    await writeUpdates({ [`events/${state.eventId}/courts`]: courts });
    toast(`「${name}」を削除しました`);
  } catch (error) {
    reportWriteError(error);
  }
}

// ---------------------------------------------------------------- 操作

function wireConsole() {
  for (const field of FIELDS) {
    el(field.id).addEventListener("input", () => {
      state.dirty.add(field.id);
      refreshDirty();
      refreshFieldStatus(field);
      if (field.id === "video-url") schedulePreview();
    });
  }

  for (const button of document.querySelectorAll(".btn-state")) {
    button.addEventListener("click", () => changeState(button.dataset.state));
  }

  dom.programAdd.addEventListener("click", addProgramRow);
  dom.programNext.addEventListener("click", advanceProgram);
  dom.programClear.addEventListener("click", () => setProgramIndex(-1));
  dom.courtAdd.addEventListener("click", addCourt);
  dom.courtRemove.addEventListener("click", removeCourt);

  dom.saveButton.addEventListener("click", save);
  dom.swapButton.addEventListener("click", swapBackup);
  dom.eventApply.addEventListener("click", applyActiveEvent);
  dom.forceReloadButton.addEventListener("click", forceReload);

  window.addEventListener("beforeunload", (event) => {
    if (state.dirty.size === 0) return;
    event.preventDefault();
    event.returnValue = "";
  });
}

async function changeState(next) {
  if (!ready()) return;
  try {
    await writeUpdates({ [`${courtPath()}/state`]: next });
    toast(`「${STATE_LABELS[next]}」にしました`);
  } catch (error) {
    reportWriteError(error);
  }
}

async function swapBackup() {
  if (!ready()) return;

  const conflicting = state.dirty.has("video-url") || state.dirty.has("backup-url");
  if (conflicting && !confirm("URL 欄に未保存の変更があります。破棄して入れ替えますか？")) return;

  const main = state.court.videoId || "";
  const backup = state.court.backupVideoId || "";
  if (main === "" && backup === "") {
    showConsoleError("本番・予備のどちらにも URL が入っていません。");
    return;
  }
  if (!confirm("本番と予備の配信 URL を入れ替えます。よろしいですか？")) return;

  state.dirty.delete("video-url");
  state.dirty.delete("backup-url");
  refreshDirty();

  try {
    await writeUpdates({
      [`${courtPath()}/videoId`]: backup,
      [`${courtPath()}/backupVideoId`]: main,
    });
    toast("予備 URL に切り替えました");
  } catch (error) {
    reportWriteError(error);
  }
}

// ---------------------------------------------------------------- プログラム

/**
 * 行の中身の編集は「保存」でまとめて反映する。
 * 一方「いま」の位置は当日いちばん頻繁に動かすので、押した時点で即反映する。
 *
 * ただし行を編集中に「いま」を動かすと、保存前の並びと保存済みの並びが食い違って
 * 別の種目を指してしまう。そのため、プログラムに未保存の変更があるあいだは
 * 「いま」の操作を止めて、先に保存するよう促す。
 */

function renderProgramEditor() {
  dom.programEmpty.hidden = state.programRows.length > 0;
  dom.programRows.replaceChildren(
    ...state.programRows.map((row, index) => buildProgramRow(row, index))
  );
  refreshProgramLock();
}

function buildProgramRow(row, index) {
  const container = document.createElement("div");
  container.className = index === state.programIndex ? "program-row is-current" : "program-row";

  const fields = document.createElement("div");
  fields.className = "program-row-fields";

  const time = document.createElement("input");
  time.type = "text";
  time.value = row.time;
  time.maxLength = 20;
  time.placeholder = "10:30";
  time.setAttribute("aria-label", `${index + 1} 行目の時刻`);
  time.addEventListener("input", () => {
    row.time = time.value;
    markProgramDirty();
  });

  const content = document.createElement("input");
  content.type = "text";
  content.value = row.content;
  content.maxLength = 100;
  content.placeholder = "種目名（選手名は入れない）";
  content.setAttribute("aria-label", `${index + 1} 行目の内容`);
  content.addEventListener("input", () => {
    row.content = content.value;
    markProgramDirty();
  });

  fields.append(time, content);

  const actions = document.createElement("div");
  actions.className = "program-row-actions";
  actions.append(
    programButton("act-here", index === state.programIndex ? "いま ここ" : "ここにする", () =>
      setProgramIndex(index)
    ),
    programButton("act-up", "↑", () => reorderProgram(index, index - 1), index === 0),
    programButton(
      "act-down",
      "↓",
      () => reorderProgram(index, index + 1),
      index === state.programRows.length - 1
    ),
    programButton("act-remove", "削除", () => removeProgramRow(index))
  );

  container.append(fields, actions);
  return container;
}

function programButton(className, label, onClick, disabled = false) {
  const button = document.createElement("button");
  button.type = "button";
  button.className = className;
  button.textContent = label;
  button.disabled = disabled;
  button.addEventListener("click", onClick);
  return button;
}

function markProgramDirty() {
  state.dirty.add("program");
  refreshDirty();
  refreshProgramLock();
}

function refreshProgramLock() {
  const locked = state.dirty.has("program");
  dom.programNext.disabled = locked;
  dom.programClear.disabled = locked;
  for (const button of dom.programRows.querySelectorAll(".act-here")) {
    button.disabled = locked;
  }
  dom.programLocked.textContent = locked
    ? "プログラムに未保存の変更があります。「いま」を動かす前に保存してください。"
    : "";
  dom.programLocked.hidden = !locked;
}

function addProgramRow() {
  state.programRows.push({ time: "", content: "" });
  markProgramDirty();
  renderProgramEditor();
  const inputs = dom.programRows.querySelectorAll(".program-row-fields input");
  if (inputs.length > 0) inputs[inputs.length - 2].focus();
}

function removeProgramRow(index) {
  const row = state.programRows[index];
  if (!row) return;
  const filled = row.time.trim() !== "" || row.content.trim() !== "";
  if (filled && !confirm(`「${row.content || row.time}」の行を削除します。よろしいですか？`)) return;

  const current = state.programIndex >= 0 ? state.programRows[state.programIndex] : null;
  state.programRows.splice(index, 1);
  state.programIndex = current && current !== row ? state.programRows.indexOf(current) : -1;

  markProgramDirty();
  renderProgramEditor();
}

function reorderProgram(from, to) {
  // 「いま」が指している行そのものを覚えておき、移動後に追従させる
  const current = state.programIndex >= 0 ? state.programRows[state.programIndex] : null;
  state.programRows = moveRow(state.programRows, from, to);
  state.programIndex = current ? state.programRows.indexOf(current) : -1;

  markProgramDirty();
  renderProgramEditor();
}

async function setProgramIndex(index) {
  if (!ready() || state.dirty.has("program")) return;
  const next = clampIndex(index, state.programRows.length);
  try {
    await writeUpdates({ [`${courtPath()}/currentProgramIndex`]: next });
    toast(next >= 0 ? `「${state.programRows[next].content || "この行"}」を「いま」にしました` : "「いま」を解除しました");
  } catch (error) {
    reportWriteError(error);
  }
}

async function advanceProgram() {
  if (!ready() || state.dirty.has("program")) return;
  if (state.programRows.length === 0) {
    showConsoleError("プログラムが 1 行もありません。");
    return;
  }
  await setProgramIndex(nextIndex(state.programIndex, state.programRows.length));
}

/**
 * 保存する形に整える。両方とも空の行は取り除き、「いま」の位置を追従させる。
 * @returns {{rows: {time: string, content: string}[], index: number}}
 */
function compactProgram() {
  const current = state.programIndex >= 0 ? state.programRows[state.programIndex] : null;

  const kept = state.programRows.filter(
    (row) => row.time.trim() !== "" || row.content.trim() !== ""
  );
  const rows = kept.map((row) => ({ time: row.time.trim(), content: row.content.trim() }));
  const index = current ? kept.indexOf(current) : -1;

  return { rows, index: index < 0 ? -1 : index };
}

// ---------------------------------------------------------------- 保存

async function save() {
  if (!ready()) return;

  const updates = {};
  for (const field of FIELDS) {
    const raw = el(field.id).value;
    if (field.kind === "video") {
      const trimmed = raw.trim();
      if (trimmed === "") {
        updates[`${courtPath()}/${field.key}`] = "";
        continue;
      }
      const videoId = parseVideoId(trimmed);
      if (!videoId) {
        // 沈黙して落とさず、どの欄が駄目なのかを出す
        showConsoleError(`「${field.label}」から動画 ID を取り出せませんでした。保存していません。`);
        el(field.id).focus();
        return;
      }
      updates[`${courtPath()}/${field.key}`] = videoId;
    } else {
      updates[`${courtPath()}/${field.key}`] = raw.trim();
    }
  }

  const program = compactProgram();
  updates[`${courtPath()}/program`] = program.rows.length > 0 ? program.rows : null;
  updates[`${courtPath()}/currentProgramIndex`] = program.index;

  dom.saveButton.disabled = true;
  try {
    await writeUpdates(updates);
    state.dirty.clear();
    // 空行を落とした結果を画面にも反映させる
    state.programRows = program.rows.map((row) => ({ ...row }));
    state.programIndex = program.index;
    renderProgramEditor();
    refreshDirty();
    dom.consoleError.hidden = true;
    toast("保存しました");
  } catch (error) {
    reportWriteError(error);
  } finally {
    dom.saveButton.disabled = false;
  }
}

async function applyActiveEvent() {
  const next = dom.eventSelect.value;
  if (!next) return;
  if (next === state.eventId) {
    toast("すでにこのイベントが配信中です");
    return;
  }
  if (!confirm(`視聴ページの表示を「${next}」に切り替えます。よろしいですか？`)) return;

  const { ref, set } = state.database;
  try {
    await set(ref(state.db, "_activeEvent_"), next);
    toast("配信中のイベントを切り替えました");
  } catch (error) {
    reportWriteError(error);
  }
}

async function forceReload() {
  const message =
    "全視聴者の画面を再読み込みします。全画面表示が解除されます。\n" +
    "自動で切り替わらないという連絡が複数から来たときだけ使ってください。\n\n実行しますか？";
  if (!confirm(message)) return;

  const { ref, set, serverTimestamp } = state.database;
  try {
    await set(ref(state.db, "_control_/forceReloadAt"), serverTimestamp());
    toast("再読み込みを指示しました");
  } catch (error) {
    reportWriteError(error);
  }
}

// ---------------------------------------------------------------- 書き込み

function courtPath() {
  return `events/${state.eventId}/courts/${state.courtKey}`;
}

async function writeUpdates(updates) {
  const { ref, update, serverTimestamp } = state.database;
  const payload = Object.assign({}, updates);
  payload[`events/${state.eventId}/updatedAt`] = serverTimestamp();
  await update(ref(state.db), payload);
}

function ready() {
  if (state.eventId && state.courtKey !== null && state.court) return true;
  showConsoleError("イベントを読み込めていません。画面を再読み込みしてください。");
  return false;
}

function reportWriteError(error) {
  console.error(error);
  const denied = String((error && error.message) || "").toLowerCase().includes("permission");
  showConsoleError(
    denied
      ? "書き込みが拒否されました。セキュリティルールと、ログインしているアカウントを確認してください。"
      : "保存できませんでした。電波状況を確認して、もう一度お試しください。"
  );
}

// ---------------------------------------------------------------- 表示更新

function toDisplay(field, court) {
  const value = court[field.key];
  if (field.kind === "video") return watchUrl(value) || "";
  return value || "";
}

/** 貼り付けた URL が使えるかをその場で出す（無言で落とさない） */
function refreshFieldStatus(field) {
  const status = el(`${field.id}-status`);
  if (!status) return;

  const raw = el(field.id).value.trim();
  if (raw === "") {
    status.textContent = "";
    status.className = "field-status";
    return;
  }

  const videoId = parseVideoId(raw);
  if (videoId) {
    status.textContent = `OK（動画 ID: ${videoId}）`;
    status.className = "field-status is-ok";
  } else {
    status.textContent = "この URL からは動画 ID を取り出せません。YouTube の URL を貼り付けてください。";
    status.className = "field-status is-ng";
  }
}

function refreshStateButtons(current) {
  for (const button of document.querySelectorAll(".btn-state")) {
    button.classList.toggle("is-current", button.dataset.state === (current || "before"));
  }
}

function refreshDirty() {
  dom.dirtyBadge.hidden = state.dirty.size === 0;
  refreshCourtLock();
}

function refreshSavedAt(updatedAt) {
  if (typeof updatedAt !== "number") {
    dom.savedAt.textContent = "";
    return;
  }
  const date = new Date(updatedAt);
  const hh = String(date.getHours()).padStart(2, "0");
  const mm = String(date.getMinutes()).padStart(2, "0");
  dom.savedAt.textContent = `最終更新 ${hh}:${mm}`;
}

/** REQ-144: 貼り間違いを目で確かめられるようにする */
function schedulePreview() {
  clearTimeout(state.previewTimer);
  state.previewTimer = setTimeout(() => {
    const videoId = parseVideoId(el("video-url").value.trim());
    if (!videoId) {
      state.previewId = null;
      preview.destroy();
      dom.previewFrame.hidden = true;
      dom.previewEmpty.hidden = false;
      return;
    }
    if (videoId === state.previewId) return;
    state.previewId = videoId;
    dom.previewEmpty.hidden = true;
    dom.previewFrame.hidden = false;
    preview.setVideo(videoId).catch((error) => console.error(error));
  }, PREVIEW_DEBOUNCE_MS);
}

function showEventMissing(message) {
  dom.eventMissing.textContent =
    `${message}\nFirebase Console でデータを作成してください（docs/data-model.md 参照）。`;
  dom.eventMissing.hidden = false;
}

function showConsoleError(message) {
  dom.consoleError.textContent = message;
  dom.consoleError.hidden = false;
}

let toastTimer = null;
function toast(message) {
  let node = document.querySelector(".toast");
  if (!node) {
    node = document.createElement("div");
    node.className = "toast";
    document.body.appendChild(node);
  }
  node.textContent = message;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => node.remove(), 2600);
}
