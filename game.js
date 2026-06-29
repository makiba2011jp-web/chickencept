"use strict";
/* ============================================================
   チキンセプト オンライン版
   - 状態(state)は1つのJSONとして Supabase の rooms 行に保存
   - 手番のプレイヤーの端末だけが状態を計算して書き込む
   - 他の端末は Realtime で受け取って再描画するだけ
   ============================================================ */

/* ---------- 定数・データ ---------- */
const GOAL = 1500;
const START_MAGIC = 200;
const START_BONUS = 80;
const HAND_SIZE = 5;
const MAX_PLAYERS = 4;
const COLORS = ["#3498db", "#e74c3c", "#2ecc71", "#e67e22"];

const ELEMENTS = {
  fire:  { name: "火" }, water: { name: "水" },
  earth: { name: "地" }, wind:  { name: "風" },
};
// 属性相性：キーは値に対して有利（攻撃力1.5倍）。 火→風→地→水→火 の循環
const STRONG = { fire: "wind", wind: "earth", earth: "water", water: "fire" };
const MAX_LEVEL = 5; // 土地の最大レベル

const BOARD = [
  { type: "start", grid: [1, 1] },
  { type: "land", el: "fire",  grid: [1, 2] },
  { type: "land", el: "water", grid: [1, 3] },
  { type: "land", el: "fire",  grid: [1, 4] },
  { type: "land", el: "earth", grid: [1, 5] },
  { type: "land", el: "wind",  grid: [2, 5] },
  { type: "land", el: "water", grid: [3, 5] },
  { type: "land", el: "earth", grid: [4, 5] },
  { type: "start", grid: [5, 5] },
  { type: "land", el: "wind",  grid: [5, 4] },
  { type: "land", el: "fire",  grid: [5, 3] },
  { type: "land", el: "water", grid: [5, 2] },
  { type: "land", el: "earth", grid: [5, 1] },
  { type: "land", el: "wind",  grid: [4, 1] },
  { type: "land", el: "earth", grid: [3, 1] },
  { type: "land", el: "fire",  grid: [2, 1] },
];

// img: assets/cards/ の画像名（拡張子なし）。png→jpg の順に自動で探す。無ければ非表示
const CREATURES = [
  { name: "ヒヨコ戦士",     el: "fire",  cost: 30,  st: 20, hp: 30, img: "chick" },
  { name: "サラマンダー",   el: "fire",  cost: 60,  st: 40, hp: 40, img: "salamander" },
  { name: "フェニックス",   el: "fire",  cost: 90,  st: 50, hp: 60, img: "phoenix" },
  { name: "マーマン",       el: "water", cost: 40,  st: 25, hp: 45, img: "merman" },
  { name: "クラーケン",     el: "water", cost: 80,  st: 45, hp: 55, img: "kraken" },
  { name: "リヴァイアサン", el: "water", cost: 100, st: 55, hp: 65, img: "leviathan" },
  { name: "ゴーレム",       el: "earth", cost: 50,  st: 20, hp: 60, img: "golem" },
  { name: "ガーディアン",   el: "earth", cost: 70,  st: 30, hp: 70, img: "guardian" },
  { name: "タイタン",       el: "earth", cost: 110, st: 50, hp: 80, img: "titan" },
  { name: "ハーピー",       el: "wind",  cost: 35,  st: 30, hp: 25, img: "harpy" },
  { name: "グリフォン",     el: "wind",  cost: 65,  st: 45, hp: 35, img: "griffon" },
  { name: "テンペスト",     el: "wind",  cost: 95,  st: 60, hp: 45, img: "tempest" },
];
CREATURES.forEach((c) => (c.type = "creature"));

// アイテムカード：戦闘時に1枚使用（使い切り）。effect: hp=体力, st=攻撃, mirror=反射
// cost: 戦闘で使用する際の使用料金
const ITEMS = [
  { name: "くさりかたびら", type: "item", effect: "hp", value: 10, cost: 10, img: "chainmail" },
  { name: "鋼鉄の盾",       type: "item", effect: "hp", value: 20, cost: 20, img: "steelshield" },
  { name: "伝説の鎧",       type: "item", effect: "hp", value: 30, cost: 30, img: "legendarmor" },
  { name: "しぶきの鎧",     type: "item", effect: "hp", value: 40, cost: 40, img: "sprayarmor" },
  { name: "針",             type: "item", effect: "st", value: 10, cost: 10, img: "needle" },
  { name: "包丁",           type: "item", effect: "st", value: 20, cost: 20, img: "kitchenknife" },
  { name: "マシンガン",     type: "item", effect: "st", value: 30, cost: 30, img: "machinegun" },
  { name: "戦車砲",         type: "item", effect: "st", value: 40, cost: 40, img: "tankcannon" },
  { name: "スーパーかがみ", type: "item", effect: "mirror", value: 0, cost: 40, img: "mirror" },
];

const CARD_IMG_DIR = "assets/cards/";
const TOKEN_IMG_DIR = "assets/tokens/"; // プレイヤーの駒画像（参加順 p1〜p4）
const TOKEN_SLUGS = ["p1", "p2", "p3", "p4"];
const IMG_URL = {};    // カード slug -> URL（null=なし）
const TOKEN_URL = {};  // 駒 slug -> URL（null=なし）

// 起動時にカード画像・駒画像の拡張子(png/jpg/jpeg/webp)を1回だけ判定してURLを確定する
function preloadImages(done) {
  const exts = ["png", "jpg", "jpeg", "webp"];
  const cardSlugs = [...new Set([...CREATURES, ...ITEMS].map((c) => c.img).filter(Boolean))];
  const jobs = cardSlugs.map((s) => ({ dir: CARD_IMG_DIR, slug: s, map: IMG_URL }))
    .concat(TOKEN_SLUGS.map((s) => ({ dir: TOKEN_IMG_DIR, slug: s, map: TOKEN_URL })));
  let remaining = jobs.length;
  if (!remaining) { if (done) done(); return; }
  jobs.forEach((job) => {
    const finish = () => { if (--remaining === 0 && done) done(); };
    const tryNext = (i) => {
      if (i >= exts.length) { job.map[job.slug] = null; finish(); return; }
      const url = job.dir + job.slug + "." + exts[i];
      const im = new Image();
      im.onload = () => { job.map[job.slug] = url; finish(); };
      im.onerror = () => tryNext(i + 1);
      im.src = url;
    };
    tryNext(0);
  });
}

