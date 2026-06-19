"use strict";

/* ===================== 定数・データ ===================== */

const GOAL = 1500;        // 勝利に必要な総魔力
const START_MAGIC = 200;  // 開始時の魔力
const START_BONUS = 80;   // スタート通過ボーナス
const HAND_SIZE = 5;      // 手札枚数

const ELEMENTS = {
  fire:  { name: "火", color: "var(--fire)" },
  water: { name: "水", color: "var(--water)" },
  earth: { name: "地", color: "var(--earth)" },
  wind:  { name: "風", color: "var(--wind)" },
};

// ボード（5x5の外周16マス）。grid座標は1始まり [row, col]
const BOARD = [
  { type: "start", grid: [1, 1] },
  { type: "land", el: "fire",  grid: [1, 2] },
  { type: "land", el: "water", grid: [1, 3] },
  { type: "land", el: "fire",  grid: [1, 4] },
  { type: "land", el: "earth", grid: [1, 5] },
  { type: "land", el: "wind",  grid: [2, 5] },
  { type: "land", el: "water", grid: [3, 5] },
  { type: "land", el: "earth", grid: [4, 5] },
  { type: "start", grid: [5, 5] },              // チェックポイント（もう一つのスタート）
  { type: "land", el: "wind",  grid: [5, 4] },
  { type: "land", el: "fire",  grid: [5, 3] },
  { type: "land", el: "water", grid: [5, 2] },
  { type: "land", el: "earth", grid: [5, 1] },
  { type: "land", el: "wind",  grid: [4, 1] },
  { type: "land", el: "earth", grid: [3, 1] },
  { type: "land", el: "fire",  grid: [2, 1] },
];

// クリーチャーカード図鑑
const CREATURES = [
  { name: "ヒヨコ戦士",     el: "fire",  cost: 30,  st: 20, hp: 30 },
  { name: "サラマンダー",   el: "fire",  cost: 60,  st: 40, hp: 40 },
  { name: "フェニックス",   el: "fire",  cost: 90,  st: 50, hp: 60 },
  { name: "マーマン",       el: "water", cost: 40,  st: 25, hp: 45 },
  { name: "クラーケン",     el: "water", cost: 80,  st: 45, hp: 55 },
  { name: "リヴァイアサン", el: "water", cost: 100, st: 55, hp: 65 },
  { name: "ゴーレム",       el: "earth", cost: 50,  st: 20, hp: 60 },
  { name: "ガーディアン",   el: "earth", cost: 70,  st: 30, hp: 70 },
  { name: "タイタン",       el: "earth", cost: 110, st: 50, hp: 80 },
  { name: "ハーピー",       el: "wind",  cost: 35,  st: 30, hp: 25 },
  { name: "グリフォン",     el: "wind",  cost: 65,  st: 45, hp: 35 },
  { name: "テンペスト",     el: "wind",  cost: 95,  st: 60, hp: 45 },
];

/* ===================== 状態 ===================== */

const players = [
  { id: 0, name: "あなた", isAI: false, color: "#3498db", magic: START_MAGIC, pos: 0, hand: [] },
  { id: 1, name: "AI赤",   isAI: true,  color: "#e74c3c", magic: START_MAGIC, pos: 0, hand: [] },
  { id: 2, name: "AI緑",   isAI: true,  color: "#2ecc71", magic: START_MAGIC, pos: 0, hand: [] },
  { id: 3, name: "AI橙",   isAI: true,  color: "#e67e22", magic: START_MAGIC, pos: 0, hand: [] },
];

// 各マスの所有状態: { owner: playerId, creature: {...} } または null
const lands = BOARD.map(() => null);

let turnIndex = 0;
let gameOver = false;

/* ===================== ユーティリティ ===================== */

const $ = (sel) => document.querySelector(sel);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const rollDice = () => 1 + Math.floor(Math.random() * 6);

function log(msg, cls = "") {
  const el = document.createElement("div");
  el.className = "entry " + cls;
  el.textContent = msg;
  $("#log").prepend(el);
}

// クリーチャーカードを1枚生成
function drawCard() {
  const base = CREATURES[Math.floor(Math.random() * CREATURES.length)];
  return { ...base };
}

