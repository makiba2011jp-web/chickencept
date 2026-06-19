# チキンセプト オンライン版 セットアップ手順

スマホ4人でネット越しに通信対戦するには、次の2つが必要です。

1. **Supabase**（リアルタイムDB）… ゲーム状態の同期
2. **静的ホスティング**（無料）… HTML/CSS/JSをスマホから開けるように公開

---

## 1. Supabase の準備

### 1-1. プロジェクト作成
1. https://supabase.com にアクセスし、GitHub等でサインアップ（無料）
2. 「New project」→ 名前とパスワードを決めて作成（数分かかります）

### 1-2. テーブルとポリシーを作成
左メニュー **SQL Editor** → 「New query」に以下を貼り付けて **Run**：

```sql
-- 部屋テーブル（状態を1行のJSONで保持＋楽観ロック用バージョン）
create table rooms (
  code text primary key,
  state jsonb not null,
  version int not null default 0,
  created_at timestamptz default now()
);

-- リアルタイム配信を有効化
alter publication supabase_realtime add table rooms;

-- 行レベルセキュリティ（友達同士の利用想定：匿名キーで読み書き許可）
alter table rooms enable row level security;
create policy "anon all" on rooms for all
  to anon using (true) with check (true);
```

> ※ これは「コードを知っていれば誰でも読み書きできる」設定です。身内で遊ぶ分には十分です。
>   公開して厳格にしたい場合は、後でポリシーを絞れます。

### 1-3. 接続キーを取得
左メニュー **Project Settings → API**：
- **Project URL**（例 `https://abcd.supabase.co`）
- **anon public** key（`eyJ...` で始まる長い文字列）

### 1-4. config.js に貼り付け
このフォルダの `config.js` を開き、2か所を書き換える：

```js
window.SUPABASE_CONFIG = {
  url: "https://abcd.supabase.co",   // ← Project URL
  anonKey: "eyJ...",                  // ← anon public key
};
```

---

## 2. 動作確認（自分のPCだけで）

`index.html` をブラウザで開く → 名前を入れて「部屋を作る」。
別のタブをもう1つ開いて同じコードで「参加する」→ 2人として表示されれば成功。

> ローカルファイル(file://)でも Supabase 通信は動きますが、
> **他のスマホからは開けません**。実際にスマホ4人で遊ぶには次の公開作業が必要です。

---

## 3. スマホから遊べるように公開（無料）

一番簡単なのは **Netlify Drop**：

1. https://app.netlify.com/drop を開く
2. このフォルダ（`チキンセプト`）ごと画面にドラッグ＆ドロップ
3. `https://〇〇.netlify.app` のURLが発行される
4. そのURLをスマホで開く → 名前を入れて部屋を作る／参加する

> 代替：GitHub Pages、Cloudflare Pages、Vercel でも同様に無料で公開できます。
> いずれも `index.html` が入ったフォルダをそのまま置くだけです。

---

## 遊び方

1. 1人が「部屋を作る」→ 表示された4文字コードを共有
2. 残りの人がそのコード（またはURL）で「参加する」（最大4人）
3. ホスト（👑）が「ゲーム開始」
4. 自分の番でサイコロ → 移動 → 召喚／侵略／通行料 を選択
5. 最初に **総魔力1500G** に到達した人の勝ち

## 補足・既知の制限（MVP）
- 手札データは状態に含まれるため、技術的には他人が覗ける余地があります（身内向け前提）
- 対局中にプレイヤーが離脱しても自動スキップはまだありません（必要なら追加します）
- 2〜4人で開始できます