/* ---------- ユーティリティ ---------- */
const $ = (s) => document.querySelector(s);
const clone = (o) => JSON.parse(JSON.stringify(o));
const rollDice = () => 1 + Math.floor(Math.random() * 6);

function uuid() {
  if (crypto.randomUUID) { try { return crypto.randomUUID(); } catch (e) {} }
  const b = new Uint8Array(16); crypto.getRandomValues(b);
  return [...b].map((x) => x.toString(16).padStart(2, "0")).join("");
}

function drawCard() {
  const pool = Math.random() < 0.35 ? ITEMS : CREATURES; // 35%でアイテム
  return { ...pool[Math.floor(Math.random() * pool.length)] };
}
function refill(p) { while (p.hand.length < HAND_SIZE) p.hand.push(drawCard()); }
function baseToll(creature) { return Math.round(creature.cost * 0.4) + 10; }
// レベルが上がるほど通行料が増える
function tollOf(land) { return land && land.creature ? baseToll(land.creature) * (land.level || 1) : 0; }
function playerById(s, id) { return s.players.find((p) => p.id === id); }
function totalMagic(s, p) {
  let t = p.magic;
  s.lands.forEach((l) => { if (l && l.owner === p.id) t += tollOf(l); });
  return t;
}
function pushLog(s, msg, cls = "") { s.log.unshift({ msg, cls }); s.log = s.log.slice(0, 40); }
// 効果音イベントを記録（全端末で同期再生する）
function ev(s, sfx) { s.seq = (s.seq || 0) + 1; s.lastEvent = { seq: s.seq, sfx }; }

/* ---------- 自分の識別 ---------- */
let myId = localStorage.getItem("chickencept_pid");
if (!myId) { myId = uuid(); localStorage.setItem("chickencept_pid", myId); }
let myName = localStorage.getItem("chickencept_name") || "";

/* ---------- ローカルに保持する部屋情報 ---------- */
const room = { code: null, state: null, version: 0, channel: null };

function isMyTurn() { return room.state && room.state.turn === myId; }
function me() { return room.state ? playerById(room.state, myId) : null; }
function amHost() { return room.state && room.state.host === myId; }

/* ============================================================
   ゲームロジック（状態を書き換える純粋関数群）
   各 mutator は draft を受け取り、編集後 draft を返す。
   無効な操作なら false を返して中断。
   ============================================================ */

function placeCreature(s, i, ownerId, card) {
  const bonus = BOARD[i].el === card.el ? 10 : 0;
  const maxHp = card.hp + bonus;
  s.lands[i] = { owner: ownerId, level: 1, creature: { name: card.name, el: card.el, st: card.st, hp: maxHp, maxHp, cost: card.cost, img: card.img } };
}

function payToll(s, p, owner, toll) {
  const pay = Math.min(p.magic, toll);
  p.magic -= pay; owner.magic += pay;
  pushLog(s, `💰 ${p.name} → ${owner.name} に通行料 ${pay}G`);
}

function endTurn(s, p) {
  if (totalMagic(s, p) >= s.goal) {
    s.phase = "game_over"; s.winner = p.id;
    pushLog(s, `🎉 ${p.name} が総魔力 ${s.goal}G 達成! 勝利!`, "win");
    ev(s, "win");
    return;
  }
  const idx = s.players.findIndex((x) => x.id === p.id);
  s.turn = s.players[(idx + 1) % s.players.length].id;
  s.phase = "await_roll"; s.dice = null; s.pendingLand = null; s.battle = null;
}

function resolveLanding(s, p) {
  const i = p.pos, cell = BOARD[i];
  if (cell.type === "start") { pushLog(s, `${p.name} はスタートに止まった`, "system"); endTurn(s, p); return; }
  const land = s.lands[i];
  if (!land) { s.phase = "await_summon"; s.pendingLand = i; return; }
  if (land.owner === p.id) {
    const g = tollOf(land);
    p.magic += g;
    pushLog(s, `🏠 ${p.name} は自分の土地に止まり +${g}G`, "system");
    ev(s, "coin");
    endTurn(s, p); return;
  }
  s.phase = "await_enemy"; s.pendingLand = i;
}

// --- 各アクション ---
function mRoll(s) {
  if (s.turn !== myId || s.phase !== "await_roll") return false;
  const p = playerById(s, myId);
  const dice = rollDice(); s.dice = dice;
  let bonus = 0;
  for (let k = 0; k < dice; k++) {
    p.pos = (p.pos + 1) % BOARD.length;
    if (BOARD[p.pos].type === "start") bonus += START_BONUS;
    // 最終マス以外（＝通過）で自分の土地ならモンスターがレベルアップ
    if (k < dice - 1) {
      const l = s.lands[p.pos];
      if (l && l.owner === p.id && (l.level || 1) < MAX_LEVEL) {
        l.level = (l.level || 1) + 1;
        pushLog(s, `⬆ ${p.name} の ${l.creature.name} がLv${l.level}に成長! 通行料${tollOf(l)}G`, "system");
      }
    }
  }
  if (bonus) { p.magic += bonus; pushLog(s, `🏁 ${p.name} スタート通過 +${bonus}G`, "system"); }
  pushLog(s, `🎲 ${p.name} は ${dice} を出した`);
  ev(s, "dice");
  resolveLanding(s, p);
  return s;
}

