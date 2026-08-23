/**
 * 設定の読み込み（REQ-161 / REQ-162）。
 *
 * 団体固有の値はすべて config.json に置く。ソースコードには一切書かない。
 * 他団体はこのファイルを書き換えずに config.json だけを差し替える。
 */

const REQUIRED_FIREBASE_KEYS = ["apiKey", "authDomain", "databaseURL", "projectId"];

/**
 * config.json の場所。
 *
 * ページ相対（"./config.json"）にしてはいけない。視聴ページは "/" 、
 * 管理ページは "/admin/" から読み込まれるため、管理ページ側が
 * "/admin/config.json" を探して 404 になる。
 * このモジュールからの相対で解決すれば、どのページから呼ばれても同じ場所を指す。
 */
const CONFIG_URL = new URL("../../config.json", import.meta.url);

/** config.json を読み、最低限の形を検証して返す。 */
export async function loadConfig() {
  let response;
  try {
    response = await fetch(CONFIG_URL, { cache: "no-store" });
  } catch (cause) {
    throw new ConfigError("config.json を取得できませんでした", cause);
  }

  if (!response.ok) {
    throw new ConfigError(`config.json の取得に失敗しました (HTTP ${response.status})`);
  }

  let config;
  try {
    config = await response.json();
  } catch (cause) {
    throw new ConfigError("config.json の形式が不正です", cause);
  }

  const firebase = config && config.firebase;
  const missing = REQUIRED_FIREBASE_KEYS.filter((key) => !firebase || !firebase[key]);
  if (missing.length > 0) {
    throw new ConfigError(`config.json の firebase 設定が不足しています: ${missing.join(", ")}`);
  }

  return config;
}

export class ConfigError extends Error {
  constructor(message, cause) {
    super(message, cause === undefined ? undefined : { cause });
    this.name = "ConfigError";
  }
}
