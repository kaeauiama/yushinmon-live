/**
 * 「通信が不安定です」を出すかどうかの判定（REQ-128）。
 *
 * Firebase の `.info/connected` は、ページを開いた直後にまず false を返し、
 * WebSocket がつながってから true になる。これをそのまま表示に使うと、
 * 回線が正常でも開いた瞬間に「通信が不安定です」が出てしまう。
 *
 * そこで次の規則で判定する。
 *
 *   1. 一度もつながっていないうちの false は無視する。
 *      起動時に取得できない場合は、view.js の「最新の情報を取得できませんでした」
 *      （キャッシュ退避）と「配信情報を取得できませんでした」（退避表示）が受け持つ。
 *   2. つながったあとに切れても、切断が一定時間続いたときだけ警告する。
 *      モバイル回線の瞬断や基地局の切り替えで表示がちらつかないようにするため。
 *   3. つながったら即座に警告を消す。
 *
 * DOM に依存させないこと（tests/connection.test.js が Node で実行する）。
 */

/** 切断がこの時間続いたら警告を出す（ms） */
export const CONNECTION_WARNING_DELAY_MS = 5000;

export class ConnectionWatcher {
  /**
   * @param {{
   *   onWarningChange: (warning: boolean) => void,
   *   delayMs?: number,
   *   schedule?: (callback: () => void, ms: number) => unknown,
   *   cancel?: (handle: unknown) => void,
   * }} options
   *   schedule / cancel はテストで差し替えるためのもの。既定は setTimeout / clearTimeout。
   */
  constructor({
    onWarningChange,
    delayMs = CONNECTION_WARNING_DELAY_MS,
    // setTimeout をそのまま渡すと、ブラウザによっては this が外れて例外になるので包む
    schedule = (callback, ms) => setTimeout(callback, ms),
    cancel = (handle) => clearTimeout(handle),
  }) {
    this.onWarningChange = onWarningChange;
    this.delayMs = delayMs;
    this.schedule = schedule;
    this.cancel = cancel;

    this.hasConnected = false;
    this.warning = false;
    this.timer = null;
  }

  /** `.info/connected` の値を受け取る */
  update(connected) {
    if (connected) {
      this.hasConnected = true;
      this.#clearTimer();
      this.#setWarning(false);
      return;
    }

    // 規則 1: 一度もつながっていないうちの false は無視する
    if (!this.hasConnected) return;

    // 規則 2: 既に待機中、または既に警告中なら何もしない
    if (this.timer !== null || this.warning) return;

    this.timer = this.schedule(() => {
      this.timer = null;
      this.#setWarning(true);
    }, this.delayMs);
  }

  #clearTimer() {
    if (this.timer === null) return;
    this.cancel(this.timer);
    this.timer = null;
  }

  #setWarning(value) {
    if (this.warning === value) return;
    this.warning = value;
    this.onWarningChange(value);
  }
}