function mSummon(s, cardIdx) {
  if (s.turn !== myId || s.phase !== "await_summon") return false;
  const p = playerById(s, myId), i = s.pendingLand;
  if (cardIdx < 0) { pushLog(s, `${p.name} は召喚しなかった`, "system"); endTurn(s, p); return s; }
  const card = p.hand[cardIdx];
  if (!card || card.type !== "creature" || card.cost > p.magic) return false;
  p.magic -= card.cost; p.hand.splice(cardIdx, 1);
  placeCreature(s, i, p.id, card); refill(p);
  pushLog(s, `✨ ${p.name} が ${card.name} を召喚 (-${card.cost}G)`);
  ev(s, "summon");
  endTurn(s, p); return s;
}

function mEnemy(s, choice) {
  if (s.turn !== myId || s.phase !== "await_enemy") return false;
  const p = playerById(s, myId), i = s.pendingLand, land = s.lands[i];
  const owner = playerById(s, land.owner);
  if (choice === "toll") { payToll(s, p, owner, tollOf(land)); ev(s, "coin"); endTurn(s, p); return s; }
  if (choice === "invade") { if (!p.hand.some((c) => c.type === "creature" && c.cost <= p.magic)) return false; s.phase = "await_invade"; return s; }
  return false;
}

// ① 侵略するクリーチャーを選ぶ（または通行料）
function mInvadeCreature(s, cardIdx) {
  if (s.turn !== myId || s.phase !== "await_invade") return false;
  const p = playerById(s, myId), i = s.pendingLand, land = s.lands[i];
  const owner = playerById(s, land.owner);
  if (cardIdx < 0) { payToll(s, p, owner, tollOf(land)); ev(s, "coin"); endTurn(s, p); return s; }
  const card = p.hand[cardIdx];
  if (!card || card.type !== "creature" || card.cost > p.magic) return false;
  p.magic -= card.cost; // モンスター使用料金
  p.hand.splice(cardIdx, 1);
  pushLog(s, `⚔ ${p.name} が ${card.name} で侵略（使用料 -${card.cost}G）`, "battle");
  s.battle = { i, attackerId: myId, defenderId: land.owner, attCard: card, attItem: null, defItem: null };
  s.phase = "await_att_item";
  return s;
}

// ② 攻撃側がアイテムを使う（-1でなし）
function mAttItem(s, itemIdx) {
  if (s.turn !== myId || s.phase !== "await_att_item" || !s.battle) return false;
  const p = playerById(s, myId);
  if (itemIdx >= 0) {
    const it = p.hand[itemIdx];
    if (!it || it.type !== "item" || it.cost > p.magic) return false;
    p.magic -= it.cost; // アイテム使用料金
    p.hand.splice(itemIdx, 1);
    s.battle.attItem = it;
    pushLog(s, `🗡 ${p.name} が ${it.name} を使用（-${it.cost}G）`, "battle");
  }
  // 守備側がアイテムを持っていれば防御フェーズへ、なければ即解決
  const def = playerById(s, s.battle.defenderId);
  if (def.hand.some((c) => c.type === "item")) { s.phase = "await_defense"; return s; }
  resolveBattle(s);
  return s;
}

// ③ 守備側がアイテムを使う（-1でなし）→ 戦闘解決
function mDefItem(s, itemIdx) {
  if (s.phase !== "await_defense" || !s.battle || s.battle.defenderId !== myId) return false;
  const d = playerById(s, myId);
  if (itemIdx >= 0) {
    const it = d.hand[itemIdx];
    if (!it || it.type !== "item" || it.cost > d.magic) return false;
    d.magic -= it.cost; // アイテム使用料金
    d.hand.splice(itemIdx, 1);
    s.battle.defItem = it;
    pushLog(s, `🛡 ${d.name} が ${it.name} を使用（-${it.cost}G）`, "battle");
  }
  resolveBattle(s);
  return s;
}

// 戦闘解決（アイテム効果＋属性相性込み、バトルシーン用データを生成）
function resolveBattle(s) {
  const b = s.battle, i = b.i, land = s.lands[i];
  const att = playerById(s, b.attackerId);
  const owner = playerById(s, b.defenderId);
  const aCard = b.attCard, dCre = land.creature;

  let aSt = aCard.st, aHp = aCard.hp;
  if (b.attItem) { if (b.attItem.effect === "st") aSt += b.attItem.value; if (b.attItem.effect === "hp") aHp += b.attItem.value; }
  let dSt = dCre.st, dHp = dCre.maxHp, dMirror = false;
  if (b.defItem) {
    if (b.defItem.effect === "st") dSt += b.defItem.value;
    if (b.defItem.effect === "hp") dHp += b.defItem.value;
    if (b.defItem.effect === "mirror") dMirror = true;
  }
  // 属性相性（有利な側はST1.5倍）
  const aAdv = STRONG[aCard.el] === dCre.el;
  const dAdv = STRONG[dCre.el] === aCard.el;
  if (aAdv) aSt = Math.round(aSt * 1.5);
  if (dAdv) dSt = Math.round(dSt * 1.5);

  const aHp0 = aHp, dHp0 = dHp, steps = [];
  let captured = false;

  pushLog(s, `⚔ ${att.name}:${aCard.name}(⚔${aSt}${aAdv ? "↑" : ""} ❤${aHp}) vs ${owner.name}:${dCre.name}(⚔${dSt}${dAdv ? "↑" : ""} ❤${dHp})`, "battle");
  if (aAdv) pushLog(s, `🔥 属性有利! ${aCard.name} の攻撃UP`, "battle");
  if (dAdv) pushLog(s, `🔥 属性有利! ${dCre.name} の反撃UP`, "battle");

  if (dMirror) {
    aHp -= aSt;
    steps.push({ target: "att", dmg: aSt, attHp: Math.max(0, aHp), defHp: Math.max(0, dHp), note: "🪞反射" });
    pushLog(s, `🪞 スーパーかがみ! 攻撃を跳ね返した（${aCard.name} ❤${Math.max(0, aHp)}）`, "battle");
    if (aHp > 0) {
      aHp -= dSt;
      steps.push({ target: "att", dmg: dSt, attHp: Math.max(0, aHp), defHp: Math.max(0, dHp) });
    }
  } else {
    dHp -= aSt;
    steps.push({ target: "def", dmg: aSt, attHp: Math.max(0, aHp), defHp: Math.max(0, dHp) });
    if (dHp <= 0) captured = true;
    else {
      aHp -= dSt;
      steps.push({ target: "att", dmg: dSt, attHp: Math.max(0, aHp), defHp: Math.max(0, dHp) });
    }
  }

  if (captured) {
    pushLog(s, `💥 ${dCre.name} を撃破! ${att.name} が土地を奪取!`, "battle");
    placeCreature(s, i, b.attackerId, aCard);
  } else {
    pushLog(s, `🛡 ${owner.name} が防衛成功。侵略失敗`, "battle");
    payToll(s, att, owner, tollOf(land)); // 侵略失敗 → 通行料を払う
  }
  refill(att); refill(owner);

  // バトルシーン用データ（全端末で同じ演出を再生）
  s.seq = (s.seq || 0) + 1;
  s.lastBattle = {
    seq: s.seq,
    att: { name: aCard.name, img: aCard.img, color: att.color, st: aSt, hp0: aHp0, el: aCard.el, adv: aAdv, item: b.attItem ? b.attItem.name : null },
    def: { name: dCre.name, img: dCre.img, color: owner.color, st: dSt, hp0: dHp0, el: dCre.el, adv: dAdv, item: b.defItem ? b.defItem.name : null },
    steps, captured,
    result: captured ? `${att.name} が土地を奪取！` : `${owner.name} が防衛成功`,
  };
  s.lastEvent = { seq: s.seq, sfx: "none" }; // 戦闘音はバトルシーン側で鳴らす

  s.battle = null;
  endTurn(s, att);
}