function refillHand(p) {
  while (p.hand.length < HAND_SIZE) p.hand.push(drawCard());
}

// 土地の通行料（クリーチャーのコストに応じる）
function tollOf(land) {
  if (!land || !land.creature) return 0;
  return Math.round(land.creature.cost * 0.4) + 10;
}

// プレイヤーの総魔力（現金 + 所有地の価値）
function totalMagic(p) {
  let t = p.magic;
  lands.forEach((l) => { if (l && l.owner === p.id) t += tollOf(l); });
  return t;
}

/* ===================== 描画 ===================== */

function render() {
  renderPlayers();
  renderBoard();
  renderHand();
  $("#goalValue").textContent = GOAL;
}

function renderPlayers() {
  const wrap = $("#players");
  wrap.innerHTML = "";
  players.forEach((p) => {
    const div = document.createElement("div");
    div.className = "player-card" + (p.id === turnIndex ? " active" : "");
    div.style.borderLeftColor = p.color;
    const owned = lands.filter((l) => l && l.owner === p.id).length;
    div.innerHTML = `
      <h3 style="color:${p.color}">${p.name}</h3>
      <div class="magic">${totalMagic(p)} G</div>
      <div class="stat">現金 ${p.magic}G ／ 所有地 ${owned}</div>`;
    wrap.appendChild(div);
  });
}

function renderBoard() {
  const board = $("#board");
  board.innerHTML = "";
  BOARD.forEach((cell, i) => {
    const div = document.createElement("div");
    const elClass = cell.type === "start" ? "start" : cell.el;
    div.className = "cell " + elClass;
    div.style.gridRow = cell.grid[0];
    div.style.gridColumn = cell.grid[1];

    const land = lands[i];
    let inner = "";
    if (cell.type === "start") {
      inner = `<div class="cell-el">🏁 START</div>
               <div class="cell-toll">通過 +${START_BONUS}G</div>`;
    } else {
      inner = `<div class="cell-el">${ELEMENTS[cell.el].name}属性</div>`;
      if (land) {
        const owner = players[land.owner];
        inner += `<div class="cell-creature">${land.creature.name}</div>
                  <div class="cell-creature">⚔${land.creature.st} ❤${land.creature.hp}/${land.creature.maxHp}</div>
                  <div class="cell-owner" style="color:${owner.color}">${owner.name}</div>
                  <div class="cell-toll">通行料 ${tollOf(land)}G</div>`;
      } else {
        inner += `<div class="cell-owner">空き地</div>`;
      }
    }

    // プレイヤートークン
    let tokens = '<div class="tokens">';
    players.forEach((p) => {
      if (p.pos === i) tokens += `<div class="token" style="background:${p.color}"></div>`;
    });
    tokens += "</div>";

    div.innerHTML = inner + tokens;
    board.appendChild(div);
  });
}

function renderHand() {
  const hand = $("#hand");
  hand.innerHTML = "";
  const human = players[0];
  human.hand.forEach((c) => {
    const div = document.createElement("div");
    div.className = "card " + c.el;
    div.innerHTML = `
      <div class="card-name">${c.name}</div>
      <div class="card-stat"><span>${ELEMENTS[c.el].name}</span><span class="card-cost">${c.cost}G</span></div>
      <div class="card-stat"><span>⚔ ${c.st}</span><span>❤ ${c.hp}</span></div>`;
    hand.appendChild(div);
  });
}

/* ===================== ダイアログ ===================== */

function ask(text, options) {
  return new Promise((resolve) => {
    $("#dialogText").textContent = text;
    const btns = $("#dialogButtons");
    btns.innerHTML = "";
    options.forEach((o) => {
      const b = document.createElement("button");
      b.textContent = o.label;
      b.onclick = () => {
        $("#overlay").classList.add("hidden");
        resolve(o.value);
      };
      btns.appendChild(b);
    });
    $("#overlay").classList.remove("hidden");
  });
}

/* ===================== 戦闘 ===================== */

