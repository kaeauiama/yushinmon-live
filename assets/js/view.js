/**
 * 視聴ページの組み立て。
 *
 * M1 の範囲では最初のコート（courts[0]）だけを表示する。
 * 複数コートのタブ切替は M4。
 */

import { loadConfig } from "./config.js";
import { createStore } from "./store.js";
import { LivePlayer } from "./player.js";
import { parseVideoId, watchUrl } from "./youtube.js";
import { normalizeProgram, clampIndex } from "./program.js";
import { saveSnapshot, loadSnapshot, formatSavedAt } from "./cache.js";

/** 起動後この時間データが届かなければキャッシュ表示に切り替える（ms） */
const FIRST_DATA_TIMEOUT_MS = 6000;

const el = {
  siteTitle: document.getElementById("site-title"),
  eventTitle: document.getElementById("event-title"),
  staleness: document.getElementById("staleness-banner"),
  court: document.getElementById("court"),
  courtTabs: document.getElementById("court-tabs"),
  courtName: document.getElementById("court-name"),
  playerFrame: document.getElementById("player-frame"),
  playerMount: document.getElementById("player-mount"),
  placeholder: document.getElementById("placeholder"),
  resumeBanner: document.getElementById("resume-banner"),
  resumeButton: document.getElementById("resume-button"),
  headlineRow: document.getElementById("headline-row"),
  liveBadge: document.getElementById("live-badge"),
  headline: document.getElementById("headline"),
  eventNotice: document.getElementById("event-notice"),
  directLink: document.getElementById("direct-link"),
  program: document.getElementById("program"),
  programBody: document.getElementById("program-body"),
  fatal: document.getElementById("fatal"),
  fatalContact: document.getElementById("fatal-contact"),
  fatalOfficial: document.getElementById("fatal-official"),
  officialLinkRow: document.getElementById("official-link-row"),
};

const state = {
  receivedLiveData: false,
  connected: true,
  staleSavedAt: null,
  /** 直近に描画したイベント。タブを押したときの再描画に使う */
  lastEvent: null,
  /** 視聴者が選んでいるコート。null なら先頭 */
  selectedCourtKey: null,
};

const player = new LivePlayer(el.playerMount, {
  onAutoplayBlocked: () => show(el.resumeBanner),
  onPlaying: () => hide(el.resumeBanner),
});

el.resumeButton.addEventListener("click", () => {
  hide(el.resumeBanner);
  player.play();
});

start();

async function start() {
  let config;
  try {
    config = await loadConfig();
  } catch (error) {
    console.error(error);
    showFatal(null);
    return;
  }

  applyConfig(config);

  const timer = setTimeout(() => {
    if (!state.receivedLiveData) fallBackToCache();
  }, FIRST_DATA_TIMEOUT_MS);

  try {
    await createStore(config, {
      onEvent: (event) => {
        if (!event) {
          if (!state.receivedLiveData) fallBackToCache();
          return;
        }
        clearTimeout(timer);
        state.receivedLiveData = true;
        state.staleSavedAt = null;
        saveSnapshot(event);
        render(event);
        updateStalenessBanner();
      },
      onConnectionChange: (connected) => {
        state.connected = connected;
        updateStalenessBanner();
      },
      onForceReload: () => window.location.reload(),
    });
  } catch (error) {
    console.error(error);
    clearTimeout(timer);
    fallBackToCache();
  }
}

/** config.json 由来の表示（REQ-162） */
function applyConfig(config) {
  if (config.siteTitle) {
    el.siteTitle.textContent = config.siteTitle;
    document.title = config.siteTitle;
  }
  if (config.fallbackContact) {
    el.fatalContact.textContent = config.fallbackContact;
  }
  if (config.officialSiteUrl) {
    el.officialLinkRow.replaceChildren(officialLink(config.officialSiteUrl));
    el.fatalOfficial.replaceChildren(officialLink(config.officialSiteUrl));
  }
}

function officialLink(url) {
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.target = "_blank";
  anchor.rel = "noopener noreferrer";
  anchor.textContent = "公式サイト";
  return anchor;
}

/** RTDB から取れなかったときの退避（REQ-132 / REQ-133） */
function fallBackToCache() {
  const snapshot = loadSnapshot();
  if (!snapshot) {
    showFatal(null);
    return;
  }
  state.staleSavedAt = snapshot.savedAt;
  render(snapshot.event);
  updateStalenessBanner();
}

function showFatal() {
  hide(el.court);
  show(el.fatal);
}

// ---- 描画 ----

function render(event) {
  hide(el.fatal);
  show(el.court);

  state.lastEvent = event;
  el.eventTitle.textContent = event.title || "";

  const entries = courtEntries(event);
  if (entries.length === 0) {
    hide(el.courtTabs);
    renderPlaceholder("配信情報が設定されていません");
    hide(el.headlineRow);
    hide(el.directLink);
    hide(el.program);
    return;
  }

  // 選んでいたコートが消えていたら先頭に戻す
  let selected = entries.find(([key]) => key === state.selectedCourtKey);
  if (!selected) {
    selected = entries[0];
    state.selectedCourtKey = selected[0];
  }
  const court = selected[1];

  renderCourtTabs(entries);
  el.courtName.textContent = court.name || "";
  el.courtName.hidden = entries.length > 1; // タブに出るので重複させない

  setText(el.eventNotice, event.notice);
  renderProgram(court);

  const videoId = parseVideoId(court.videoId);
  const stateName = court.state || "before";

  if (stateName === "live" || stateName === "paused") {
    renderStreaming(court, videoId, stateName);
  } else if (stateName === "ended") {
    renderEnded(court);
  } else {
    renderBefore(court);
  }
}