/* ============================================================
   通信グルー：mutator を適用して Supabase に書き込む
   競合時は最新状態を取り込んで数回リトライ
   ============================================================ */
async function commit(mutator) {
  for (let attempt = 0; attempt < 6; attempt++) {
    const draft = clone(room.state);
    const next = mutator(draft);
    if (next === false) return false;
    const res = await sbPush(room.code, draft, room.version);
    if (res.ok) { room.state = draft; room.version = res.version; render(); return true; }
    room.state = res.state; room.version = res.version; // 競合 → 最新で再試行
  }
  render();
  return false;
}

function onRemote(row) { room.state = row.state; room.version = row.version; render(); }

/* ============================================================
   画面遷移・描画
   ============================================================ */
function show(screen) {
  ["home", "lobby", "game"].forEach((id) => $("#" + id).classList.toggle("hidden", id !== screen));
}

function render() {
  syncBgm();
  checkSfx();
  checkVictory();
  checkBattle();
  if (!room.state) { displayPos = {}; show("home"); return; }
  if (room.state.phase === "lobby") { displayPos = {}; show("lobby"); renderLobby(); return; }
  checkDraw(room.state);
  show("game"); renderGame();
}

function renderLobby() {
  const s = room.state;
  $("#roomCode").textContent = room.code;
  const list = $("#lobbyPlayers");
  list.innerHTML = "";
  s.players.forEach((p) => {
    const div = document.createElement("div");
    div.className = "lobby-player";
    div.style.borderLeftColor = p.color;
    div.innerHTML = `<span style="color:${p.color}">●</span> ${p.name}` +
      (p.id === s.host ? " 👑" : "") + (p.id === myId ? " <small>(あなた)</small>" : "");
    list.appendChild(div);
  });
  $("#startBtn").classList.toggle("hidden", !amHost());
  $("#startBtn").disabled = s.players.length < 2;
  $("#lobbyHint").textContent = amHost()
    ? (s.players.length < 2 ? "もう1人以上の参加を待っています…" : "全員揃ったら開始できます")
    : "ホストの開始を待っています…";
}

function renderGame() {
  const s = room.state;
  renderPlayersBar(s);
  renderBoard(s);
  renderControls(s);
  renderMyHand(s);
  renderLog(s);
  animateTokens();
}

// 自分の手札を常時表示（閲覧用）
function renderMyHand(s) {
  const wrap = $("#myHand");
  const meP = playerById(s, myId);
  if (!meP) { wrap.innerHTML = ""; return; }
  let html = '<div class="myhand-title">あなたの手札</div><div class="hand">';
  meP.hand.forEach((card) => {
    html += `<div class="card ${card.type === "item" ? "item" : card.el}">${cardInner(card)}</div>`;
  });
  html += "</div>";
  wrap.innerHTML = html;
}

function renderPlayersBar(s) {
  const bar = $("#playersBar");
  bar.innerHTML = "";
  s.players.forEach((p, idx) => {
    const owned = s.lands.filter((l) => l && l.owner === p.id).length;
    const div = document.createElement("div");
    div.className = "pbar" + (p.id === s.turn ? " active" : "");
    div.style.borderColor = p.color;
    const turl = TOKEN_URL[TOKEN_SLUGS[idx]];
    const tok = turl ? `<span class="pbar-token" style="border-color:${p.color}"><img src="${turl}" alt=""></span>` : "";
    div.innerHTML = `<div class="pbar-name" style="color:${p.color}">${tok}${p.name}${p.id === myId ? "★" : ""}</div>
      <div class="pbar-magic">${totalMagic(s, p)}G</div>
      <div class="pbar-sub">現金${p.magic} 地${owned}</div>`;
    bar.appendChild(div);
  });
}

