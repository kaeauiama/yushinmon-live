/**
 * YouTube IFrame Player API のラッパー（REQ-102 / REQ-122 / REQ-125 / REQ-127）。
 *
 * HC-6: iframe の src を書き換えて差し替えないこと。src を書き換えると
 * プレーヤーが作り直され、全画面表示と再生状態が壊れる。差し替えは必ず
 * loadVideoById で行う。
 *
 * D-011 の要点:
 *   同一プレーヤーで一度ユーザーが再生操作をしていれば、loadVideoById による
 *   差し替えは自動再生制限の対象外となり、音声つきで再生が継続する。
 *   このため初期状態でのミュート自動再生は不要。
 */

/** YT.PlayerState の値（API が読み込まれる前でも参照できるよう定数で持つ） */
export const PLAYER_STATE = {
  UNSTARTED: -1,
  ENDED: 0,
  PLAYING: 1,
  PAUSED: 2,
  BUFFERING: 3,
  CUED: 5,
};

/** 差し替え後、これだけ待っても再生が始まらなければ手動再生を促す（ms） */
const AUTOPLAY_CHECK_MS = 2500;

let apiReadyPromise = null;

/**
 * IFrame Player API の読み込み完了を待つ。
 * script タグ自体は index.html が読み込む（HC-6 のガードを単純に保つため、
 * JavaScript からは .src への代入を一切行わない）。
 */
export function whenApiReady() {
  if (apiReadyPromise) return apiReadyPromise;

  apiReadyPromise = new Promise((resolve) => {
    if (window.YT && typeof window.YT.Player === "function") {
      resolve(window.YT);
      return;
    }
    const previous = window.onYouTubeIframeAPIReady;
    window.onYouTubeIframeAPIReady = () => {
      if (typeof previous === "function") previous();
      resolve(window.YT);
    };
  });

  return apiReadyPromise;
}

export class LivePlayer {
  /**
   * @param {HTMLElement} container プレーヤーを差し込む要素
   * @param {{
   *   onAutoplayBlocked?: () => void,
   *   onPlaying?: () => void,
   *   onEnded?: () => void,
   *   onError?: (code: number) => void,
   * }} [handlers]
   */
  constructor(container, handlers = {}) {
    this.container = container;
    this.handlers = handlers;
    this.player = null;
    this.videoId = null;
    this.autoplayTimer = null;
  }

  /**
   * 動画を設定する。プレーヤーが既にあれば作り直さずに差し替える（REQ-122）。
   * @param {string} videoId
   */
  async setVideo(videoId) {
    if (!videoId || videoId === this.videoId) return;

    // API の読み込み待ちより前に記録する。await をまたいで二重に呼ばれると、
    // 二度目が「差し替え」と誤認されて loadVideoById が走り、
    // 未再生のプレーヤーで自動再生がブロックされて REQ-127 のバナーが誤表示される。
    this.videoId = videoId;

    const YT = await whenApiReady();
    const isSwap = this.player !== null;

    if (isSwap) {
      this.player.loadVideoById(videoId);
      this.#watchAutoplay();
      return;
    }

    const mount = document.createElement("div");
    this.container.replaceChildren(mount);

    this.player = new YT.Player(mount, {
      videoId,
      width: "100%",
      height: "100%",
      playerVars: {
        playsinline: 1,
        rel: 0,
        modestbranding: 1,
        origin: window.location.origin,
      },
      events: {
        onStateChange: (event) => this.#handleStateChange(event.data),
        onError: (event) => {
          if (this.handlers.onError) this.handlers.onError(event.data);
        },
      },
    });
  }

  /** 手動再生（REQ-127 のバナーから呼ぶ） */
  play() {
    if (this.player && typeof this.player.playVideo === "function") {
      this.player.playVideo();
    }
  }

  /** プレーヤーを破棄する。before / ended への遷移時のみ使う。 */
  destroy() {
    clearTimeout(this.autoplayTimer);
    this.autoplayTimer = null;
    if (this.player && typeof this.player.destroy === "function") {
      this.player.destroy();
    }
    this.player = null;
    this.videoId = null;
    this.container.replaceChildren();
  }

  #handleStateChange(state) {
    if (state === PLAYER_STATE.PLAYING || state === PLAYER_STATE.BUFFERING) {
      clearTimeout(this.autoplayTimer);
      this.autoplayTimer = null;
      if (this.handlers.onPlaying) this.handlers.onPlaying();
      return;
    }
    if (state === PLAYER_STATE.ENDED && this.handlers.onEnded) {
      this.handlers.onEnded();
    }
  }

  /**
   * 差し替え後に自動再生がブロックされていないか確かめる（REQ-127）。
   * 無言で止まったままにしない。
   */
  #watchAutoplay() {
    clearTimeout(this.autoplayTimer);
    this.autoplayTimer = setTimeout(() => {
      this.autoplayTimer = null;
      const state = this.player && typeof this.player.getPlayerState === "function"
        ? this.player.getPlayerState()
        : null;
      const playing = state === PLAYER_STATE.PLAYING || state === PLAYER_STATE.BUFFERING;
      if (!playing && this.handlers.onAutoplayBlocked) {
        this.handlers.onAutoplayBlocked();
      }
    }, AUTOPLAY_CHECK_MS);
  }
}
