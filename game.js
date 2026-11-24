'use strict';
// 오락실 튜토리얼이 '진짜로 일어난 일'을 알아채는 신호 (arcade/public/tutorial.js 가 듣는다. 튜토리얼이 아니면 아무도 안 듣는다)
const tutorialSignal = (type) => window.dispatchEvent(new CustomEvent('arcade:tutorial', { detail: { type } }));

// 쿼토: 화면·입력·소리. 규칙과 컴퓨터는 logic.js (LOGIC_QT)
(() => {
const L = LOGIC_QT;
const $ = (id) => document.getElementById(id);
const TUT = /[?&]tutorial=1/.test(location.search);
const REC_KEY = 'quartoRec', WINS_KEY = 'quartoWins', MUTE_KEY = 'quartoMuted';
const LEVELS = [{ id: 'easy', name: '쉬움', desc: '위험한 말을 자주 건네요' }, { id: 'normal', name: '보통', desc: '바로 지는 말은 안 줘요' }, { id: 'hard', name: '어려움', desc: '몇 수 앞을 내다봐요' }];
const store = { get(k) { try { return localStorage.getItem(k); } catch (_) { return null; } }, set(k, v) { try { localStorage.setItem(k, v); } catch (_) {} } };
let rec = (() => { try { const o = JSON.parse(store.get(REC_KEY) || '{}'); return o && typeof o === 'object' ? o : {}; } catch (_) { return {}; } })();
let muted = store.get(MUTE_KEY) === '1';
const saveRec = () => { store.set(REC_KEY, JSON.stringify(rec)); store.set(WINS_KEY, String(Object.values(rec).reduce((a, r) => a + (r.w || 0), 0))); };

// ---------- 소리 ----------
let audio = null;
function tone(freq, dur, type = 'sine', vol = 0.08, slide = 0) {
  if (muted) return;
  try {
    audio = audio || new (window.AudioContext || window.webkitAudioContext)();
    const t = audio.currentTime, o = audio.createOscillator(), gn = audio.createGain();
    o.type = type; o.frequency.setValueAtTime(freq, t);
    if (slide) o.frequency.exponentialRampToValueAtTime(Math.max(40, freq + slide), t + dur);
    gn.gain.setValueAtTime(vol, t); gn.gain.exponentialRampToValueAtTime(0.001, t + dur);
    o.connect(gn).connect(audio.destination); o.start(t); o.stop(t + dur);
  } catch (_) {}
}
const seq = (notes, step, type = 'triangle', vol = 0.09) => notes.forEach((f, i) => setTimeout(() => tone(f, step * 0.0009, type, vol), i * step));
const sfx = { place: () => tone(380, 0.08, 'triangle', 0.08, -80), pick: () => tone(640, 0.05, 'sine', 0.06), give: () => tone(520, 0.08, 'triangle', 0.07, 120), bad: () => tone(160, 0.14, 'square', 0.06), win: () => seq([523, 659, 784, 1046, 1318], 120), lose: () => seq([392, 330, 262], 150, 'sawtooth', 0.07), draw: () => seq([440, 440], 160), toggle: () => tone(660, 0.05, 'sine', 0.06) };

// ---------- 상태 ----------
let g = null, level = 'normal', phase = 'title', pick = -1, fresh = -1, showDanger = false, helped = false, played = 0, timers = [];
const later = (fn, ms) => { const t = setTimeout(fn, ms); timers.push(t); return t; };
const clearTimers = () => { timers.forEach(clearTimeout); timers = []; };
const setMsg = (t) => { $('msg').innerHTML = t; };
const pieceEl = (p) => { const d = document.createElement('div'); d.className = 'pc' + (p & 1 ? ' tall' : '') + (p & 2 ? ' blue' : '') + (p & 4 ? ' sq' : '') + (p & 8 ? ' hole' : ''); return d; };
const pieceName = (p) => L.ATTRS.map((a) => (p & a.bit ? a.yes : a.no)).join(' · ');
const myPlace = () => phase === 'play' && !g.over && g.turn === 'you' && g.stage === 'place';
const myGive = () => phase === 'play' && !g.over && g.turn === 'you' && g.stage === 'give';

function startGame(lv) {
  clearTimers(); level = lv; pick = -1; fresh = -1; showDanger = false; helped = false;
  const first = TUT ? 'cpu' : (played++ % 2 === 0 ? 'cpu' : 'you'); // 판마다 번갈아 먼저 말을 준다
  g = L.newGame({ seed: TUT ? 4 : (Date.now() % 99991) + 1, level: TUT ? 'tutor' : lv, first, tutorial: TUT });
  phase = 'play'; $('overlay').classList.add('hidden'); render();
  setMsg(first === 'cpu' ? '컴퓨터가 먼저 <b>내가 놓을 말</b>을 골라 줘요.' : '내가 먼저예요. 아래에서 <b>컴퓨터가 놓을 말</b>을 골라 주세요.');
  next();
}

function next() {
  if (phase !== 'play') return;
  if (g.over) return end();
  render();
  if (g.turn === 'cpu') later(cpuAct, TUT ? 650 : 750);
}
function cpuAct() {
  if (phase !== 'play' || g.over || g.turn !== 'cpu') return;
  const pl = L.cpuPlan(g);
  if (g.stage === 'give') { L.give(g, 'cpu', pl.give); sfx.give(); setMsg('컴퓨터가 골라 준 말을 <b>판의 빈 칸</b>에 놓아요.'); return next(); }
  const r = L.place(g, 'cpu', pl.cell); fresh = pl.cell; sfx.place();
  if (r.over) return end();
  render(); setMsg('컴퓨터가 말을 놓았어요. 이제 나에게 줄 말을 골라요…');
  later(() => {
    if (phase !== 'play' || g.over) return;
    L.give(g, 'cpu', pl.give >= 0 && g.pool.includes(pl.give) ? pl.give : g.pool[0]); sfx.give();
    const wins = L.winningCells(g.board, g.hand).length;
    setMsg(wins ? '받은 말을 놓을 칸을 골라요. <b>이길 수 있는 칸이 있을지도?</b>' : '받은 말을 <b>빈 칸</b>에 놓아요. 다음에 줄 말도 생각해요!');
    next();
  }, TUT ? 500 : 650);
}

function render() {
  const b = $('board'); b.innerHTML = '';
  for (let i = 0; i < L.CELLS; i++) {
    const c = document.createElement('div'); c.className = 'cell'; c.dataset.i = i;
    if (g.board[i] >= 0) c.appendChild(pieceEl(g.board[i]));
    else if (myPlace()) c.classList.add('can');
    if (g.line && g.line.includes(i)) c.classList.add('win');
    if (i === fresh) c.classList.add('fresh');
    c.onclick = () => tapCell(i); b.appendChild(c);
  }
  const pool = $('pool'); pool.innerHTML = '';
  const danger = showDanger && myGive() ? new Set(g.pool.filter((p) => L.winningCells(g.board, p).length)) : new Set();
  for (let p = 0; p < L.PIECES; p++) {
    const s = document.createElement('div'); s.className = 'slot'; s.dataset.p = p;
    if (!g.pool.includes(p)) s.classList.add('used'); else s.appendChild(pieceEl(p));
    if (p === pick) s.classList.add('sel');
    if (danger.has(p)) s.classList.add('danger');
    s.onclick = () => tapPiece(p); pool.appendChild(s);
  }
  const hb = $('handBox'); hb.innerHTML = ''; if (g.hand >= 0) hb.appendChild(pieceEl(g.hand));
  $('leftCnt').textContent = g.pool.length; $('lvLabel').textContent = TUT ? '연습' : (LEVELS.find((l) => l.id === level) || {}).name || '';
  $('giveBtn').disabled = !myGive() || pick < 0; $('dangerBtn').disabled = phase !== 'play'; $('dangerBtn').classList.toggle('on', showDanger);
  let t = '';
  if (phase === 'play' && !g.over) {
    if (myPlace()) t = '<b>이 말</b>을 놓을 빈 칸을 눌러요';
    else if (myGive()) t = pick >= 0 ? '<b>이 말 주기</b>를 누르면 컴퓨터가 놓아요' : '컴퓨터가 놓을 말을 <b>아래에서</b> 골라요';
    else t = g.stage === 'place' ? '컴퓨터가 <b>이 말</b>을 놓는 중…' : '컴퓨터가 줄 말을 고르는 중…';
  }
  if (phase === 'play') $('bannerText').innerHTML = t;
}

function tapCell(i) {
  if (!myPlace()) return;
  const r = L.place(g, 'you', i);
  if (!r.ok) { sfx.bad(); setMsg('이미 말이 있는 칸이에요.'); return; }
  sfx.place(); fresh = i; pick = -1; tutorialSignal('place');
  if (r.over) return end();
  setMsg('잘 놓았어요! 이제 <b>컴퓨터가 놓을 말</b>을 아래에서 골라요. 컴퓨터가 <b>쿼토</b>를 만들 수 있는 말은 주면 안 돼요!');
  next();
}
function tapPiece(p) {
  if (!myGive()) { if (phase === 'play' && !g.over && g.turn === 'you') setMsg('먼저 받은 말을 <b>판에 놓아요</b>.'); return; }
  if (!g.pool.includes(p)) return;
  pick = pick === p ? -1 : p; sfx.pick(); if (pick >= 0) tutorialSignal('pick');
  render();
  if (pick >= 0) setMsg('고른 말: <b>' + pieceName(p) + '</b>' + (showDanger && L.winningCells(g.board, p).length ? ' — ✖ 이 말을 주면 컴퓨터가 바로 이겨요!' : ''));
}
function giveNow() {
  if (!myGive() || pick < 0) return;
  const p = pick; pick = -1; fresh = -1;
  L.give(g, 'you', p); sfx.give(); tutorialSignal('give');
  setMsg('컴퓨터가 <b>' + pieceName(p) + '</b> 말을 놓을 자리를 찾아요…');
  next();
}

function end() {
  phase = 'over'; clearTimers(); pick = -1; render();
  const w = g.winner, r = rec[level] = rec[level] || { w: 0, l: 0, d: 0 };
  const counted = !TUT && !helped;
  if (counted) { if (w === 'you') r.w++; else if (w === 'cpu') r.l++; else r.d++; saveRec(); }
  w === 'you' ? sfx.win() : w === 'cpu' ? sfx.lose() : sfx.draw();
  const what = g.line ? L.describeLine(g.board, g.line) : '';
  $('bannerText').innerHTML = w === 'you' ? '🎉 <b>쿼토!</b> 내가 이겼어요' : w === 'cpu' ? '😢 컴퓨터의 <b>쿼토!</b>' : '🤝 판이 가득 찼어요';
  $('handBox').innerHTML = '';
  setMsg(g.line ? '노란 줄 네 말이 모두 <b>' + what + '</b>!' : '어느 줄도 공통점이 없어서 <b>무승부</b>예요.');
  tutorialSignal('over');
  later(() => {
    const ov = $('overlay'); ov.classList.remove('hidden');
    const why = w === 'you' ? '내가 놓은 말로 <b>' + what + '</b> 줄을 완성했어요!' : w === 'cpu' ? '내가 준 말로 컴퓨터가 <b>' + what + '</b> 줄을 완성했어요.' : '16개를 다 놓았는데 쿼토가 없었어요.';
    ov.innerHTML = '<h1>' + (w === 'you' ? '🎉 승리!' : w === 'cpu' ? '😢 패배' : '🤝 무승부') + '</h1><p>' + why + '</p>' + (helped && !TUT ? '<p>위험한 말 표시를 켠 판이라 전적에는 넣지 않았어요.</p>' : '') +
      '<div class="col"><button id="againBtn">한 판 더</button><button class="sub" id="seeBtn">판 다시 보기</button><button class="sub" id="titleBtn">처음으로</button></div>';
    $('againBtn').onclick = () => startGame(level); $('titleBtn').onclick = showTitle; $('seeBtn').onclick = () => ov.classList.add('hidden');
  }, 1500);
}

function legend() {
  const one = (p, t) => '<span>' + pieceEl(p).outerHTML + t + '</span>';
  return '<div class="legend">' + one(1, '큰 말') + one(0, '작은 말') + one(2, '파랑') + one(0, '주황') + one(4, '네모') + one(0, '동그라미') + one(8, '구멍 있음') + one(0, '꽉 참') + '</div>';
}
function showTitle() {
  clearTimers(); phase = 'title';
  const ov = $('overlay'); ov.classList.remove('hidden');
  const rules = '<p>말 16개는 <b>크기·색·모양·구멍</b> 네 가지가 모두 달라요. 내가 놓을 말은 <b>상대가 골라 주고</b>, 나는 놓은 뒤 <b>상대가 놓을 말</b>을 골라 줘요.<br>가로·세로·대각선 한 줄 <b>4개가 한 가지라도 같으면</b>(모두 큰 말, 모두 파랑…) 놓은 사람이 <b>쿼토!</b>로 이겨요. 그래서 상대가 쿼토를 만들 수 있는 말은 주면 안 돼요.</p>';
  if (TUT) { ov.innerHTML = '<h1>🔷 쿼토</h1>' + rules + legend() + '<div class="col"><button id="b1">시작하기</button></div>'; $('b1').onclick = () => startGame('easy'); if (g) render(); return; }
  ov.innerHTML = '<h1>🔷 쿼토</h1>' + rules + legend() +
    '<div class="col" id="lv">' + LEVELS.map((l) => '<button data-lv="' + l.id + '">' + l.name + '<small>' + l.desc + (rec[l.id] ? ' · ' + (rec[l.id].w || 0) + '승 ' + (rec[l.id].l || 0) + '패' : '') + '</small></button>').join('') + '</div>';
  ov.querySelectorAll('#lv button').forEach((b) => { b.onclick = () => startGame(b.dataset.lv); });
  if (g) render();
}

$('giveBtn').onclick = giveNow;
$('dangerBtn').onclick = () => { if (phase !== 'play') return; showDanger = !showDanger; if (showDanger) helped = true; sfx.toggle(); render(); setMsg(showDanger ? '줄 차례에 <b>주면 바로 지는 말</b>에 ✖ 가 붙어요. (이 판은 전적에 안 들어가요)' : '위험한 말 표시를 껐어요.'); };
$('homeBtn').onclick = showTitle;
$('muteBtn').onclick = () => { muted = !muted; store.set(MUTE_KEY, muted ? '1' : '0'); $('muteBtn').textContent = muted ? '🔇' : '🔊'; };
$('muteBtn').textContent = muted ? '🔇' : '🔊';
addEventListener('keydown', (e) => { if (e.key === 'm' || e.key === 'M') $('muteBtn').click(); else if (e.key === 'Enter') giveNow(); });
/* @test-hooks:start */
window.__qt = { get g() { return g; }, get phase() { return phase; }, startGame, cpuAct, render };
/* @test-hooks:end */

g = L.newGame({ seed: 1 }); phase = 'title'; render(); $('bannerText').textContent = ''; showTitle();
})();
