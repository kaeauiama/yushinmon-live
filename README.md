# yushinmon-live

空手の大会をライブ配信するための **中継ページ**。配信そのものは YouTube Live で行い、
このページは固定 URL から現在の配信を埋め込んで、テロップやプログラムを併記する。

配信 URL は毎回変わるが、**このページの URL は変わらない**。
機材トラブルで配信を取り直しても、視聴者は同じ URL のまま見続けられる。
それがこのページの存在理由である。

## 構成

| パス | 役割 |
|---|---|
| `index.html` | 視聴ページ |
| `admin/` | 管理ページ |
| `assets/js/` | 実装。団体固有の値は含まない |
| `config.json` | **団体固有の設定はここだけ** |
| `docs/` | 要件・データモデル・Decision Log・運用マニュアル |
| `docs/checklist.md` | **印刷して当日持ち込むチェックリスト** |
| `tools/serve.js` | ローカル確認用の静的サーバー |
| `tools/check-rules.js` | Firebase 側の設定が正しいかの確認 |
| `tests/` | 制約の回帰テストと純粋関数のテスト |

ビルド工程は無い。リポジトリの内容がそのまま公開物になる。

## ローカルで動かす

ES Modules と `fetch("./config.json")` を使うため `file://` では動かない。

```bash
node tools/serve.js
```

http://localhost:8123 を開く。

## テスト

```bash
node --test
```

`tests/constraints.test.js` は `docs/requirements.md` の Hard Constraints を
機械的に検査する。文章だけの制約は溶けるため、コードで弾く。

Firebase 側の設定（セキュリティルールと新規サインアップの無効化）は、
実際のプロジェクトに対して確認する。**ルールを変更したら必ず実行すること。**

```bash
node tools/check-rules.js
```

## GitHub Pages へのデプロイ

このリポジトリは **public** で運用する（GitHub Free では Pages の公開に public が必要）。
秘密情報を持たない設計なので、公開して問題ない（`docs/requirements.md` HC-1 / 2.5）。

1. GitHub でリポジトリを作成する（README・.gitignore・LICENSE は**追加しない**）
2. リモートを登録して push する

```bash
git remote add origin https://github.com/kaeauiama/yushinmon-live.git
git push -u origin main
```

3. リポジトリの Settings → Pages で、Source を **Deploy from a branch**、
   Branch を **main / (root)** にする
4. 数分後に `https://kaeauiama.github.io/yushinmon-live/` が開くことを確認する
5. `https://kaeauiama.github.io/yushinmon-live/admin/` でログインできることを確認する

`.nojekyll` を置いてあるので Jekyll の処理は走らない。ビルド工程も無いので、
**push した内容がそのまま公開物になる**。

### 公開後に必ず確認すること

```bash
node tools/check-rules.js
```

**旧版のソース `sample/` は `.gitignore` で除外している。**
管理者の個人メールアドレスを文字列分割で埋め込んだコードを含むため
（難読化は保護ではない）。手元にだけ置くこと。

## 他団体で使う場合

1. このリポジトリをフォークする
2. 自分の Firebase プロジェクトを作り、`docs/operations.md` の
   「1-A. Firebase 側の初期設定」を実施する
   （**新規サインアップの無効化を必ず行うこと**。これが唯一の防御である）
3. `config.sample.json` をコピーして `config.json` を作り、値を書き換える
4. GitHub Pages を有効にする

**書き換えるのは `config.json` だけ**である。ソースコードに団体固有の値は入っていない。

## 前提と限界

- 中継ページの URL は誰でも開ける。**検索避けはしているが、保護ではない。**
  配信そのものの制限は YouTube の限定公開設定で行う
- Firebase Realtime Database の**読み取りは全世界に公開される**。
  選手名などの個人情報を入れてはいけない
- 配信映像への加工（得点表示・選手名テロップなど）はこのページでは行わない。
  配信元（OBS・ハードウェアスイッチャー・配信アプリ）の責務

詳細は [docs/requirements.md](docs/requirements.md) を参照。

## 旧版について

`sample/` に 2021 年に作った旧版（Vue 2 + Vuetify + Firebase Hosting）が入っている。
**参考資料であり仕様ではない。** 現在の正典は `docs/` 配下。
