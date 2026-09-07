import assert from 'node:assert/strict';
import test from 'node:test';

test('mini chess rejects off-board origins rather than aliasing another square', () => {
  const fen = '4k/5/5/5/R4/2K2 w - - 0 1';
  for (const from of ['f1', 'h1', 'a7', 'a0', 'aa', 'a10']) assert.deepEqual(legalMoves(fen, from), []);
});
import { boardFromFen, boardSize, engine, initialFen, legalMoves, miniInitialFen, moveNotation, play, playMove, status } from '../lib/chess.js';

test('initial position perft through depth 3', () => {
  function perft(fen, depth) {
    if (!depth) return 1;
    return legalMoves(fen).reduce((nodes, move) => nodes + perft(playMove(fen, move), depth - 1), 0);
  }
  for (const [depth, nodes] of [[1, 20], [2, 400], [3, 8902]]) {
    assert.equal(perft(initialFen, depth), nodes);
  }
});

test('mini chess parses a compact 5 by 6 board and has seven opening moves', () => {
  assert.deepEqual(boardSize(miniInitialFen), { width: 5, height: 6 });
  assert.equal(boardFromFen(miniInitialFen).length, 30);
  assert.deepEqual(legalMoves(miniInitialFen).map((move) => `${move.from}-${move.to}`).sort(), [
    'a2-a3', 'b1-a3', 'b1-c3', 'b2-b3', 'c2-c3', 'd2-d3', 'e2-e3',
  ]);
});

test('mini chess respects 5 by 6 bounds for sliders and knights', () => {
  assert.deepEqual(legalMoves('4k/5/5/2R2/5/4K w - - 0 1', 'c3').map((move) => move.to).sort(), [
    'a3', 'b3', 'c1', 'c2', 'c4', 'c5', 'c6', 'd3', 'e3',
  ]);
  assert.deepEqual(legalMoves('4k/5/2N2/5/5/4K w - - 0 1', 'c4').map((move) => move.to).sort(), [
    'a3', 'a5', 'b2', 'b6', 'd2', 'd6', 'e3', 'e5',
  ]);
  assert.equal(status('k4/5/5/5/5/R3K b - - 0 1'), 'check');
});

test('mini chess promotes on either last rank without double steps or en passant', () => {
  const white = legalMoves('4k/P4/5/5/5/1K3 w - - 0 1', 'a5');
  const black = legalMoves('4k/5/5/5/p4/4K b - - 0 1', 'a2');
  assert.deepEqual(white.map((move) => move.promotion), ['Q', 'R', 'B', 'N']);
  assert.deepEqual(black.map((move) => move.promotion), ['q', 'r', 'b', 'n']);
  assert.equal(boardFromFen(playMove('4k/P4/5/5/5/1K3 w - - 0 1', white[0]))[25], 'Q');
  assert.equal(boardFromFen(playMove('4k/5/5/5/p4/4K b - - 0 1', black[0]))[0], 'q');
  assert.deepEqual(legalMoves(miniInitialFen, 'a2').map((move) => move.to), ['a3']);
  assert.equal(legalMoves('4k/1P3/5/5/5/4K w - c6 0 1', 'b5').some((move) => move.enPassant), false);
});

test('mini chess engine returns a legal reply and stops at terminal boards', () => {
  for (const difficulty of ['easy', 'normal', 'hard']) {
    const reply = engine(miniInitialFen, difficulty);
    assert.ok(legalMoves(miniInitialFen).some((move) => JSON.stringify(move) === JSON.stringify(reply)));
    assert.equal(engine('k4/1Q3/2K2/5/5/5 b - - 0 1', difficulty), null);
  }
  assert.equal(status('k4/1Q3/2K2/5/5/5 b - - 0 1'), 'checkmate');
});

test('kingside castling cannot capture or overwrite an occupant on g1 or g8', () => {
  for (const fen of [
    '4k3/8/8/8/8/8/8/4K1nR w K - 0 1',
    '4k3/8/8/8/8/8/8/4K1NR w K - 0 1',
    '4k1Nr/8/8/8/8/8/8/4K3 b k - 0 1',
    '4k1nr/8/8/8/8/8/8/4K3 b k - 0 1',
  ]) {
    assert.equal(legalMoves(fen).some((move) => move.castle), false, fen);
  }
});

