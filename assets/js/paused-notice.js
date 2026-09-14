/**
 * 中断中の帯（「ただいま配信を一時中断しています」）を出すかどうかの判定（REQ-129）。
 *
 * 帯は次の 2 つが両方そろったときだけ出す。
 *
 *   A. スタッフが管理画面で「中断中にする」を押している（RTDB の state が paused）
 *   B. 視聴者のプレーヤーで、実際に映像が流れていない
 *
 * B を条件に入れるのは、次の 2 つの勘違いを避けるため。
 *
 *   - 配信が復旧したのに、スタッフが「配信中にする」を押すのが遅れて、
 *     映像が流れているのに「中断中」と出続ける
 *   - 休憩中などで、中断中にしたまま映像は流し続けている
 *
 * 映像が流れていれば、帯は（スタッフの操作を待たずに）消える。
 * 中断の理由は決めつけない。理由を伝えたいときはテロップに書く。
 *
 * 再生状態は回線が不安定だと細かく揺れるので、帯の表示・非表示には
 * それぞれ短い猶予を置き、ちらつかないようにする。
 * ただし「中断中にする」「配信中にする」の操作そのものには即座に従う。
 *
 * DOM に依存させないこと（tests/paused-notice.test.js が Node で実行する）。
 */

/** 映像が止まってから帯を出すまでの猶予（ms） */
export const NOTICE_SHOW_DELAY_MS = 3000;

/** 映像が流れ始めてから帯を消すまでの猶予（ms） */
export const NOTICE_HIDE_DELAY_MS = 3000;

export class PausedNotice {
  /**
   * @param {{
   *   onChange: (visible: boolean) => void,
   *   showDelayMs?: number,
   *   hideDelayMs?: number,
   *   schedule?: (callback: () => void, ms: number) => unknown,
   *   cancel?: (handle: unknown) => void,
   * }} options
   */
  constructor({
    onChange,
    showDelayMs = NOTICE_SHOW_DELAY_MS,
    hideDelayMs = NOTICE_HIDE_DELAY_MS,
    schedule = (callback, ms) => setTimeout(callback, ms),
    cancel = (handle) => clearTimeout(handle),
  }) {
    this.onChange = onChange;
    this.showDelayMs = showDelayMs;
    this.hideDelayMs = hideDelayMs;
    this.schedule = schedule;
    this.cancel = cancel;

    this.paused = false;
    this.playing = false;
    this.visible = false;
    this.timer = null;
  }

  /**
   * スタッフの操作による状態（A）。描画のたびに呼ばれるので、同じ値なら何もしない。
   * @param {boolean} paused
   */
  setPaused(paused) {
    if (paused === this.paused) return;
    this.paused = paused;
    this.#clearTimer();

    // スタッフの操作には即座に従う。映像が流れていれば出さない
    this.#setVisible(paused && !this.playing);
  }

  /**
   * プレーヤーで実際に映像が流れているか（B）。
   * @param {boolean} playing
   */
  setPlaying(playing) {
    if (playing === this.playing) return;
    this.playing = playing;
    this.#clearTimer();

    if (!this.paused) return;

    const next = !playing;
    if (next === this.visible) return;

    this.timer = this.schedule(
      () => {
        this.timer = null;
        this.#setVisible(next);
      },
      next ? this.showDelayMs : this.hideDelayMs
    );
  }

  #clearTimer() {
    if (this.timer === null) return;
    this.cancel(this.timer);
    this.timer = null;
  }

  #setVisible(value) {
    if (value === this.visible) return;
    this.visible = value;
    this.onChange(value);
  }
}