function renderBoard(s) {
  const board = $("#board");
  board.innerHTML = "";
  BOARD.forEach((cell, i) => {
    const div = document.createElement("div");
    div.className = "cell " + (cell.type === "start" ? "start" : cell.el);
    if (i === s.pendingLand) div.classList.add("pending");
    div.style.gridRow = cell.grid[0];
    div.style.gridColumn = cell.grid[1];
    const land = s.lands[i];
    let html = "";
    if (cell.type === "start") {
      html = `<div class="c-el">🏁START</div><div class="c-toll">+${START_BONUS}</div>`;
    } else {
      html = `<div class="c-el">${ELEMENTS[cell.el].name}</div>`;
      if (land) {
        const o = playerById(s, land.owner);
        const lImg = IMG_URL[land.creature.img];
        if (lImg) html = `<img class="cell-img" src="${lImg}" alt="">` + html;
        const lv = (land.level || 1) > 1 ? `<span class="c-lv">Lv${land.level}</span>` : "";
        html += `<div class="c-cr">${land.creature.name}${lv}</div>
          <div class="c-cr">⚔${land.creature.st}❤${land.creature.hp}</div>
          <div class="c-toll" style="color:${o.color}">${o.name} ${tollOf(land)}G</div>`;
      } else html += `<div class="c-empty">空き地</div>`;
    }
    let tokens = '<div class="tokens">';
    s.players.forEach((p, idx) => {
      if (tokenPos(p) !== i) return;
      const turl = TOKEN_URL[TOKEN_SLUGS[idx]];
      if (turl) tokens += `<span class="token tokenimg" style="border-color:${p.color}"><img src="${turl}" alt=""></span>`;
      else tokens += `<span class="token" style="background:${p.color}"></span>`;
    });
    div.innerHTML = html + tokens + "</div>";
    board.appendChild(div);
  });
}

function renderControls(s) {
  const c = $("#controls");
  c.innerHTML = "";

  if (s.phase === "game_over") {
    const w = playerById(s, s.winner);
    c.innerHTML = `<div class="turn-msg win">🎉 ${w.name} の勝利!</div>`;
    if (amHost()) addBtn(c, "もう一度（ロビーへ）", () => commit(mBackToLobby));
    return;
  }

  // 防御フェーズ：攻められた人が自分の端末でアイテムを選ぶ
  if (s.phase === "await_defense" && s.battle) {
    const att = playerById(s, s.battle.attackerId);
    const def = playerById(s, s.battle.defenderId);
    const land = s.lands[s.battle.i];
    const aSt = s.battle.attCard.st + (s.battle.attItem && s.battle.attItem.effect === "st" ? s.battle.attItem.value : 0);
    if (s.battle.defenderId === myId) {
      addHead(c, `<b style="color:#e74c3c">🛡 防御！</b>`);
      addText(c, `${att.name} の ${s.battle.attCard.name}（⚔${aSt}${s.battle.attItem ? "・" + s.battle.attItem.name : ""}）が ${land.creature.name}（❤${land.creature.maxHp}）を攻撃中。防御アイテムを使う？（使用料が必要）`);
      renderHandChoices(c, def.hand, { itemsOnly: true, costCheck: def }, (idx) => commit((s2) => mDefItem(s2, idx)));
      addBtn(c, "アイテムなしで防御", () => commit((s2) => mDefItem(s2, -1)));
    } else {
      addHead(c, `<span style="color:${def.color}">${def.name}</span> が防御アイテムを選んでいます…`);
    }
    return;
  }

  const turnP = playerById(s, s.turn);
  addHead(c, isMyTurn()
    ? `<b style="color:${me().color}">あなたの番</b>` + (s.dice ? ` 🎲${s.dice}` : "")
    : `<span style="color:${turnP.color}">${turnP.name}</span> の番を待っています…`);

  if (!isMyTurn()) return;
  const p = me();

  if (s.phase === "await_roll") {
    addBtn(c, "🎲 サイコロを振る", () => commit(mRoll), "primary");
  } else if (s.phase === "await_summon") {
    const el = BOARD[s.pendingLand].el;
    addText(c, `${ELEMENTS[el].name}属性の空き地。召喚する？(属性一致でHP+10)`);
    renderHandChoices(c, p.hand, { creaturesOnly: true, costCheck: p, landEl: el }, (idx) => commit((s2) => mSummon(s2, idx)));
    addBtn(c, "召喚しない", () => commit((s2) => mSummon(s2, -1)));
  } else if (s.phase === "await_enemy") {
    const land = s.lands[s.pendingLand];
    const lv = (land.level || 1) > 1 ? ` Lv${land.level}` : "";
    addText(c, `敵地：${land.creature.name}${lv} ⚔${land.creature.st} ❤${land.creature.maxHp}（${ELEMENTS[land.creature.el].name}属性）`);
    if (p.hand.some((card) => card.type === "creature" && card.cost <= p.magic))
      addBtn(c, "⚔ 侵略する", () => commit((s2) => mEnemy(s2, "invade")), "primary");
    addBtn(c, `💰 通行料 ${tollOf(land)}G`, () => commit((s2) => mEnemy(s2, "toll")));
  } else if (s.phase === "await_invade") {
    addText(c, "侵略するクリーチャーを選択（使用料が必要・失敗すると通行料）");
    renderHandChoices(c, p.hand, { creaturesOnly: true, costCheck: p }, (idx) => commit((s2) => mInvadeCreature(s2, idx)));
    addBtn(c, "やめて通行料を払う", () => commit((s2) => mInvadeCreature(s2, -1)));
  } else if (s.phase === "await_att_item") {
    addText(c, `${s.battle.attCard.name} で侵略。攻撃アイテムを使う？（使用料が必要・任意）`);
    renderHandChoices(c, p.hand, { itemsOnly: true, costCheck: p }, (idx) => commit((s2) => mAttItem(s2, idx)));
    addBtn(c, "アイテムなしで戦う", () => commit((s2) => mAttItem(s2, -1)));
  }
}

function addHead(c, html) {
  const head = document.createElement("div");
  head.className = "turn-msg";
  head.innerHTML = html;
  c.appendChild(head);
}

// カード1枚分の中身HTML（クリーチャー / アイテム両対応）
function cardInner(card, landEl) {
  const url = IMG_URL[card.img];
  const img = url ? `<div class="card-img"><img src="${url}" alt=""></div>` : "";
  if (card.type === "item") {
    const eff = card.effect === "hp" ? `❤+${card.value}` : card.effect === "st" ? `⚔+${card.value}` : "🪞反射";
    return img + `<div class="card-name">${card.name}</div>
      <div class="card-stat"><span>${eff}</span><span class="card-cost">${card.cost}G</span></div>`;
  }
  const match = landEl && landEl === card.el ? "+10" : "";
  return img + `<div class="card-name">${card.name}</div>
    <div class="card-stat"><span>${ELEMENTS[card.el].name}</span><span class="card-cost">${card.cost}G</span></div>
    <div class="card-stat"><span>⚔${card.st}</span><span>❤${card.hp}${match}</span></div>`;
}