test('both colors can castle on either wing with an empty safe path', () => {
  for (const [fen, homeRank, king, rook] of [
    ['4k3/8/8/8/8/8/8/R3K2R w KQ - 0 1', 1, 'K', 'R'],
    ['r3k2r/8/8/8/8/8/8/4K3 b kq - 0 1', 8, 'k', 'r'],
  ]) {
    const castles = legalMoves(fen).filter((move) => move.castle);
    assert.deepEqual(castles.map((move) => move.to).sort(), [`c${homeRank}`, `g${homeRank}`]);
    for (const move of castles) {
      const kingside = move.to[0] === 'g';
      const board = boardFromFen(playMove(fen, move));
      const offset = (homeRank - 1) * 8;
      assert.equal(board[offset + (kingside ? 6 : 2)], king);
      assert.equal(board[offset + (kingside ? 5 : 3)], rook);
      assert.equal(board[offset + 4], null);
      assert.equal(board[offset + (kingside ? 7 : 0)], null);
      assert.equal(moveNotation(fen, move), kingside ? 'O-O' : 'O-O-O');
    }
  }
});

test('SAN disambiguates legal pieces and preserves captures, promotions and check suffixes', () => {
  for (const [fen, from, to, san] of [
    [initialFen, 'e2', 'e4', 'e4'],
    ['4k3/8/8/8/8/8/8/1N2KN2 w - - 0 1', 'b1', 'd2', 'Nbd2'],
    ['7k/8/8/8/8/R7/8/R6K w - - 0 1', 'a1', 'a2', 'R1a2'],
    ['4k3/8/8/8/8/1N6/8/1N2KN2 w - - 0 1', 'b1', 'd2', 'Nb1d2'],
    ['4r2k/8/8/8/8/8/R3R3/4K3 w - - 0 1', 'a2', 'c2', 'Rc2'],
    ['4k3/8/8/8/8/8/3p4/1N2KN2 w - - 0 1', 'b1', 'd2', 'Nbxd2'],
    ['4k3/8/8/3pP3/8/8/8/4K3 w - d6 0 1', 'e5', 'd6', 'exd6'],
    ['7k/P7/8/8/8/8/8/4K3 w - - 0 1', 'a7', 'a8', 'a8=Q+'],
    ['7k/8/5KQ1/8/8/8/8/8 w - - 0 1', 'g6', 'g7', 'Qg7#'],
    ['5k2/8/8/8/8/8/8/4K2R w K - 0 1', 'e1', 'g1', 'O-O+'],
    ['3k4/8/8/8/8/8/8/R3K3 w Q - 0 1', 'e1', 'c1', 'O-O-O+'],
    ['4k2r/8/8/8/8/8/8/5K2 b k - 0 1', 'e8', 'g8', 'O-O+'],
    ['r3k3/8/8/8/8/8/8/3K4 b q - 0 1', 'e8', 'c8', 'O-O-O+'],
    ['5k2/8/8/8/8/8/8/4K2R w K - 99 1', 'e1', 'g1', 'O-O+'],
  ]) {
    const move = legalMoves(fen, from).find((item) => item.to === to);
    assert.ok(move, `${from}-${to} in ${fen}`);
    assert.equal(moveNotation(fen, move), san, fen);
  }
});

for (const difficulty of ['easy', 'normal', 'hard']) {
  test(`${difficulty} engine returns legal moves for either color, including check evasions`, () => {
    for (const fen of [initialFen, play(initialFen, 'e2', 'e4'), '4r2k/8/8/8/8/8/8/4K3 w - - 0 1']) {
      const reply = engine(fen, difficulty);
      assert.ok(reply);
      assert.ok(legalMoves(fen).some((move) => JSON.stringify(move) === JSON.stringify(reply)), fen);
    }
  });

  test(`${difficulty} engine does not move at a terminal root`, () => {
    for (const [fen, outcome] of [
      ['7k/5K2/6Q1/8/8/8/8/8 b - - 0 1', 'draw'],
      ['4k3/8/8/8/8/8/8/4K3 w - - 0 1', 'draw'],
      ['4k3/8/8/8/8/8/8/2B1K3 b - - 0 1', 'draw'],
      ['4k3/8/8/8/8/8/8/1N2K3 w - - 0 1', 'draw'],
      ['4kb2/8/8/8/8/8/8/2B1K3 w - - 0 1', 'draw'],
      ['4k3/8/8/8/8/8/8/R3K3 w - - 100 1', 'draw'],
      ['4k2r/8/8/8/8/8/8/4K3 b - - 100 1', 'draw'],
      ['7k/6Q1/5K2/8/8/8/8/8 b - - 0 1', 'checkmate'],
    ]) {
      assert.equal(status(fen), outcome, fen);
      assert.equal(engine(fen, difficulty), null, fen);
    }
  });
}
