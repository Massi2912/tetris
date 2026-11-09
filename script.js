'use strict';

/* =========================================================
   KONSTANTEN
   ========================================================= */
const COLS = 10;
const ROWS = 20;
const CELL = 30;                 // Zellgröße im Spielfeld (logische Pixel)
const PREVIEW_CELL = 24;         // Zellgröße in Hold/Next
const NEXT_COUNT = 3;

const DAS = 150;                 // Verzögerung bis Auto-Repeat (ms)
const ARR = 40;                  // Auto-Repeat-Intervall (ms)
const SOFT_DROP_MS = 100;        // Fallintervall bei Soft Drop
const CLEAR_MS = 350;            // Dauer der Zeilen-Animation
const LINES_PER_LEVEL = 10;
const LINE_POINTS = [0, 100, 300, 500, 800];
const STORAGE_KEY = 'tetris-highscore';

const SHAPES = {
  I: [[0,0,0,0],[1,1,1,1],[0,0,0,0],[0,0,0,0]],
  O: [[1,1],[1,1]],
  T: [[0,1,0],[1,1,1],[0,0,0]],
  S: [[0,1,1],[1,1,0],[0,0,0]],
  Z: [[1,1,0],[0,1,1],[0,0,0]],
  J: [[1,0,0],[1,1,1],[0,0,0]],
  L: [[0,0,1],[1,1,1],[0,0,0]],
};
const TYPES = Object.keys(SHAPES);

const COLORS = {
  I: '#22e6ff', O: '#ffe030', T: '#b45cff', S: '#3dff6e',
  Z: '#ff3b5c', J: '#3d6bff', L: '#ff9a2e',
};

// Wall Kicks: einfache Versuche nach links/rechts und einmal nach oben
const KICKS = [[0,0],[-1,0],[1,0],[-2,0],[2,0],[0,-1]];

// Tastenbelegung (über e.key, damit "Z" auch auf deutscher Tastatur stimmt)
const KEY_ACTIONS = {
  'arrowleft': 'left', 'arrowright': 'right', 'arrowdown': 'down',
  'arrowup': 'rotateCW', 'x': 'rotateCW', 'z': 'rotateCCW',
  ' ': 'hard', 'c': 'hold', 'shift': 'hold',
  'p': 'pause', 'escape': 'pause', 'enter': 'restart',
};

/* =========================================================
   DOM / CANVAS
   ========================================================= */
const $ = (id) => document.getElementById(id);

function setupCanvas(canvas) {
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const w = canvas.width, h = canvas.height;
  canvas.width = w * dpr;
  canvas.height = h * dpr;
  const ctx = canvas.getContext('2d');
  ctx.scale(dpr, dpr);
  return ctx;
}

const bctx = setupCanvas($('board'));
const hctx = setupCanvas($('hold'));
const nctx = setupCanvas($('next'));

const BOARD_W = COLS * CELL, BOARD_H = ROWS * CELL;

const ui = {
  score: $('score'), level: $('level'), lines: $('lines'), highscore: $('highscore'),
  overlay: $('overlay'), title: $('overlay-title'), text: $('overlay-text'),
  keys: $('overlay-keys'), resume: $('btn-resume'), restart: $('btn-restart'),
};

/* =========================================================
   SPIELZUSTAND
   ========================================================= */
let board, current, hold, canHold, queue;
let score, level, lines, highscore;
let status;                      // 'playing' | 'paused' | 'over'
let gravityTimer, clearing;

// Eingabe
const held = { left: false, right: false, down: false };
let lastDir = 0, repeatDir = 0, dasTimer = 0, arrTimer = 0;

highscore = loadHighscore();

/* =========================================================
   LOGIK
   ========================================================= */
function emptyRow() { return new Array(COLS).fill(null); }

function loadHighscore() {
  try { return parseInt(localStorage.getItem(STORAGE_KEY), 10) || 0; }
  catch (e) { return 0; }
}

function saveHighscore() {
  try { localStorage.setItem(STORAGE_KEY, String(highscore)); } catch (e) { /* ignorieren */ }
}

// 7-Bag: jeder Beutel enthält alle 7 Steine in zufälliger Reihenfolge
function newBag() {
  const bag = TYPES.slice();
  for (let i = bag.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [bag[i], bag[j]] = [bag[j], bag[i]];
  }
  return bag;
}

function takeFromQueue() {
  while (queue.length < NEXT_COUNT + 1) queue.push(...newBag());
  return queue.shift();
}