// 手札からカードをボタンとして並べる。opts: {creaturesOnly, itemsOnly, costCheck, landEl}
function renderHandChoices(container, hand, opts, onPick) {
  const wrap = document.createElement("div");
  wrap.className = "hand";
  let shown = 0;
  hand.forEach((card, idx) => {
    if (opts.creaturesOnly && card.type !== "creature") return;
    if (opts.itemsOnly && card.type !== "item") return;
    shown++;
    const b = document.createElement("button");
    b.className = "card " + (card.type === "item" ? "item" : card.el);
    const disabled = opts.costCheck && (card.cost || 0) > opts.costCheck.magic;
    if (disabled) b.classList.add("disabled");
    b.innerHTML = cardInner(card, opts.landEl);
    b.onclick = () => { if (!disabled) onPick(idx, card); };
    wrap.appendChild(b);
  });
  if (shown === 0) { const d = document.createElement("div"); d.className = "ctrl-text"; d.textContent = opts.itemsOnly ? "（手札にアイテムなし）" : "（手札にクリーチャーなし）"; wrap.appendChild(d); }
  container.appendChild(wrap);
}

function renderLog(s) {
  const log = $("#log");
  log.innerHTML = "";
  s.log.forEach((e) => {
    const d = document.createElement("div");
    d.className = "entry " + (e.cls || "");
    d.textContent = e.msg;
    log.appendChild(d);
  });
}

function addBtn(parent, label, onClick, cls = "") {
  const b = document.createElement("button");
  b.textContent = label; b.className = "act " + cls; b.onclick = onClick;
  parent.appendChild(b);
}
function addText(parent, t) {
  const d = document.createElement("div"); d.className = "ctrl-text"; d.textContent = t; parent.appendChild(d);
}

/* ---------- ロビー操作 mutator ---------- */
function mAddMe(s) {
  if (s.started) { return s.players.some((p) => p.id === myId) ? s : false; }
  if (s.players.some((p) => p.id === myId)) return s;
  if (s.players.length >= MAX_PLAYERS) return false;
  const seat = s.players.length;
  s.players.push({ id: myId, name: myName, color: COLORS[seat], magic: START_MAGIC, pos: 0, hand: [] });
  return s;
}
function mStart(s) {
  if (s.host !== myId || s.players.length < 2) return false;
  s.started = true; s.phase = "await_roll"; s.turn = s.players[0].id;
  s.dice = null; s.pendingLand = null; s.goal = GOAL; s.winner = null; s.battle = null;
  s.lands = BOARD.map(() => null);
  s.players.forEach((pl, i) => { pl.color = COLORS[i]; pl.magic = START_MAGIC; pl.pos = 0; pl.hand = []; refill(pl); });
  s.log = [];
  pushLog(s, "🐔 チキンセプト開始!", "system");
  pushLog(s, `目標：総魔力 ${GOAL}G を最初に達成で勝利`, "system");
  return s;
}
function mBackToLobby(s) {
  if (s.host !== myId) return false;
  s.started = false; s.phase = "lobby"; s.turn = null; s.dice = null;
  s.pendingLand = null; s.winner = null; s.lands = []; s.battle = null;
  s.players.forEach((pl) => { pl.magic = START_MAGIC; pl.pos = 0; pl.hand = []; });
  s.log = [];
  return s;
}

/* ============================================================
   ホーム画面の操作
   ============================================================ */
function attach(code) {
  room.code = code;
  location.hash = code;
  // 部屋ごとに演出・検出の状態をリセット
  lastSfxSeq = null; lastBattleSeq = null; prevHandKey = null;
  victoryShown = false; displayPos = {};
  if (moveTimer) { clearTimeout(moveTimer); moveTimer = null; }
  if (room.channel) sb.removeChannel(room.channel);
  room.channel = sbSubscribe(code, onRemote);
}

async function createRoom() {
  if (!validateName()) return;
  setBusy(true);
  try {
    const initial = {
      phase: "lobby", host: myId, started: false, goal: GOAL,
      players: [{ id: myId, name: myName, color: COLORS[0], magic: START_MAGIC, pos: 0, hand: [] }],
      lands: [], log: [], turn: null, dice: null, pendingLand: null, winner: null,
    };
    const res = await sbCreateRoom(initial);
    room.state = res.state; room.version = res.version;
    attach(res.code);
    render();
  } catch (e) { showErr(e.message); }
  setBusy(false);
}

async function joinRoom() {
  if (!validateName()) return;
  const code = $("#joinCode").value.trim().toUpperCase();
  if (code.length < 3) { showErr("部屋コードを入力してください。"); return; }
  setBusy(true);
  try {
    const got = await sbGetRoom(code);
    if (!got) { showErr("その部屋は見つかりません。"); setBusy(false); return; }
    room.state = got.state; room.version = got.version; room.code = code;
    attach(code);
    const ok = await commit(mAddMe);
    if (!ok && !playerById(room.state, myId)) {
      showErr(room.state.started ? "対局中で参加できません。" : "満席です。");
    }
    render();
  } catch (e) { showErr(e.message); }
  setBusy(false);
}

function validateName() {
  const n = $("#nameInput").value.trim();
  if (!n) { showErr("名前を入力してください。"); return false; }
  myName = n.slice(0, 12); localStorage.setItem("chickencept_name", myName);
  return true;
}
function showErr(msg) { $("#homeErr").textContent = msg; }
function setBusy(b) { $("#createBtn").disabled = b; $("#joinBtn").disabled = b; }

function leaveRoom() {
  if (room.channel) { sb.removeChannel(room.channel); room.channel = null; }
  room.code = null; room.state = null; room.version = 0;
  location.hash = "";
  render();
}

