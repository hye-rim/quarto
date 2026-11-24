'use strict';
// 쿼토 규칙과 컴퓨터 (DOM 없음). 화면은 game.js
// 말 16개: 번호의 비트가 속성이다. 1 = 큰 말(아니면 작은 말), 2 = 파랑(아니면 주황), 4 = 네모(아니면 동그라미), 8 = 구멍 있음(아니면 꽉 참).
// 4×4 판. 내가 놓을 말은 상대가 골라 준다. 말을 놓아 한 줄(가로·세로·대각선) 4개가 속성 하나라도 같으면 놓은 사람이 이긴다.
const LOGIC_QT = (() => {
  const N = 4, CELLS = 16, PIECES = 16;
  const LEVELS = ['easy', 'normal', 'hard'];
  const ATTRS = [
    { bit: 1, yes: '큰 말', no: '작은 말' },
    { bit: 2, yes: '파랑', no: '주황' },
    { bit: 4, yes: '네모', no: '동그라미' },
    { bit: 8, yes: '구멍 있음', no: '꽉 참' },
  ];
  const LINES = [];
  for (let r = 0; r < N; r++) LINES.push([0, 1, 2, 3].map((c) => r * N + c));
  for (let c = 0; c < N; c++) LINES.push([0, 1, 2, 3].map((r) => r * N + c));
  LINES.push([0, 5, 10, 15], [3, 6, 9, 12]);
  const LINES_OF = Array.from({ length: CELLS }, (_, i) => LINES.filter((l) => l.includes(i)));
  const other = (s) => (s === 'you' ? 'cpu' : 'you');

  function mulberry32(a) { return function () { a |= 0; a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
  const shuffle = (a, rng) => { for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(rng() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };

  // 네 말이 함께 가진 속성(비트). 0 이면 공통점 없음
  function common(ps) {
    if (ps.some((p) => p < 0)) return 0;
    let and = 15, nor = 15;
    for (const p of ps) { and &= p; nor &= ~p; }
    return (and | nor) & 15;
  }
  // 이 칸을 지나는 줄 중 완성된 쿼토 줄. 없으면 null
  function winLineAt(board, cell) {
    for (const l of LINES_OF[cell]) { const ps = l.map((i) => board[i]); if (common(ps)) return l; }
    return null;
  }
  function anyWin(board) { for (const l of LINES) if (common(l.map((i) => board[i]))) return l; return null; }
  // 이 말을 놓으면 바로 이기는 칸들
  function winningCells(board, piece) {
    const out = [];
    for (let c = 0; c < CELLS; c++) { if (board[c] >= 0) continue; board[c] = piece; if (winLineAt(board, c)) out.push(c); board[c] = -1; }
    return out;
  }
  // 상대에게 줘도 바로 지지 않는 말들
  function safePieces(board, pool) { return pool.filter((p) => winningCells(board, p).length === 0); }
  // 줄이 무엇이 같은지 사람 말로
  function describe(bits) { return ATTRS.filter((a) => bits & a.bit).map((a) => a.yes).join(', '); }
  function describeLine(board, line) {
    const ps = line.map((i) => board[i]); let and = 15, nor = 15; for (const p of ps) { and &= p; nor &= ~p; }
    const words = []; for (const a of ATTRS) { if (and & a.bit) words.push(a.yes); else if (nor & a.bit) words.push(a.no); }
    return words.join(' · ');
  }

  // first: 먼저 말을 '골라 주는' 쪽. 그다음 상대가 그 말을 놓고, 놓은 쪽이 다음 말을 골라 준다
  function newGame(opts = {}) {
    const first = opts.first || 'cpu';
    return {
      board: new Array(CELLS).fill(-1), pool: Array.from({ length: PIECES }, (_, i) => i), hand: -1,
      turn: first, stage: 'give', over: false, winner: null, line: null, moves: 0,
      level: opts.level || 'normal', rng: mulberry32(opts.seed || 1), tutorial: !!opts.tutorial,
    };
  }
  function give(g, side, piece) {
    if (g.over) return { ok: false, err: 'over' };
    if (g.turn !== side || g.stage !== 'give') return { ok: false, err: 'turn' };
    if (!g.pool.includes(piece)) return { ok: false, err: 'piece' };
    g.pool = g.pool.filter((p) => p !== piece); g.hand = piece; g.turn = other(side); g.stage = 'place';
    return { ok: true };
  }
  function place(g, side, cell) {
    if (g.over) return { ok: false, err: 'over' };
    if (g.turn !== side || g.stage !== 'place') return { ok: false, err: 'turn' };
    if (!(cell >= 0 && cell < CELLS) || g.board[cell] >= 0) return { ok: false, err: 'occupied' };
    g.board[cell] = g.hand; g.hand = -1; g.moves++;
    const line = winLineAt(g.board, cell);
    if (line) { g.over = true; g.winner = side; g.line = line; return { ok: true, over: true, win: true }; }
    if (g.board.every((p) => p >= 0)) { g.over = true; g.winner = null; return { ok: true, over: true, draw: true }; }
    g.stage = 'give';
    return { ok: true };
  }

  // ---------- 컴퓨터 ----------
  // negamax: 'piece' 를 놓을 차례인 사람 입장의 값(+1 이김, 0 모름·무승부, -1 짐). depth = 앞으로 볼 '놓기' 수
  function makeSearch(budget) {
    let nodes = 0; const memo = new Map();
    function nm(board, piece, pool, depth) {
      nodes++;
      const empties = []; for (let c = 0; c < CELLS; c++) if (board[c] < 0) empties.push(c);
      for (const c of empties) { board[c] = piece; const w = winLineAt(board, c); board[c] = -1; if (w) return 1; }
      if (empties.length === 1 || depth <= 1 || nodes > budget) return 0;
      const key = depth >= 6 ? board.join(',') + '|' + piece : null;
      if (key && memo.has(key)) return memo.get(key);
      let best = -1;
      for (const c of empties) {
        board[c] = piece;
        const rest = pool;
        // 상대에게 바로 이기는 말을 주면 진다 → 안전한 말만 본다
        const safe = rest.filter((p) => winningCells(board, p).length === 0);
        let v;
        if (!safe.length) v = -1;
        else {
          v = -1;
          for (const p of safe) { const r = -nm(board, p, rest.filter((x) => x !== p), depth - 1); if (r > v) v = r; if (v === 1) break; }
        }
        board[c] = -1;
        if (v > best) best = v;
        if (best === 1) break;
      }
      if (key && nodes <= budget) memo.set(key, best);
      return best;
    }
    return { nm, get nodes() { return nodes; } };
  }
  const PARAMS = {
    easy: { missWin: 0.35, badGive: 0.4, depth: 0 },
    normal: { missWin: 0, badGive: 0, depth: 1 },
    hard: { missWin: 0, badGive: 0, depth: 3, full: 9, budget: 400000 },
  };

  // 놓을 칸 고르기(g.hand 를 놓는다). 놓은 다음 줄 말까지 함께 정한다 → { cell, give }
  function cpuPlan(g) {
    const rng = g.rng, P = PARAMS[g.level] || PARAMS.normal, board = g.board.slice(), piece = g.hand, pool = g.pool.slice();
    const empties = shuffle(board.map((v, i) => (v < 0 ? i : -1)).filter((i) => i >= 0), rng);
    // 연습: 컴퓨터는 이기지 않고, 사람이 이길 수 있는 말을 골라 준다
    if (g.level === 'tutor') {
      const noWin = empties.filter((c) => { board[c] = piece; const w = winLineAt(board, c); board[c] = -1; return !w; });
      const cell = noWin.length ? noWin[0] : empties[0]; board[cell] = piece;
      const pr = shuffle(pool.slice(), rng); const winner = pr.find((p) => winningCells(board, p).length);
      return { cell, give: pool.length ? (winner !== undefined ? winner : pr[0]) : -1 };
    }
    if (piece >= 0) {
      const wins = empties.filter((c) => { board[c] = piece; const w = winLineAt(board, c); board[c] = -1; return w; });
      if (wins.length && rng() >= P.missWin) return { cell: wins[0], give: -1 };
    }
    if (piece < 0) return { cell: -1, give: chooseGive(board, pool, P, rng) }; // 첫 수: 줄 말만 고른다
    if (P.depth === 0) {
      const cell = empties.find((c) => { board[c] = piece; const w = winLineAt(board, c); board[c] = -1; return !w; }) ?? empties[0];
      board[cell] = piece; return { cell, give: chooseGive(board, pool, P, rng) };
    }
    // (놓을 칸, 줄 말) 짝을 하나씩 해 본다
    const full = P.full && empties.length <= P.full;
    const S = makeSearch(full ? P.budget : 60000), depth = full ? 99 : P.depth;
    let best = null, bv = -2;
    for (const c of empties) {
      board[c] = piece;
      if (winLineAt(board, c)) { board[c] = -1; continue; } // 이길 수 있었는데 놓친 경우(쉬움)는 위에서 처리
      if (!pool.length) { board[c] = -1; if (bv < 0) { bv = 0; best = { cell: c, give: -1 }; } continue; }
      const order = shuffle(pool.slice(), rng);
      for (const p of order) {
        let v;
        if (winningCells(board, p).length) v = -1;
        else if (depth <= 1) v = 0 + safeCount(board, pool.filter((x) => x !== p), p) * 1e-3; // 보통: 안전하기만 하면 된다
        else v = -S.nm(board, p, pool.filter((x) => x !== p), depth - 1);
        if (v > bv) { bv = v; best = { cell: c, give: p }; }
        if (bv >= 1) break;
      }
      board[c] = -1;
      if (bv >= 1) break;
    }
    if (!best) { const c = empties[0]; board[c] = piece; return { cell: c, give: pool.length ? pool[0] : -1 }; }
    return best;
  }
  // 보통용 가벼운 맛: 상대가 이 말을 어디 놓든 내가 줄 안전한 말이 남는 정도(작은 보너스)
  function safeCount(board, rest, p) {
    let ok = 0, tot = 0;
    for (let c = 0; c < CELLS; c++) { if (board[c] >= 0) continue; board[c] = p; tot++; if (safePieces(board, rest).length) ok++; board[c] = -1; }
    return tot ? ok / tot : 0;
  }
  function chooseGive(board, pool, P, rng) {
    if (!pool.length) return -1;
    const order = shuffle(pool.slice(), rng);
    if (rng() < (P.badGive || 0)) return order[0];
    const safe = order.filter((p) => winningCells(board, p).length === 0);
    return safe.length ? safe[0] : order[0];
  }

  // 컴퓨터끼리 한 판(시험용): first 가 먼저 말을 준다. 돌려주는 값: 'a' | 'b' | null
  function playout(levelA, levelB, seed, aFirst = true) {
    const g = newGame({ seed, first: aFirst ? 'you' : 'cpu' }); const lv = { you: levelA, cpu: levelB };
    let guard = 0;
    while (!g.over && guard++ < 100) {
      g.level = lv[g.turn];
      if (g.stage === 'give') { const pl = cpuPlan(g); give(g, g.turn, pl.give); }
      else { const side = g.turn, pl = cpuPlan(g); place(g, side, pl.cell); if (!g.over) give(g, side, pl.give >= 0 && g.pool.includes(pl.give) ? pl.give : g.pool[0]); }
    }
    return g.winner === 'you' ? 'a' : g.winner === 'cpu' ? 'b' : null;
  }

  const api = { N, CELLS, PIECES, LEVELS, ATTRS, LINES, mulberry32, common, winLineAt, anyWin, winningCells, safePieces, describe, describeLine, newGame, give, place, cpuPlan, playout, other };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  return api;
})();
