# データモデル（Firebase Realtime Database）

最終更新: 2026-08-23

旧版（`sample/`）の構造を踏襲しつつ、以下を変更している。

- `liveUrl`（URL 文字列）→ `videoId`（動画 ID のみ）。管理画面で URL から自動抽出する
- `lives` → `courts`（実態に合わせた命名）
- `venueNum` を廃止し、配列インデックスをそのまま識別子にする
- 予備 URL、更新メタ情報、強制リロード用のフィールドを追加

---

## ツリー構造

```
/
├── _activeEvent_ : "2026-autumn"
│
├── _control_
│   └── forceReloadAt : 1756000000000     // 全視聴者の強制リロード用（REQ-126）
│
└── events
    └── 2026-autumn
        ├── title        : "第○回 勇心門空手道大会"
        ├── date         : "2026-11-03"
        ├── notice       : ""              // イベント全体のお知らせ（任意・空なら非表示）
        ├── updatedAt    : 1756000000000   // サーバータイムスタンプ
        └── courts
            ├── 0
            │   ├── name                 : "第1コート"
            │   ├── state                : "live"
            │   ├── headline             : "小学生の部 形競技を配信中です"
            │   ├── videoId              : "dQw4w9WgXcQ"   // 本番
            │   ├── backupVideoId        : ""              // 予備（事前に予約配信を作って控えておく）
            │   ├── archiveVideoId       : ""              // 終了後のアーカイブ（任意）
            │   ├── scheduledStartText   : "11月3日 9:30 配信開始予定"
            │   ├── currentProgramIndex  : 2               // 「いまここ」。-1 なら未指定
            │   └── program
            │       ├── 0 : { time: "09:30", content: "開会式" }
            │       ├── 1 : { time: "10:00", content: "小学1・2年 形" }
            │       └── 2 : { time: "10:40", content: "小学3・4年 形" }
            └── 1
                └── ...
```

## フィールド定義

### `_activeEvent_` : string

いま視聴ページが表示すべきイベントの ID。視聴ページは起動時にこれを読み、
対応する `events/{id}` を購読する。**この値も購読対象**とし、イベントを切り替えたら
視聴者側も追従する。

### `_control_/forceReloadAt` : number

管理者が「全員の画面を再読み込み」を押したときのサーバータイムスタンプ。
視聴ページは起動時の値を記憶し、値が増加したら `location.reload()` する。
**通常運用では使わない最終手段**（REQ-126）。

### `events/{eventId}`

| フィールド | 型 | 説明 |
|---|---|---|
| `title` | string | ヘッダーに出す大会名 |
| `date` | string | `YYYY-MM-DD` |
| `notice` | string | 全コート共通のお知らせ。空文字なら非表示 |
| `updatedAt` | number | サーバータイムスタンプ。視聴ページの「最終更新 hh:mm」表示に使う |

### `events/{eventId}/courts/{index}`

| フィールド | 型 | 説明 |
|---|---|---|
| `name` | string | タブに出すコート名 |
| `state` | string | `before` / `live` / `paused` / `ended` のいずれか |
| `headline` | string | テロップ。プレーヤーの外側に 1 行で表示 |
| `videoId` | string | 現在配信中の YouTube 動画 ID（11 文字）。空文字なら未設定 |
| `backupVideoId` | string | 予備配信の動画 ID。「予備に切替」で `videoId` と入れ替える |
| `archiveVideoId` | string | 終了後に案内するアーカイブの動画 ID（任意） |
| `scheduledStartText` | string | `before` 状態で表示する開始予定の文言 |
| `currentProgramIndex` | number | ハイライトする `program` の添字。`-1` で「いま」を表示しない（管理画面の「『いま』を消す」）。なお `state` が `before` / `ended` のときは、この値によらず表示しない（REQ-106） |
| `program` | list | 下表。`null`（キー自体が無い）ならプログラム表を丸ごと非表示 |

### `program` の各要素

| フィールド | 型 | 説明 |
|---|---|---|
| `time` | string | `"10:00"` など。自由文字列（`"10:00頃"` も許容） |
| `content` | string | 種目名など |

順序は配列の添字で表す。旧版は `id` フィールドで並び順を管理していたが、
入れ替えロジックが複雑になっていたため廃止し、配列の並びをそのまま正とする。

---

## `state` の意味と視聴ページの表示

| state | プレーヤー | 表示内容 |
|---|---|---|
| `before` | 出さない | `scheduledStartText` を大きく表示。「開始までお待ちください」 |
| `live` | 出す | 通常表示。テロップに「LIVE」バッジ |
| `paused` | **出したまま** | プレーヤーのすぐ上に、落ち着いた見た目の帯「ただいま配信を一時中断しています」を出す。**ただし実際に映像が流れている間は出さない**（REQ-129）。理由は決めつけず、テロップに任せる。プレーヤーは残す（復帰したら自動で映るため） |
| `ended` | 出さない | 「配信は終了しました」。`archiveVideoId` があればリンクを出す |

`paused` でプレーヤーを消さないのは、配信が同じ URL のまま復帰した場合に
視聴者の操作なしで映像が戻るようにするため。

---

## セキュリティルール