/* ============================================================
   BGM（音楽）
   - assets/bgm.mp3 を置くだけで再生されます（無ければ無音）
   - ブラウザの制約で、最初のクリック後に再生開始します
   ============================================================ */
// BGMは「1つの音声要素」でsrcを差し替えて切替（2曲が物理的に重ならない）
const bgm = new Audio();
bgm.loop = true;
bgm.volume = 0.4;
const BGM_TITLE = "assets/title.mp3"; // タイトル・ロビー
const BGM_GAME = "assets/bgm.mp3";    // 対戦中
let currentSrc = null;
let muted = localStorage.getItem("chickencept_muted") === "1";

function updateMuteBtn() { $("#muteBtn").textContent = muted ? "🔇" : "🔊"; }

// 今の画面に合った曲に切り替える（ホーム・ロビー=タイトル曲、対戦中=ゲーム曲）
function syncBgm() {
  const src = (!room.state || room.state.phase === "lobby") ? BGM_TITLE : BGM_GAME;
  if (currentSrc === src) return;
  currentSrc = src;
  bgm.src = src;       // 差し替えた時点で前の曲は自動停止
  if (!muted) bgm.play().catch(() => {});
}

function toggleMute() {
  muted = !muted;
  localStorage.setItem("chickencept_muted", muted ? "1" : "0");
  if (muted) bgm.pause();
  else bgm.play().catch(() => {});
  updateMuteBtn();
}

// 最初のユーザー操作でオーディオを解禁（自動再生ブロック対策）
function unlockAudio() {
  const ctx = audioCtx();
  if (ctx && ctx.state === "suspended") ctx.resume();
  if (!muted && currentSrc && bgm.paused) bgm.play().catch(() => {});
}

/* ---------- 効果音（Web Audioで合成。音声ファイル不要） ---------- */
let actx = null;
function audioCtx() {
  if (!actx) { try { actx = new (window.AudioContext || window.webkitAudioContext)(); } catch (e) {} }
  return actx;
}
function tone(freq, start, dur, type = "square", gain = 0.18) {
  const ctx = audioCtx(); if (!ctx) return;
  const o = ctx.createOscillator(), g = ctx.createGain();
  o.type = type; o.frequency.value = freq;
  o.connect(g); g.connect(ctx.destination);
  const t = ctx.currentTime + start;
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(gain, t + 0.012);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  o.start(t); o.stop(t + dur + 0.02);
}
function noiseBurst(start, dur, gain = 0.2) {
  const ctx = audioCtx(); if (!ctx) return;
  const n = ctx.createBufferSource();
  const buf = ctx.createBuffer(1, Math.max(1, ctx.sampleRate * dur), ctx.sampleRate);
  const d = buf.getChannelData(0);
  for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  n.buffer = buf;
  const g = ctx.createGain(); const t = ctx.currentTime + start;
  g.gain.setValueAtTime(gain, t); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  n.connect(g); g.connect(ctx.destination);
  n.start(t); n.stop(t + dur);
}
function playSfx(type) {
  if (muted) return;
  const ctx = audioCtx(); if (!ctx) return;
  if (ctx.state === "suspended") ctx.resume();
  switch (type) {
    case "dice":
      noiseBurst(0, 0.05, 0.18); noiseBurst(0.09, 0.05, 0.16); noiseBurst(0.18, 0.06, 0.14); break;
    case "summon":
      tone(440, 0, 0.12, "triangle", 0.2); tone(660, 0.1, 0.14, "triangle", 0.2); tone(880, 0.22, 0.16, "triangle", 0.18); break;
    case "coin":
      tone(988, 0, 0.07, "square", 0.16); tone(1319, 0.06, 0.13, "square", 0.16); break;
    case "battle":
      noiseBurst(0, 0.16, 0.28); tone(110, 0, 0.22, "sawtooth", 0.22); tone(70, 0.04, 0.22, "sawtooth", 0.18); break;
    case "win": {
      const notes = [523, 659, 784, 1047, 1047];
      notes.forEach((f, i) => tone(f, i * 0.14, 0.22, "triangle", 0.22));
      tone(1568, 0.7, 0.5, "triangle", 0.2); break;
    }
  }
}

// 新しい効果音イベントを検出して鳴らす（全端末で同期）
let lastSfxSeq = null;
function checkSfx() {
  const e = room.state && room.state.lastEvent;
  if (!e) return;
  if (lastSfxSeq === null) { lastSfxSeq = e.seq; return; } // 初回（途中参加等）は鳴らさない
  if (e.seq > lastSfxSeq) {
    lastSfxSeq = e.seq;
    if (e.sfx === "dice") animateDice(room.state.dice);
    if (e.sfx !== "none") playSfx(e.sfx);
  }
}

/* ---------- サイコロ演出 ---------- */
function animateDice(value) {
  const box = $("#diceBox");
  if (!box || !value) return;
  box.classList.remove("hidden");
  box.classList.add("rolling");
  const iv = setInterval(() => { box.textContent = "🎲" + (1 + Math.floor(Math.random() * 6)); }, 70);
  setTimeout(() => { clearInterval(iv); box.textContent = "🎲" + value; box.classList.remove("rolling"); }, 700);
}

/* ---------- 駒の移動アニメーション ---------- */
let displayPos = {};
let moveTimer = null;
function tokenPos(p) { return displayPos[p.id] != null ? displayPos[p.id] : p.pos; }
function animateTokens() {
  const s = room.state;
  if (!s || !s.players) return;
  s.players.forEach((p) => { if (displayPos[p.id] == null) displayPos[p.id] = p.pos; });
  if (moveTimer) return;
  const step = () => {
    const st = room.state;
    if (!st || !st.players) { moveTimer = null; return; }
    let moved = false;
    for (const p of st.players) {
      if (displayPos[p.id] != null && displayPos[p.id] !== p.pos) {
        displayPos[p.id] = (displayPos[p.id] + 1) % BOARD.length;
        moved = true; break;
      }
    }
    if (moved) { renderBoard(st); moveTimer = setTimeout(step, 170); }
    else { moveTimer = null; }
  };
  if (s.players.some((p) => displayPos[p.id] !== p.pos)) step();
}