function collides(matrix, x, y) {
  for (let r = 0; r < matrix.length; r++) {
    for (let c = 0; c < matrix[r].length; c++) {
      if (!matrix[r][c]) continue;
      const nx = x + c, ny = y + r;
      if (nx < 0 || nx >= COLS || ny >= ROWS) return true;
      if (ny >= 0 && board[ny][nx]) return true;
    }
  }
  return false;
}

function rotateMatrix(m, dir) {
  const n = m.length;
  const res = m.map(() => new Array(n).fill(0));
  for (let r = 0; r < n; r++) {
    for (let c = 0; c < n; c++) {
      if (dir > 0) res[c][n - 1 - r] = m[r][c];   // im Uhrzeigersinn
      else res[n - 1 - c][r] = m[r][c];           // gegen den Uhrzeigersinn
    }
  }
  return res;
}

function spawnPiece(type) {
  const matrix = SHAPES[type].map((row) => row.slice());
  const firstRow = matrix.findIndex((row) => row.some(Boolean));
  current = {
    type, matrix,
    x: Math.floor((COLS - matrix[0].length) / 2),
    y: -firstRow,
  };
  gravityTimer = 0;
  if (collides(current.matrix, current.x, current.y)) gameOver();
}

function spawnNext() {
  canHold = true;
  spawnPiece(takeFromQueue());
}

function move(dx, dy) {
  if (collides(current.matrix, current.x + dx, current.y + dy)) return false;
  current.x += dx;
  current.y += dy;
  return true;
}

function rotate(dir) {
  if (current.type === 'O') return;
  const rotated = rotateMatrix(current.matrix, dir);
  for (const [dx, dy] of KICKS) {
    if (!collides(rotated, current.x + dx, current.y + dy)) {
      current.matrix = rotated;
      current.x += dx;
      current.y += dy;
      return;
    }
  }
}

function ghostY() {
  let y = current.y;
  while (!collides(current.matrix, current.x, y + 1)) y++;
  return y;
}

function hardDrop() {
  while (move(0, 1)) { /* bis zum Boden fallen */ }
  lockPiece();
}

function holdPiece() {
  if (!canHold) return;
  const type = current.type;
  if (hold) {
    const swap = hold;
    hold = type;
    spawnPiece(swap);
  } else {
    hold = type;
    spawnPiece(takeFromQueue());
  }
  canHold = false;
}

function lockPiece() {
  let overTop = false;
  current.matrix.forEach((row, r) => row.forEach((v, c) => {
    if (!v) return;
    const by = current.y + r, bx = current.x + c;
    if (by < 0) overTop = true;
    else board[by][bx] = current.type;
  }));
  current = null;
  if (overTop) { gameOver(); return; }

  const full = [];
  for (let r = 0; r < ROWS; r++) if (board[r].every(Boolean)) full.push(r);

  if (full.length) clearing = { rows: full, elapsed: 0 };
  else spawnNext();
}

function finishClear() {
  const n = clearing.rows.length;
  board = board.filter((_, i) => !clearing.rows.includes(i));
  while (board.length < ROWS) board.unshift(emptyRow());

  score += LINE_POINTS[n] * level;
  lines += n;
  level = 1 + Math.floor(lines / LINES_PER_LEVEL);
  if (score > highscore) { highscore = score; saveHighscore(); }

  clearing = null;
  updateStats();
  spawnNext();
}

function gravityMs() {
  const l = level - 1;
  return Math.max(50, 1000 * Math.pow(0.8 - l * 0.007, l));
}

function gameOver() {
  status = 'over';
  if (score > highscore) highscore = score;
  saveHighscore();
  updateStats();
  showOverlay('Game Over', 'Punkte: ' + score.toLocaleString('de-DE'), false);
}

function togglePause() {
  if (status === 'playing') {
    status = 'paused';
    showOverlay('Pause', 'Punkte ' + score.toLocaleString('de-DE') + ' · Level ' + level + ' · Zeilen ' + lines, true);
  } else if (status === 'paused') {
    status = 'playing';
    hideOverlay();
  }
}

function reset() {
  board = Array.from({ length: ROWS }, emptyRow);
  queue = [];
  hold = null;
  canHold = true;
  score = 0; level = 1; lines = 0;
  clearing = null;
  status = 'playing';
  dasTimer = arrTimer = 0;
  hideOverlay();
  updateStats();
  spawnNext();
}

function updateStats() {
  ui.score.textContent = score.toLocaleString('de-DE');
  ui.level.textContent = level;
  ui.lines.textContent = lines;
  ui.highscore.textContent = highscore.toLocaleString('de-DE');
}