function renderStreaming(court, videoId, stateName) {
  if (!videoId) {
    renderPlaceholder("配信の準備をしています");
    setHeadline(court.headline, stateName);
    hide(el.directLink);
    return;
  }

  hide(el.placeholder);
  show(el.playerFrame);
  // HC-6: iframe の src は触らない。差し替えは loadVideoById（LivePlayer 内）。
  player.setVideo(videoId).catch((error) => console.error(error));

  setHeadline(court.headline, stateName);

  const url = watchUrl(videoId);
  el.directLink.href = url;
  show(el.directLink);
}

function renderBefore(court) {
  player.destroy();
  renderPlaceholder(court.scheduledStartText || "配信開始までお待ちください");
  setHeadline(court.headline, "before");
  hide(el.directLink);
}

function renderEnded(court) {
  player.destroy();
  renderPlaceholder("配信は終了しました");
  setHeadline(court.headline, "ended");

  const archiveUrl = watchUrl(parseVideoId(court.archiveVideoId));
  if (archiveUrl) {
    el.directLink.href = archiveUrl;
    el.directLink.textContent = "アーカイブを YouTube で見る";
    show(el.directLink);
  } else {
    hide(el.directLink);
  }
}

/**
 * コート切替タブ（REQ-107）。
 *
 * 1 コートのときはタブを出さない。複数のときも同時再生はせず、
 * 選んだコートだけを描画する（帯域と発熱、そしてスマホの可読性のため）。
 * 切り替えてもプレーヤーは作り直さず loadVideoById で差し替わる（HC-6）。
 */
function renderCourtTabs(entries) {
  if (entries.length <= 1) {
    hide(el.courtTabs);
    el.courtTabs.replaceChildren();
    return;
  }

  el.courtTabs.replaceChildren(
    ...entries.map(([key, court]) => {
      const tab = document.createElement("button");
      tab.type = "button";
      tab.className = "court-tab";
      tab.role = "tab";
      tab.textContent = court.name || `コート ${Number(key) + 1}`;
      tab.setAttribute("aria-selected", key === state.selectedCourtKey ? "true" : "false");
      tab.addEventListener("click", () => {
        if (key === state.selectedCourtKey) return;
        state.selectedCourtKey = key;
        if (state.lastEvent) render(state.lastEvent);
      });
      return tab;
    })
  );

  show(el.courtTabs);
}

/**
 * プログラム表と「いまここ」（REQ-106）。
 *
 * 保護者が一番知りたいのは「うちの子の出番はいつか」なので、
 * 進行中の行が一目で分かるようにする。色だけに頼らず「いま」の目印も出す。
 */
function renderProgram(court) {
  const rows = normalizeProgram(court.program);
  if (rows.length === 0) {
    hide(el.program);
    el.programBody.replaceChildren();
    return;
  }

  const current = clampIndex(court.currentProgramIndex, rows.length);

  el.programBody.replaceChildren(
    ...rows.map((row, index) => {
      const tr = document.createElement("tr");
      if (index === current) tr.className = "is-current";

      const time = document.createElement("td");
      time.className = "program-col-time";
      time.textContent = row.time;

      const content = document.createElement("td");
      if (index === current) {
        const marker = document.createElement("span");
        marker.className = "program-now";
        marker.textContent = "いま";
        content.append(marker);
      }
      content.append(document.createTextNode(row.content));

      tr.append(time, content);
      return tr;
    })
  );

  show(el.program);
}

function renderPlaceholder(text) {
  player.destroy();
  hide(el.playerFrame);
  hide(el.resumeBanner);
  el.placeholder.textContent = text;
  show(el.placeholder);
}

function setHeadline(headline, stateName) {
  const text = (headline || "").trim();
  el.liveBadge.hidden = stateName !== "live";
  el.headline.textContent = text;
  el.headline.classList.toggle("is-paused", stateName === "paused");

  if (stateName === "paused" && text === "") {
    el.headline.textContent = "機材トラブルのため復旧作業中です";
  }
  el.headlineRow.hidden = el.headline.textContent === "" && stateName !== "live";
}

/** REQ-124 / REQ-132 のお知らせ。鮮度の警告を接続の警告より優先する。 */
function updateStalenessBanner() {
  if (state.staleSavedAt !== null) {
    el.staleness.textContent =
      `最新の情報を取得できませんでした。${formatSavedAt(state.staleSavedAt)} 時点の情報を表示しています。`;
    show(el.staleness);
    return;
  }
  if (!state.connected) {
    el.staleness.textContent = "通信が不安定です。表示が最新でない場合があります。";
    show(el.staleness);
    return;
  }
  hide(el.staleness);
}

// ---- 小道具 ----

/**
 * RTDB は配列にもオブジェクトにもなりうるので正規化する。
 * @returns {[string, object][]} [キー, コート] の組を数値順に並べたもの
 */
function courtEntries(event) {
  const courts = event && event.courts;
  if (!courts) return [];

  if (Array.isArray(courts)) {
    return courts
      .map((court, index) => [String(index), court])
      .filter(([, court]) => court);
  }

  return Object.keys(courts)
    .sort((a, b) => Number(a) - Number(b))
    .map((key) => [key, courts[key]])
    .filter(([, court]) => court);
}

function setText(element, text) {
  const value = (text || "").trim();
  element.textContent = value;
  element.hidden = value === "";
}

function show(element) {
  element.hidden = false;
}

function hide(element) {
  element.hidden = true;
}
