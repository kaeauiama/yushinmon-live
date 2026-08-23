/**
 * Firebase Realtime Database の購読（REQ-123 / REQ-124 / REQ-126）。
 *
 * HC-4: このファイルは視聴ページからも読み込まれる。認証（firebase-auth）を
 * 絶対に import しないこと。視聴者は認証しない。
 *
 * 主経路は onValue による push。RTDB は自前で再接続するが、学校や職場のように
 * WebSocket を遮断するネットワークでは push が一切届かないことがある。
 * そのため .info/connected を監視し、切断が続く場合だけ REST でのポーリングに
 * フォールバックする。
 */

import { initFirebase } from "./firebase-app.js";

/** 切断がこの時間続いたらポーリングを開始する（ms） */
const OFFLINE_GRACE_MS = 20_000;

/** ポーリング間隔（ms）。docs/decisions.md の暫定値 15 秒 */
const POLL_INTERVAL_MS = 15_000;

/**
 * @param {object} config config.json の内容
 * @param {{
 *   onEvent: (event: object|null) => void,
 *   onConnectionChange: (connected: boolean) => void,
 *   onForceReload: () => void,
 * }} handlers
 */
export async function createStore(config, handlers) {
  const { db, database } = await initFirebase(config);
  const { ref, onValue } = database;
  const restBase = String(config.firebase.databaseURL).replace(/\/+$/, "");

  let currentEventId = null;
  let unsubscribeEvent = null;
  let offlineTimer = null;
  let pollTimer = null;
  let knownForceReloadAt = null;

  // ---- 接続状態の監視とポーリングのフォールバック ----

  onValue(ref(db, ".info/connected"), (snapshot) => {
    const connected = snapshot.val() === true;
    handlers.onConnectionChange(connected);

    if (connected) {
      clearTimeout(offlineTimer);
      offlineTimer = null;
      stopPolling();
      return;
    }
    if (offlineTimer === null && pollTimer === null) {
      offlineTimer = setTimeout(startPolling, OFFLINE_GRACE_MS);
    }
  });

  function startPolling() {
    offlineTimer = null;
    if (pollTimer !== null) return;
    pollOnce();
    pollTimer = setInterval(pollOnce, POLL_INTERVAL_MS);
  }

  function stopPolling() {
    if (pollTimer === null) return;
    clearInterval(pollTimer);
    pollTimer = null;
  }

  async function pollOnce() {
    try {
      const eventId = currentEventId || (await fetchJson("/_activeEvent_"));
      if (typeof eventId !== "string" || eventId === "") return;
      currentEventId = eventId;
      const event = await fetchJson(`/events/${encodeURIComponent(eventId)}`);
      if (event) handlers.onEvent(event);
    } catch {
      // ポーリングも届かない場合は、呼び出し側がキャッシュ表示に切り替える。
    }
  }

  async function fetchJson(path) {
    const response = await fetch(`${restBase}${path}.json`, { cache: "no-store" });
    if (!response.ok) throw new Error(`RTDB REST ${response.status}`);
    return response.json();
  }

  // ---- 強制リロード（REQ-126・最終手段） ----

  onValue(ref(db, "_control_/forceReloadAt"), (snapshot) => {
    const value = snapshot.val();
    if (typeof value !== "number") return;
    if (knownForceReloadAt === null) {
      knownForceReloadAt = value;
      return;
    }
    if (value > knownForceReloadAt) {
      knownForceReloadAt = value;
      handlers.onForceReload();
    }
  });

  // ---- アクティブイベントの購読 ----

  onValue(ref(db, "_activeEvent_"), (snapshot) => {
    const eventId = snapshot.val();
    if (typeof eventId !== "string" || eventId === "") {
      handlers.onEvent(null);
      return;
    }
    if (eventId === currentEventId) return;

    currentEventId = eventId;
    if (unsubscribeEvent) unsubscribeEvent();
    unsubscribeEvent = onValue(ref(db, `events/${eventId}`), (eventSnapshot) => {
      handlers.onEvent(eventSnapshot.val());
    });
  });
}