// paused = true: Pause-Menü mit Tastenübersicht und "Fortsetzen"; sonst Game Over
function showOverlay(title, text, paused) {
  ui.title.textContent = title;
  ui.text.textContent = text;
  ui.keys.classList.toggle('hidden', !paused);
  ui.resume.classList.toggle('hidden', !paused);
  ui.restart.classList.toggle('primary', !paused);
  ui.overlay.classList.remove('hidden');
}

function hideOverlay() { ui.overlay.classList.add('hidden'); }

/* =========================================================
   RENDERING
   ========================================================= */
function drawCell(ctx, px, py, s, color) {
  ctx.save();
  ctx.shadowColor = color;
  ctx.shadowBlur = 8;
  ctx.fillStyle = color;
  ctx.fillRect(px + 1, py + 1, s - 2, s - 2);
  ctx.shadowBlur = 0;

  const b = Math.max(2, Math.round(s * 0.15));
  ctx.fillStyle = 'rgba(255,255,255,0.35)';           // Highlight oben/links
  ctx.fillRect(px + 1, py + 1, s - 2, b);
  ctx.fillRect(px + 1, py + 1, b, s - 2);
  ctx.fillStyle = 'rgba(0,0,0,0.35)';                 // Schatten unten/rechts
  ctx.fillRect(px + 1, py + s - 1 - b, s - 2, b);
  ctx.fillRect(px + s - 1 - b, py + 1, b, s - 2);
  ctx.restore();
}

function drawGhostCell(px, py, color) {
  bctx.save();
  bctx.globalAlpha = 0.15;
  bctx.fillStyle = color;
  bctx.fillRect(px + 1, py + 1, CELL - 2, CELL - 2);
  bctx.globalAlpha = 0.6;
  bctx.strokeStyle = color;
  bctx.lineWidth = 2;
  bctx.strokeRect(px + 2, py + 2, CELL - 4, CELL - 4);
  bctx.restore();
}

function drawBoard() {
  bctx.fillStyle = '#0a0d1c';
  bctx.fillRect(0, 0, BOARD_W, BOARD_H);

  // dezentes Raster
  bctx.strokeStyle = 'rgba(255,255,255,0.05)';
  bctx.lineWidth = 1;
  bctx.beginPath();
  for (let c = 1; c < COLS; c++) { bctx.moveTo(c * CELL + 0.5, 0); bctx.lineTo(c * CELL + 0.5, BOARD_H); }
  for (let r = 1; r < ROWS; r++) { bctx.moveTo(0, r * CELL + 0.5); bctx.lineTo(BOARD_W, r * CELL + 0.5); }
  bctx.stroke();

  // fest gewordene Steine
  for (let r = 0; r < ROWS; r++) {
    for (let c = 0; c < COLS; c++) {
      if (board[r][c]) drawCell(bctx, c * CELL, r * CELL, CELL, COLORS[board[r][c]]);
    }
  }

  // Ghost + aktiver Stein
  if (current) {
    const gy = ghostY();
    current.matrix.forEach((row, r) => row.forEach((v, c) => {
      if (v && gy + r >= 0) drawGhostCell((current.x + c) * CELL, (gy + r) * CELL, COLORS[current.type]);
    }));
    current.matrix.forEach((row, r) => row.forEach((v, c) => {
      if (v && current.y + r >= 0) drawCell(bctx, (current.x + c) * CELL, (current.y + r) * CELL, CELL, COLORS[current.type]);
    }));
  }

  // Animation beim Zeilenlöschen: weißes Blinken
  if (clearing) {
    const on = Math.floor((clearing.elapsed / CLEAR_MS) * 6) % 2 === 0;
    bctx.fillStyle = on ? 'rgba(255,255,255,0.85)' : 'rgba(255,255,255,0.25)';
    clearing.rows.forEach((r) => bctx.fillRect(0, r * CELL, BOARD_W, CELL));
  }
}

// Zeichnet einen Stein zentriert in eine Box (für Hold und Next)
function drawPreview(ctx, type, ox, oy, w, h, alpha) {
  const m = SHAPES[type];
  let minR = 9, maxR = -1, minC = 9, maxC = -1;
  m.forEach((row, r) => row.forEach((v, c) => {
    if (!v) return;
    minR = Math.min(minR, r); maxR = Math.max(maxR, r);
    minC = Math.min(minC, c); maxC = Math.max(maxC, c);
  }));
  const px = ox + (w - (maxC - minC + 1) * PREVIEW_CELL) / 2;
  const py = oy + (h - (maxR - minR + 1) * PREVIEW_CELL) / 2;

  ctx.save();
  ctx.globalAlpha = alpha;
  m.forEach((row, r) => row.forEach((v, c) => {
    if (v) drawCell(ctx, px + (c - minC) * PREVIEW_CELL, py + (r - minR) * PREVIEW_CELL, PREVIEW_CELL, COLORS[type]);
  }));
  ctx.restore();
}