```json
{
  "rules": {
    ".read": false,
    ".write": false,

    "_activeEvent_": {
      ".read": true,
      ".write": "auth !== null",
      ".validate": "newData.isString() && newData.val().length <= 64"
    },

    "_control_": {
      ".read": true,
      ".write": "auth !== null",
      "forceReloadAt": { ".validate": "newData.isNumber()" }
    },

    "events": {
      ".read": "auth !== null",
      ".write": "auth !== null",
      "$eventId": {
        ".read": "root.child('_activeEvent_').val() === $eventId",
        "title":  { ".validate": "newData.isString() && newData.val().length <= 100" },
        "date":   { ".validate": "newData.isString() && newData.val().matches(/^\\d{4}-\\d{2}-\\d{2}$/)" },
        "notice": { ".validate": "newData.isString() && newData.val().length <= 300" },
        "courts": {
          "$index": {
            "name": { ".validate": "newData.isString() && newData.val().length <= 40" },
            "state": {
              ".validate": "newData.isString() && newData.val().matches(/^(before|live|paused|ended)$/)"
            },
            "videoId": {
              ".validate": "newData.isString() && (newData.val() === '' || newData.val().matches(/^[A-Za-z0-9_-]{11}$/))"
            },
            "backupVideoId": {
              ".validate": "newData.isString() && (newData.val() === '' || newData.val().matches(/^[A-Za-z0-9_-]{11}$/))"
            },
            "archiveVideoId": {
              ".validate": "newData.isString() && (newData.val() === '' || newData.val().matches(/^[A-Za-z0-9_-]{11}$/))"
            },
            "headline": { ".validate": "newData.isString() && newData.val().length <= 200" },
            "scheduledStartText": { ".validate": "newData.isString() && newData.val().length <= 100" },
            "currentProgramIndex": { ".validate": "newData.isNumber()" },
            "program": {
              "$row": {
                "time":    { ".validate": "newData.isString() && newData.val().length <= 20" },
                "content": { ".validate": "newData.isString() && newData.val().length <= 100" }
              }
            }
          }
        }
      }
    }
  }
}
```

### 設計上の要点

**公開読みは「現在配信中のイベント」だけに限る。**
`events/$eventId` の `.read` を `root.child('_activeEvent_').val() === $eventId` にすることで、
**過去の大会の限定公開 URL を無認証で列挙できない**ようにしている。
管理者（認証済み）は `events` 全体を読めるので、イベントの切り替えや編集には支障がない。

これが「公開する部分と秘匿する部分を分ける」ために、外部依存ゼロ・当日の失敗経路ゼロで
できる範囲である。現在配信中のイベントの `videoId` は、中継ページを開けば
必ず見えるため、それ以上の秘匿は原理的にできない（D-017）。

**書き込みは `auth != null`。ただし新規サインアップの無効化が前提条件である。**
Firebase の `apiKey` は公開リポジトリから誰でも取得でき、Email/Password プロバイダは
**既定では誰でもサインアップできる**。この状態で `auth != null` を使うと、第三者が
自分でアカウントを作ってテロップや配信 URL を書き換えられる。

**Firebase Console で新規サインアップを無効化すること**で、`auth != null` を満たせる
アカウントが手作業で作った共有スタッフアカウント 1 つだけになり、このルールが成立する。
**この設定が本構成における唯一かつ必須の防御である**（HC-8、`docs/operations.md` 1-A）。

なお、Google ログインや匿名認証など**他のプロバイダを有効化すると、この前提が壊れる**
（`auth != null` が誰でも満たせるようになる）。プロバイダを追加する場合は
セキュリティルールも同時に見直すこと。

**視聴ページは認証しない**（HC-4）。中継ページを開けば `videoId` は DevTools から見えるため、
RTDB を非公開にしても秘匿にはならない。旧版 README の「Firebase から取得しているので
一応秘匿されている」という記述は正しくない。

**`videoId` は必ず 11 文字の ID 形式に正規化して保存する。**
URL 文字列をそのまま入れさせない（旧版の `/embed/` 手打ち運用が事故源だった）。

**すべてのフィールドに文字数・形式の上限を置く。**
万一書き込み権限が漏れた場合の被害を、表示崩れ程度に抑える。

### RTDB に書いてよい情報・いけない情報

**読み取りは全世界に公開されている。** RTDB に入れた内容は、中継ページを開かなくても
誰でも取得できる（HC-7）。

| 可 | 不可 |
|---|---|
| 大会名、日付、コート名 | **選手名・出場者名などの個人名** |
| 「小学3・4年 形」などの種目名 | 出場者の所属・学校名 |
| 配信の動画 ID | スタッフの連絡先・電話番号 |
| テロップ、お知らせ文 | パスワード、UID、認証情報 |

---

## 旧版データの移行

旧 Firebase プロジェクト `yushinmon-live` に既存データがある場合、
以下の対応で移行できる。移行スクリプトは M2 で用意する。

| 旧 | 新 |
|---|---|
| `_activeLive_` | `_activeEvent_` |
| `liveList/{id}` | `events/{id}` |
| `eventTitle` | `title` |
| `eventDate` | `date` |
| `lives[]` | `courts[]` |
| `venueName` | `name` |
| `liveUrl`（embed URL） | `videoId`（ID を抽出） |
| `state: "on" / "off"` | `state: "live" / "paused"` |
| `program[].id` | 廃止（配列順に正規化） |
| `memo` | 廃止 |
