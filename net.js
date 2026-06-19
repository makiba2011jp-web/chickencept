"use strict";
/* ============================================================
   net.js : Supabase Realtime 通信ラッパー
   - rooms テーブル(code, state jsonb, version int)を読み書き
   - version による楽観ロックで書き込み競合を防ぐ
   ============================================================ */

let sb = null;

function netReady() {
  const c = window.SUPABASE_CONFIG;
  return c && c.url && !c.url.includes("YOUR-PROJECT") && c.anonKey && !c.anonKey.includes("YOUR-ANON");
}

function sbInit() {
  if (sb) return sb;
  if (!window.supabase) throw new Error("Supabase ライブラリが読み込まれていません。");
  if (!netReady()) throw new Error("config.js に Supabase の URL とキーを設定してください。");
  sb = window.supabase.createClient(window.SUPABASE_CONFIG.url, window.SUPABASE_CONFIG.anonKey, {
    realtime: { params: { eventsPerSecond: 10 } },
  });
  return sb;
}

// ランダムな4文字の部屋コード（紛らわしい文字を除外）
function genCode() {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  const buf = new Uint32Array(4);
  crypto.getRandomValues(buf);
  let s = "";
  for (let i = 0; i < 4; i++) s += chars[buf[i] % chars.length];
  return s;
}

// 部屋を新規作成（コード重複なら再生成）。{ code, state, version } を返す
async function sbCreateRoom(initialState) {
  sbInit();
  for (let i = 0; i < 8; i++) {
    const code = genCode();
    const { error } = await sb.from("rooms").insert({ code, state: initialState, version: 0 });
    if (!error) return { code, state: initialState, version: 0 };
    if (error.code !== "23505") throw new Error(error.message); // 23505=主キー重複以外は失敗
  }
  throw new Error("部屋コードの生成に失敗しました。");
}

// 部屋を取得。無ければ null
async function sbGetRoom(code) {
  sbInit();
  const { data, error } = await sb.from("rooms").select("state, version").eq("code", code).maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) return null;
  return { code, state: data.state, version: data.version };
}

// 状態を書き込む。version が一致した時だけ成功。
// 成功: { ok:true, version }  競合: { ok:false, state, version }(最新値)
async function sbPush(code, newState, expectedVersion) {
  sbInit();
  const { data, error } = await sb
    .from("rooms")
    .update({ state: newState, version: expectedVersion + 1 })
    .eq("code", code)
    .eq("version", expectedVersion)
    .select("version");
  if (error) throw new Error(error.message);
  if (data && data.length > 0) return { ok: true, version: expectedVersion + 1 };
  // 競合 → 最新を読み直す
  const latest = await sbGetRoom(code);
  return { ok: false, state: latest.state, version: latest.version };
}

// 部屋の変更を購読。cb({state, version}) が変更ごとに呼ばれる
function sbSubscribe(code, cb) {
  sbInit();
  const channel = sb
    .channel("room-" + code)
    .on("postgres_changes",
      { event: "*", schema: "public", table: "rooms", filter: "code=eq." + code },
      (payload) => { if (payload.new) cb({ state: payload.new.state, version: payload.new.version }); })
    .subscribe();
  return channel;
}
