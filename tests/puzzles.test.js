import assert from 'node:assert/strict';
import test from 'node:test';
import { boardFromFen, legalMoves, playMove, status } from '../lib/chess.js';
import { puzzles, puzzleGame } from '../lib/puzzles.js';

test('catalog has distinct positions, unique ASCII slugs, titles and both colors', () => {
  assert.ok(puzzles.length >= 6);
  assert.equal(new Set(puzzles.map(({ id }) => id)).size, puzzles.length);
  assert.equal(new Set(puzzles.map(({ fen }) => fen.split(' ')[0])).size, puzzles.length);
  assert.deepEqual(new Set(puzzles.map(({ fen }) => fen.split(' ')[1])), new Set(['w', 'b']));
  for (const puzzle of puzzles) {
    assert.deepEqual(Object.keys(puzzle).sort(), ['fen', 'id', 'title']);
    assert.match(puzzle.id, /^[a-z0-9]+(?:-[a-z0-9]+)*$/);
    assert.equal(typeof puzzle.title, 'string');
    assert.ok(puzzle.title.trim());
  }
});

for (const puzzle of puzzles) {
  test(`${puzzle.id} is a legal, nonterminal 8x8 mate in one`, () => {
    const { fen } = puzzle;
    assert.match(fen, /^[prnbqkPRNBQK1-8/]+ [wb] - - 0 [1-9]\d*$/);
    const rows = fen.split(' ')[0].split('/');
    assert.equal(rows.length, 8);
    for (const row of rows) {
      assert.equal([...row].reduce((width, cell) => width + (/[1-8]/.test(cell) ? +cell : 1), 0), 8);
    }
    const board = boardFromFen(fen);
    assert.equal(board.length, 64);
    for (const king of ['K', 'k']) assert.equal(board.filter((piece) => piece === king).length, 1);
    assert.ok([...board.slice(0, 8), ...board.slice(56)].every((piece) => piece?.toLowerCase() !== 'p'));
    const white = board.indexOf('K'), black = board.indexOf('k');
    assert.ok(Math.max(Math.abs(white % 8 - black % 8), Math.abs(Math.floor(white / 8) - Math.floor(black / 8))) > 1);
    assert.ok(['playing', 'check'].includes(status(fen)));
    const opponentFen = fen.split(' ');
    opponentFen[1] = opponentFen[1] === 'w' ? 'b' : 'w';
    assert.ok(!['check', 'checkmate'].includes(status(opponentFen.join(' '))));
    const moves = legalMoves(fen);
    assert.ok(moves.length > 0);
    const mates = moves.filter((move) => status(playMove(fen, move)) === 'checkmate');
    assert.ok(mates.length > 0, `${puzzle.id} must have a legal mating move`);
  });

  test(`${puzzle.id} creates fresh puzzle state without ownership fields`, () => {
    const { fen } = puzzle;
    const playerColor = fen.split(' ')[1];
    const expected = {
      mode: 'puzzle', puzzleId: puzzle.id, fen, positions: [fen], history: [], moves: [],
      playerColor, flipped: playerColor === 'b', setup: {}, selected: null,
      promotion: null, result: null, outcome: null,
    };
    const first = puzzleGame(puzzle), second = puzzleGame(puzzle);
    assert.deepEqual(first, expected);
    assert.deepEqual(second, expected);
    for (const field of ['positions', 'history', 'moves', 'setup']) assert.notEqual(first[field], second[field]);
  });
}