/* ---------- バトルシーン演出 ---------- */
let lastBattleSeq = null;
function checkBattle() {
  const bt = room.state && room.state.lastBattle;
  if (!bt) return;
  if (lastBattleSeq === null) { lastBattleSeq = bt.seq; return; }
  if (bt.seq > lastBattleSeq) { lastBattleSeq = bt.seq; playBattleScene(bt); }
}
function setFighter(prefix, f) {
  const el = $("#" + prefix);
  el.querySelector(".fighter-name").innerHTML = `${f.name}${f.adv ? " 🔥" : ""}`;
  el.querySelector(".fighter-name").style.color = f.color;
  const url = IMG_URL[f.img];
  el.querySelector(".fighter-img").innerHTML = url ? `<img src="${url}" alt="">` : "❓";
  el.querySelector(".fighter-sub").textContent = `⚔${f.st}` + (f.item ? " ・" + f.item : "");
  el.querySelector(".hpfill").style.width = "100%";
  el.querySelector(".hpnum").textContent = "❤" + f.hp0;
}
function flashDamage(el, dmg) {
  const d = document.createElement("div");
  d.className = "dmg-float";
  d.textContent = "-" + dmg;
  el.appendChild(d);
  setTimeout(() => d.remove(), 1000);
}
function playBattleScene(bt) {
  setFighter("bAtt", bt.att);
  setFighter("bDef", bt.def);
  $("#battleResult").textContent = "";
  $("#battle").classList.remove("hidden");
  let t = 600;
  bt.steps.forEach((stp) => {
    setTimeout(() => {
      const who = stp.target === "att" ? "bAtt" : "bDef";
      const el = $("#" + who);
      const max = stp.target === "att" ? bt.att.hp0 : bt.def.hp0;
      const hp = stp.target === "att" ? stp.attHp : stp.defHp;
      el.querySelector(".hpfill").style.width = Math.max(0, (hp / max) * 100) + "%";
      el.querySelector(".hpnum").textContent = "❤" + hp;
      el.classList.add("hit");
      setTimeout(() => el.classList.remove("hit"), 320);
      flashDamage(el, stp.dmg);
      playSfx("battle");
    }, t);
    t += 950;
  });
  setTimeout(() => { $("#battleResult").textContent = bt.result; }, t);
  setTimeout(() => { $("#battle").classList.add("hidden"); }, t + 1700);
}

/* ---------- ドロー通知（自分が引いたカードを表示） ---------- */
let toastTimer = null;
function showToast(msg) {
  const t = $("#toast");
  if (!t) return;
  t.textContent = msg;
  t.classList.add("show");
  if (toastTimer) clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove("show"), 2400);
}
let prevHandKey = null, prevHandNames = [];
function multisetDiff(newer, older) {
  const pool = older.slice(), added = [];
  newer.forEach((n) => { const k = pool.indexOf(n); if (k >= 0) pool.splice(k, 1); else added.push(n); });
  return added;
}
function checkDraw(s) {
  const meP = playerById(s, myId);
  if (!meP || !meP.hand) { prevHandKey = null; return; }
  const names = meP.hand.map((c) => c.name).sort();
  const key = names.join("|");
  if (prevHandKey === null) { prevHandKey = key; prevHandNames = names; return; }
  if (key !== prevHandKey) {
    const added = multisetDiff(names, prevHandNames);
    prevHandKey = key; prevHandNames = names;
    if (added.length) showToast("🃏 引いた: " + added.join("、"));
  }
}

/* ---------- 勝利演出 ---------- */
let victoryShown = false;
function spawnConfetti() {
  const c = $("#confetti"); c.innerHTML = "";
  const colors = ["#e74c3c", "#3498db", "#2ecc71", "#f1c40f", "#9b59b6", "#e67e22"];
  for (let i = 0; i < 90; i++) {
    const p = document.createElement("div");
    p.className = "confetti-piece";
    p.style.left = Math.random() * 100 + "%";
    p.style.background = colors[i % colors.length];
    p.style.animationDelay = (Math.random() * 0.9) + "s";
    p.style.animationDuration = (1.6 + Math.random() * 1.6) + "s";
    p.style.transform = `rotate(${Math.random() * 360}deg)`;
    c.appendChild(p);
  }
}
function showVictory(name, color) {
  $("#victoryName").textContent = name;
  $("#victoryName").style.color = color;
  spawnConfetti();
  $("#victory").classList.remove("hidden");
}
function hideVictory() { $("#victory").classList.add("hidden"); $("#confetti").innerHTML = ""; }
function checkVictory() {
  const over = room.state && room.state.phase === "game_over";
  if (over && !victoryShown) {
    victoryShown = true;
    const w = playerById(room.state, room.state.winner);
    showVictory(w.name, w.color);
  } else if (!over && victoryShown) {
    victoryShown = false; hideVictory();
  }
}

/* ============================================================
   起動
   ============================================================ */
function boot() {
  updateMuteBtn();
  $("#muteBtn").onclick = toggleMute;
  // 最初の操作で両方の曲を解禁（自動再生ブロック＆曲切替対策）
  ["pointerdown", "click", "keydown"].forEach((ev) =>
    document.addEventListener(ev, unlockAudio, { passive: true }));

  // 画像URLを事前確定 → 確定後に再描画
  preloadImages(render);

  if (!netReady()) {
    $("#configWarn").classList.remove("hidden");
  }
  if (myName) $("#nameInput").value = myName;
  const hash = location.hash.replace("#", "").toUpperCase();
  if (hash) $("#joinCode").value = hash;

  $("#createBtn").onclick = createRoom;
  $("#joinBtn").onclick = joinRoom;
  $("#startBtn").onclick = () => commit(mStart);
  $("#leaveLobbyBtn").onclick = leaveRoom;
  $("#leaveGameBtn").onclick = leaveRoom;
  $("#victoryClose").onclick = hideVictory;

  render();
}

boot();
