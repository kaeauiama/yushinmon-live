/**
 * 管理画面の認証（REQ-141 / REQ-142、D-008）。
 *
 * 共有スタッフアカウントのメールアドレスは config.json の staffEmail から読む。
 * スタッフが入力するのはパスワードだけ。ログイン状態は端末に保持するので、
 * 前日にログインしておけば当日は入力が要らない。
 *
 * HC-8: このルールは「Firebase の新規サインアップが無効である」ことを前提にしている。
 * サインアップが有効なままだと、公開された apiKey で誰でもアカウントを作れてしまい、
 * セキュリティルールの auth != null を満たされる。
 */

import { initFirebase } from "../../assets/js/firebase-app.js";

export async function createAuth(config) {
  const { app, version } = await initFirebase(config);
  const sdk = await import(`https://www.gstatic.com/firebasejs/${version}/firebase-auth.js`);

  const auth = sdk.getAuth(app);
  await sdk.setPersistence(auth, sdk.browserLocalPersistence);

  return {
    account: config.staffEmail,
    onChange(callback) {
      return sdk.onAuthStateChanged(auth, callback);
    },
    signIn(password) {
      return sdk.signInWithEmailAndPassword(auth, config.staffEmail, password);
    },
    signOut() {
      return sdk.signOut(auth);
    },
  };
}

/**
 * 失敗の理由を日本語で返す。
 * 沈黙の失敗や「失敗」だけの表示にしない（次の一手が分かるようにする）。
 */
export function describeAuthError(error) {
  const code = (error && error.code) || "";

  switch (code) {
    case "auth/invalid-credential":
    case "auth/wrong-password":
    case "auth/invalid-email":
    case "auth/user-not-found":
      return "パスワードが違います。大文字・小文字と余分な空白を確認してください。";
    case "auth/too-many-requests":
      return "入力の失敗が続いたため、一時的にロックされています。少し時間をおいてください。";
    case "auth/network-request-failed":
      return "ネットワークに接続できません。電波状況を確認してください。";
    case "auth/operation-not-allowed":
      return "メール／パスワードのログインが Firebase 側で無効になっています。管理者に連絡してください。";
    case "auth/user-disabled":
      return "このアカウントは無効化されています。管理者に連絡してください。";
    default:
      return `ログインできませんでした（${code || "原因不明"}）。管理者に連絡してください。`;
  }
}
