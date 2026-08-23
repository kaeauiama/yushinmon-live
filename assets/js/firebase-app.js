/**
 * Firebase SDK の読み込みと初期化を 1 箇所にまとめる。
 *
 * 視聴ページと管理ページのどちらからも使う。initializeApp を二度呼ぶと
 * 例外になるため、ここで memo 化して共有する。
 *
 * HC-4: このファイルは視聴ページからも読み込まれる。認証モジュールを
 * ここで import してはいけない。認証が要る側（admin/）が個別に読み込む。
 */

const DEFAULT_SDK_VERSION = "10.12.2";

let cached = null;

/**
 * @param {object} config config.json の内容
 * @returns {Promise<{app: object, version: string, db: object, database: object}>}
 */
export async function initFirebase(config) {
  if (cached) return cached;

  const version = config.firebaseSdkVersion || DEFAULT_SDK_VERSION;

  const [appModule, databaseModule] = await Promise.all([
    import(`https://www.gstatic.com/firebasejs/${version}/firebase-app.js`),
    import(`https://www.gstatic.com/firebasejs/${version}/firebase-database.js`),
  ]);

  const app = appModule.initializeApp(config.firebase);

  cached = {
    app,
    version,
    db: databaseModule.getDatabase(app),
    database: databaseModule,
  };
  return cached;
}