// クリーチャーをインスタンス化して土地に置く（属性一致でHP+10）
function placeCreature(landIndex, ownerId, card) {
  const matchBonus = BOARD[landIndex].el === card.el ? 10 : 0;
  const maxHp = card.hp + matchBonus;
  lands[landIndex] = {
    owner: ownerId,
    creature: { name: card.name, el: card.el, st: card.st, hp: maxHp, maxHp, cost: card.cost },
  };
}

// 侵略戦闘。attackerCard が defender(land) を攻撃。捕獲できたら true
function battle(attacker, landIndex) {
  const land = lands[landIndex];
  const def = land.creature;
  log(`⚔ 戦闘! ${attacker.name}(⚔${attacker.st}) → ${def.name}(❤${def.hp})`, "battle");

  // 攻撃側が先制
  def.hp -= attacker.st;
  if (def.hp <= 0) {
    log(`💥 ${def.name} を撃破! 土地を奪った。`, "battle");
    return true;
  }
  // 防御側の反撃
  let atkHp = attacker.hp;
  atkHp -= def.st;
  log(`🛡 ${def.name} 生存(❤${def.hp})、反撃! ${attacker.name} のHP ${atkHp}`, "battle");
  // 防御側はHP回復（カルドセプト式）
  def.hp = def.maxHp;
  if (atkHp <= 0) log(`💀 ${attacker.name} は倒れた。侵略失敗。`, "battle");
  else log(`↩ 両者生存。侵略失敗、${attacker.name} は撤退。`, "battle");
  return false;
}

/* ===================== マス解決 ===================== */

async function resolveCell(p) {
  const i = p.pos;
  const cell = BOARD[i];

  if (cell.type === "start") {
    log(`${p.name} はスタートに止まった。`, "system");
    return;
  }

  const land = lands[i];

  // 空き地 → 召喚
  if (!land) {
    await trySummon(p, i);
    return;
  }
  // 自分の土地
  if (land.owner === p.id) {
    log(`${p.name} は自分の土地に止まった。`, "system");
    return;
  }
  // 敵の土地 → 侵略 or 通行料
  await enemyLand(p, i);
}

// 召喚
async function trySummon(p, i) {
  const el = BOARD[i].el;
  const affordable = p.hand.filter((c) => c.cost <= p.magic);

  if (p.isAI) {
    if (affordable.length === 0) { log(`${p.name} は召喚せず通過。`, "system"); return; }
    // 属性一致 > 総合力 で選ぶ
    affordable.sort((a, b) =>
      (b.el === el) - (a.el === el) || (b.st + b.hp) - (a.st + a.hp));
    const pick = affordable[0];
    if (p.magic < pick.cost + 30) { log(`${p.name} は魔力を温存して通過。`, "system"); return; }
    doSummon(p, i, pick);
    return;
  }

  // 人間
  if (affordable.length === 0) {
    await ask(`${ELEMENTS[el].name}属性の空き地。召喚できるカードがない（魔力 ${p.magic}G）。`,
      [{ label: "通過する", value: null }]);
    return;
  }
  const opts = affordable.map((c, idx) => ({
    label: `${c.name} ⚔${c.st} ❤${c.hp}${BOARD[i].el === c.el ? "+10" : ""} (${c.cost}G)`,
    value: idx,
  }));
  opts.push({ label: "召喚しない", value: null });
  const choice = await ask(
    `${ELEMENTS[el].name}属性の空き地に止まった（魔力 ${p.magic}G）。\n属性が一致するとHP+10。誰を召喚する?`,
    opts);
  if (choice === null) { log(`${p.name} は召喚しなかった。`, "system"); return; }
  doSummon(p, i, affordable[choice]);
}

function doSummon(p, i, card) {
  p.magic -= card.cost;
  // 手札から該当カードを1枚除去
  const idx = p.hand.indexOf(card);
  if (idx >= 0) p.hand.splice(idx, 1);
  placeCreature(i, p.id, card);
  refillHand(p);
  log(`✨ ${p.name} が ${card.name} を召喚（-${card.cost}G）。通行料 ${tollOf(lands[i])}G`, "");
  render();
}