function drawSidePanels() {
  hctx.clearRect(0, 0, 120, 120);
  if (hold) drawPreview(hctx, hold, 0, 0, 120, 120, canHold ? 1 : 0.35);

  nctx.clearRect(0, 0, 120, 300);
  for (let i = 0; i < NEXT_COUNT; i++) drawPreview(nctx, queue[i], 0, i * 100, 120, 100, 1);
}

function render() {
  drawBoard();
  drawSidePanels();
}

/* =========================================================
   INPUT
   ========================================================= */
function canAct() { return status === 'playing' && !clearing && current; }

function press(action) {
  if (action === 'pause') { togglePause(); return; }
  if (action === 'restart') { reset(); return; }

  if (action in held) {
    held[action] = true;
    if (action === 'left') lastDir = -1;
    if (action === 'right') lastDir = 1;
    if (canAct()) {
      if (action === 'left') move(-1, 0);
      if (action === 'right') move(1, 0);
    }
    return;
  }

  if (!canAct()) return;
  if (action === 'rotateCW') rotate(1);
  else if (action === 'rotateCCW') rotate(-1);
  else if (action === 'hard') hardDrop();
  else if (action === 'hold') holdPiece();
}

function release(action) {
  if (action in held) held[action] = false;
}

document.addEventListener('keydown', (e) => {
  if (e.ctrlKey || e.metaKey || e.altKey) return;
  const action = KEY_ACTIONS[e.key.toLowerCase()];
  if (!action) return;
  e.preventDefault();
  if (e.repeat) return;           // Auto-Repeat übernimmt das Spiel selbst (DAS/ARR)
  press(action);
});

document.addEventListener('keyup', (e) => {
  const action = KEY_ACTIONS[e.key.toLowerCase()];
  if (action) release(action);
});

// Hängende Tasten verhindern, wenn das Fenster den Fokus verliert
window.addEventListener('blur', () => { held.left = held.right = held.down = false; });

// Touch-Buttons
document.querySelectorAll('.touch button').forEach((btn) => {
  const action = btn.dataset.action;
  btn.addEventListener('pointerdown', (e) => { e.preventDefault(); press(action); });
  ['pointerup', 'pointercancel', 'pointerleave'].forEach((ev) =>
    btn.addEventListener(ev, () => release(action)));
  btn.addEventListener('contextmenu', (e) => e.preventDefault());
});

// Buttons im Overlay (Fokus abgeben, damit Leertaste/Enter nicht den Button auslösen)
ui.resume.addEventListener('click', () => {
  ui.resume.blur();
  if (status === 'paused') togglePause();
});
ui.restart.addEventListener('click', () => {
  ui.restart.blur();
  reset();
});

// DAS / ARR für links und rechts
function updateHorizontal(dt) {
  const dir = held.left && held.right ? lastDir : held.left ? -1 : held.right ? 1 : 0;
  if (dir !== repeatDir) { repeatDir = dir; dasTimer = 0; arrTimer = 0; return; }
  if (!dir) return;
  dasTimer += dt;
  if (dasTimer >= DAS) {
    arrTimer += dt;
    while (arrTimer >= ARR) {
      arrTimer -= ARR;
      if (!move(dir, 0)) break;
    }
  }
}

/* =========================================================
   GAME LOOP
   ========================================================= */
function update(dt) {
  if (status !== 'playing') return;

  if (clearing) {
    clearing.elapsed += dt;
    if (clearing.elapsed >= CLEAR_MS) finishClear();
    return;
  }

  updateHorizontal(dt);

  const interval = held.down ? Math.min(gravityMs(), SOFT_DROP_MS) : gravityMs();
  gravityTimer += dt;
  while (gravityTimer >= interval) {
    gravityTimer -= interval;
    if (!move(0, 1)) { lockPiece(); break; }
  }
}

let lastTime = performance.now();
function frame(now) {
  const dt = Math.min(now - lastTime, 100);   // große Sprünge (z. B. Tab-Wechsel) abfangen
  lastTime = now;
  update(dt);
  render();
  requestAnimationFrame(frame);
}

reset();
requestAnimationFrame(frame);