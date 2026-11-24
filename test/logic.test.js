'use strict';

// 쿼토 규칙·컴퓨터 시험. 실행: node --test (디렉터리)
const test = require('node:test');
const assert = require('node:assert');
const L = require('../logic.js');

const empty = () => new Array(L.CELLS).fill(-1);

test('common: shared attribute found for both set and unset bits', () => {
  assert.strictEqual(L.common([1, 3, 5, 9]), 1);          // all tall
  assert.strictEqual(L.common([0, 2, 4, 6]), 1 | 8);      // all short and all solid
  assert.strictEqual(L.common([0, 15, 3, 12]), 0);        // nothing shared
  assert.strictEqual(L.common([1, 3, 5, -1]), 0);         // line not full
});

test('lines: 4 rows 4 columns 2 diagonals', () => {
  assert.strictEqual(L.LINES.length, 10);
  const b = empty(); [0, 5, 10, 15].forEach((c, k) => { b[c] = [1, 3, 5, 7][k]; });
  assert.deepStrictEqual(L.winLineAt(b, 10), [0, 5, 10, 15]);
  const b2 = empty(); [3, 6, 9, 12].forEach((c, k) => { b2[c] = [0, 2, 4, 6][k]; });
  assert.deepStrictEqual(L.winLineAt(b2, 6), [3, 6, 9, 12]);
});

test('flow: give then place, placer gives next, wrong turn and used piece refused', () => {
  const g = L.newGame({ first: 'cpu' });
  assert.strictEqual(L.give(g, 'you', 0).ok, false);
  assert.ok(L.give(g, 'cpu', 5).ok);
  assert.strictEqual(g.turn, 'you'); assert.strictEqual(g.stage, 'place'); assert.strictEqual(g.hand, 5);
  assert.strictEqual(L.give(g, 'you', 1).ok, false);
  assert.ok(L.place(g, 'you', 0).ok);
  assert.strictEqual(g.stage, 'give'); assert.strictEqual(g.turn, 'you');
  assert.strictEqual(L.give(g, 'you', 5).ok, false);      // already used
  assert.ok(L.give(g, 'you', 6).ok);
  assert.strictEqual(L.place(g, 'cpu', 0).err, 'occupied');
  assert.ok(L.place(g, 'cpu', 1).ok);
});

test('win: placer who completes a shared line wins and line is recorded', () => {
  const g = L.newGame({ first: 'cpu' });
  g.board[0] = 1; g.board[1] = 3; g.board[2] = 5; g.pool = g.pool.filter((p) => ![1, 3, 5].includes(p));
  L.give(g, 'cpu', 9);
  const r = L.place(g, 'you', 3);
  assert.ok(r.win); assert.strictEqual(g.winner, 'you'); assert.deepStrictEqual(g.line, [0, 1, 2, 3]);
  assert.strictEqual(L.describeLine(g.board, g.line), '큰 말');
});

test('draw: full board with no shared line', () => {
  // 공통점 없는 배치를 찾는다(고정 난수)
  const rng = L.mulberry32(7); let board = null;
  for (let t = 0; t < 20000 && !board; t++) {
    const b = Array.from({ length: 16 }, (_, i) => i);
    for (let i = 15; i > 0; i--) { const j = Math.floor(rng() * (i + 1)); [b[i], b[j]] = [b[j], b[i]]; }
    if (!L.anyWin(b)) board = b;
  }
  assert.ok(board, 'found a drawn arrangement');
  const g = L.newGame({ first: 'cpu' });
  board.forEach((p, i) => { if (i < 15) g.board[i] = p; }); g.pool = [board[15]];
  L.give(g, 'cpu', board[15]);
  const r = L.place(g, 'you', 15);
  assert.ok(r.draw); assert.strictEqual(g.winner, null);
});

test('cpu: takes an immediate win (normal and hard)', () => {
  for (const level of ['normal', 'hard']) {
    const g = L.newGame({ first: 'you', level, seed: 3 });
    g.board[4] = 0; g.board[5] = 2; g.board[6] = 4; g.pool = g.pool.filter((p) => ![0, 2, 4].includes(p));
    L.give(g, 'you', 6);
    const pl = L.cpuPlan(g);
    assert.strictEqual(pl.cell, 7, level);
  }
});

test('cpu: normal and hard never hand over a winning piece when a safe one exists', () => {
  for (const level of ['normal', 'hard']) for (let s = 1; s <= 15; s++) {
    const g = L.newGame({ first: 'you', level, seed: s }); const rng = L.mulberry32(s);
    while (!g.over) {
      if (g.turn === 'you') {
        if (g.stage === 'give') L.give(g, 'you', g.pool[Math.floor(rng() * g.pool.length)]);
        else { const e = g.board.map((v, i) => (v < 0 ? i : -1)).filter((i) => i >= 0); L.place(g, 'you', e[Math.floor(rng() * e.length)]); }
        continue;
      }
      const pl = L.cpuPlan(g);
      if (g.stage === 'give') { L.give(g, 'cpu', pl.give); continue; }
      L.place(g, 'cpu', pl.cell); if (g.over) break;
      const safe = L.safePieces(g.board, g.pool);
      if (safe.length) assert.ok(safe.includes(pl.give), level + ' seed ' + s);
      L.give(g, 'cpu', pl.give);
    }
  }
});

test('cpu: tutor never wins on its own and offers a winning piece when it can', () => {
  const g = L.newGame({ first: 'you', level: 'tutor', seed: 2 });
  g.board[0] = 1; g.board[1] = 3; g.board[2] = 5; g.pool = g.pool.filter((p) => ![1, 3, 5].includes(p));
  L.give(g, 'you', 7);                                   // 7 is tall: placing at 3 would win
  const pl = L.cpuPlan(g);
  assert.notStrictEqual(pl.cell, 3);
  const b = g.board.slice(); b[pl.cell] = 7;
  assert.ok(L.winningCells(b, pl.give).length > 0);
});

test('levels: stronger computer wins more (fixed seeds, sides alternate)', () => {
  const score = (a, b, n) => { let wa = 0, wb = 0; for (let i = 0; i < n; i++) { const r = L.playout(a, b, 100 + i, i % 2 === 0); if (r === 'a') wa++; else if (r === 'b') wb++; } return [wa, wb]; };
  const [n1, e1] = score('normal', 'easy', 16); assert.ok(n1 > e1 * 2, `normal ${n1} easy ${e1}`);
  const [h1, n2] = score('hard', 'normal', 12); assert.ok(h1 > n2, `hard ${h1} normal ${n2}`);
});

test('playout: every game ends within 16 placements', () => {
  for (const lv of ['easy', 'normal', 'hard']) for (let s = 1; s <= 4; s++) {
    const r = L.playout(lv, lv, s, s % 2 === 0); assert.ok(r === 'a' || r === 'b' || r === null);
  }
});