// 敵地
async function enemyLand(p, i) {
  const land = lands[i];
  const owner = players[land.owner];
  const toll = tollOf(land);

  if (p.isAI) {
    // 倒せるカードがあれば侵略、なければ通行料
    const killer = p.hand.find((c) => c.st >= land.creature.hp);
    if (killer) {
      log(`${p.name} は ${land.creature.name} に侵略を仕掛ける。`, "battle");
      await doInvade(p, i, killer);
    } else {
      payToll(p, owner, toll);
    }
    return;
  }

  // 人間
  const canInvade = p.hand.length > 0;
  const opts = [];
  if (canInvade) opts.push({ label: "侵略する", value: "invade" });
  opts.push({ label: `通行料を払う (${toll}G)`, value: "toll" });
  const choice = await ask(
    `${owner.name} の土地（${land.creature.name} ⚔${land.creature.st} ❤${land.creature.hp}）。\nどうする?`,
    opts);

  if (choice === "toll") { payToll(p, owner, toll); return; }

  // 侵略カード選択
  const cardOpts = p.hand.map((c, idx) => ({
    label: `${c.name} ⚔${c.st} ❤${c.hp} (${c.cost}G)`,
    value: idx,
  }));
  cardOpts.push({ label: "やめて通行料を払う", value: null });
  const ci = await ask("どのカードで侵略する?（召喚コストは不要）", cardOpts);
  if (ci === null) { payToll(p, owner, toll); return; }
  await doInvade(p, i, p.hand[ci]);
}

async function doInvade(p, i, card) {
  const owner = players[lands[i].owner];
  const won = battle(card, i);
  // 侵略に使ったカードは消費
  const idx = p.hand.indexOf(card);
  if (idx >= 0) p.hand.splice(idx, 1);
  if (won) {
    placeCreature(i, p.id, card);
    log(`🏴 ${p.name} が土地を奪取!`, "battle");
  }
  refillHand(p);
  render();
  await sleep(400);
}

function payToll(p, owner, toll) {
  const pay = Math.min(p.magic, toll);
  p.magic -= pay;
  owner.magic += pay;
  log(`💰 ${p.name} が ${owner.name} に通行料 ${pay}G を支払った。`, "");
  render();
}

/* ===================== ターン進行 ===================== */

function getHumanRoll() {
  return new Promise((resolve) => {
    const btn = $("#rollBtn");
    btn.disabled = false;
    btn.onclick = () => {
      btn.disabled = true;
      resolve(rollDice());
    };
  });
}

async function movePlayer(p, steps) {
  for (let s = 0; s < steps; s++) {
    p.pos = (p.pos + 1) % BOARD.length;
    if (BOARD[p.pos].type === "start") {
      // スタート/チェックポイントの通過・到達でボーナス
      p.magic += START_BONUS;
      log(`🏁 ${p.name} がスタートを通過 (+${START_BONUS}G)`, "system");
    }
    render();
    await sleep(180);
  }
}

async function playTurn(p) {
  render();
  log(`── ${p.name} のターン ──`, "system");

  let roll;
  if (p.isAI) {
    await sleep(500);
    roll = rollDice();
  } else {
    roll = await getHumanRoll();
  }
  $("#dieFace").textContent = roll;
  log(`🎲 ${p.name} は ${roll} を出した。`);

  await movePlayer(p, roll);
  await resolveCell(p);
  render();
  await sleep(300);
}

function checkWin(p) {
  if (totalMagic(p) >= GOAL) {
    gameOver = true;
    log(`🎉 ${p.name} の総魔力が ${GOAL}G に到達! ${p.name} の勝利!`, "win");
    ask(`🎉 ${p.name} の勝利!\n総魔力 ${totalMagic(p)}G`, [{ label: "もう一度遊ぶ", value: 1 }])
      .then(() => location.reload());
    return true;
  }
  return false;
}

async function gameLoop() {
  while (!gameOver) {
    const p = players[turnIndex];
    await playTurn(p);
    if (checkWin(p)) break;
    turnIndex = (turnIndex + 1) % players.length;
  }
}

/* ===================== 初期化 ===================== */

function init() {
  players.forEach(refillHand);
  render();
  log("🐔 チキンセプト開始! サイコロを振ってボードを進もう。", "system");
  log(`目標: 総魔力 ${GOAL}G を最初に達成したプレイヤーの勝ち。`, "system");
  gameLoop();
}

init();
