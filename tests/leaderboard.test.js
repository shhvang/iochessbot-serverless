import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { DatabaseSync } from 'node:sqlite';
import test, { afterEach, beforeEach } from 'node:test';

const url = (text) => `data:text/javascript,${encodeURIComponent(text).replaceAll("'", '%27')}`;
let sqlite;
const statements = [];
globalThis.__leaderboardTest = {
  all(statement) {
    statements.push(statement);
    return sqlite.prepare(statement.text).all(...statement.values);
  },
};
const modules = {
  sdk: url('export const db = globalThis.__leaderboardTest;'),
  'sdk/db': url('export const sql = (strings, ...values) => ({ text: strings.join("?"), values });'),
};
const source = await readFile(new URL('../lib/leaderboard.js', import.meta.url), 'utf8');
const { leaderboard } = await import(url(source.replace(/from '([^']+)'/g, (_, name) => {
  assert.ok(modules[name], `Missing test module: ${name}`);
  return `from '${modules[name]}'`;
})));
delete globalThis.__leaderboardTest;

beforeEach(() => {
  statements.length = 0;
  sqlite = new DatabaseSync(':memory:');
  sqlite.exec(`
    CREATE TABLE players (
      user_id INTEGER NOT NULL UNIQUE,
      name TEXT NOT NULL DEFAULT 'Player',
      wins INTEGER NOT NULL DEFAULT 0,
      losses INTEGER NOT NULL DEFAULT 0,
      draws INTEGER NOT NULL DEFAULT 0,
      rating INTEGER NOT NULL DEFAULT 1000
    );
    CREATE TABLE games (
      user_id INTEGER NOT NULL,
      mode TEXT NOT NULL DEFAULT 'classic',
      outcome TEXT,
      puzzle_id TEXT
    );
  `);
});
afterEach(() => sqlite.close());

function player(id, name = `Player ${id}`, wins = 0, losses = 0, draws = 0, rating = 1000) {
  sqlite.prepare('INSERT INTO players VALUES (?, ?, ?, ?, ?, ?)').run(id, name, wins, losses, draws, rating);
}

function game(id, mode, outcome, puzzleId = null) {
  sqlite.prepare('INSERT INTO games VALUES (?, ?, ?, ?)').run(id, mode, outcome, puzzleId);
}

function entries({ html }) {
  return html.match(/<p>(\d+\..*?)<\/p>/)?.[1].split('<br>') ?? [];
}

test('classic adds recorded outcomes to legacy counts and rating, including baseline-only players', async () => {
  player(1, 'Legacy', 4, 2, 3, 1230);
  player(2, 'Baseline only', 1, 0, 0, 1300);
  player(3, 'Inactive', 0, 0, 0, 9999);
  for (const outcome of ['win', 'win', 'loss', 'draw', null]) game(1, 'classic', outcome);
  game(1, 'mini', 'loss');
  game(1, 'puzzle', 'solved', 'p1');
  game(4, 'classic', 'win');
  game(5, 'classic', null);
  game(6, 'classic', 'draw');
  game(7, 'classic', 'loss');

  assert.deepEqual(entries(await leaderboard()), [
    '1. Baseline only - <b>1300</b> (1W / 0L / 0D)',
    '2. Legacy - <b>1240</b> (6W / 3L / 4D)',
    '3. Player - <b>1010</b> (1W / 0L / 0D)',
    '4. Player - <b>1000</b> (0W / 0L / 1D)',
    '5. Player - <b>990</b> (0W / 1L / 0D)',
  ]);
});

test('mini starts at 1000 and ignores classic baselines and other modes', async () => {
  player(1, 'Mini player', 40, 20, 30, 1800);
  player(2, 'Classic only', 100, 0, 0, 2000);
  for (const outcome of ['win', 'win', 'loss', 'draw', null]) game(1, 'mini', outcome);
  game(1, 'classic', 'win');
  game(1, 'puzzle', 'solved', 'p1');
  game(2, 'classic', 'win');
  game(3, 'mini', 'loss');
  game(4, 'mini', 'draw');
  game(5, 'mini', null);

  const result = await leaderboard('mini');
  assert.match(result.html, /<b>Mini-chess leaderboard<\/b>/);
  assert.deepEqual(entries(result), [
    '1. Mini player - <b>1010</b> (2W / 1L / 1D)',
    '2. Player - <b>1000</b> (0W / 0L / 1D)',
    '3. Player - <b>990</b> (0W / 1L / 0D)',
  ]);
});

test('puzzles count distinct non-null solved IDs per player, not replays or skipped puzzles', async () => {
  player(1, 'Solver', 100, 20, 30, 2500);
  player(2, 'Other solver');
  player(3, 'Classic only', 100, 0, 0, 3000);
  for (const id of ["queen's-mate", "queen's-mate", 'rook-mate', null]) game(1, 'puzzle', 'solved', id);
  game(1, 'puzzle', null, 'skipped');
  game(1, 'classic', 'win');
  game(1, 'mini', 'win');
  game(2, 'puzzle', 'solved', "queen's-mate");
  game(2, 'puzzle', 'solved', "queen's-mate");
  game(4, 'puzzle', null, 'skipped');
  game(5, 'puzzle', 'solved', null);

  const result = await leaderboard('puzzle');
  assert.match(result.html, /<b>Puzzles leaderboard<\/b>/);
  assert.deepEqual(entries(result), [
    '1. Solver - <b>2</b> unique solves',
    '2. Other solver - <b>1</b> unique solves',
  ]);
});

test('classic and mini sort by score, then wins, then numeric user ID, limiting to ten', async () => {
  const ids = [28, 27, 26, 25, 24, 23, 22, 21, 20, 12, 10, 3, 2, 1];
  for (const id of ids) {
    player(id);
    for (const mode of ['classic', 'mini']) {
      const outcomes = id === 12 ? ['win', 'win', 'loss'] : [id === 2 || id === 10 ? 'win' : id === 3 ? 'loss' : 'draw'];
      for (const outcome of outcomes) game(id, mode, outcome);
    }
  }
  const expected = [
    '1. Player 12 - <b>1010</b> (2W / 1L / 0D)',
    '2. Player 2 - <b>1010</b> (1W / 0L / 0D)',
    '3. Player 10 - <b>1010</b> (1W / 0L / 0D)',
    ...[1, 20, 21, 22, 23, 24, 25].map((id, index) => `${index + 4}. Player ${id} - <b>1000</b> (0W / 0L / 1D)`),
  ];
  for (const mode of ['classic', 'mini']) assert.deepEqual(entries(await leaderboard(mode)), expected);
});

test('puzzle scores and tied IDs determine the top ten, regardless of classic ratings', async () => {
  for (const id of [12, 11, 10, 9, 8, 7, 6, 5, 4, 3, 2, 1]) {
    player(id, `Player ${id}`, 100 - id, 0, 0, 3000 - id * 10);
    game(id, 'puzzle', 'solved', 'p1');
    game(id, 'puzzle', 'solved', 'p1');
  }
  game(12, 'puzzle', 'solved', 'p2');
  assert.deepEqual(entries(await leaderboard('puzzle')), [
    '1. Player 12 - <b>2</b> unique solves',
    ...[1, 2, 3, 4, 5, 6, 7, 8, 9].map((id, index) => `${index + 2}. Player ${id} - <b>1</b> unique solves`),
  ]);
});

test('apostrophes survive SQL and names are escaped as HTML text in every mode', async () => {
  const name = `O'Brien <b>"A&B"</b> &lt;script&gt;`;
  player(1, name);
  for (const mode of ['classic', 'mini', 'puzzle']) {
    game(1, mode, mode === 'puzzle' ? 'solved' : 'win', "queen's-mate");
    const result = await leaderboard(mode);
    assert.deepEqual(entries(result), [
      `1. O'Brien &lt;b&gt;"A&amp;B"&lt;/b&gt; &amp;lt;script&amp;gt; - <b>${mode === 'puzzle' ? '1</b> unique solves' : '1010</b> (1W / 0L / 0D)'}`,
    ]);
    assert.ok(!result.html.includes(name));
  }
  assert.equal(sqlite.prepare('SELECT name FROM players').get().name, name);
});

test('empty boards render safely and invalid modes fall back to bound classic parameters', async () => {
  for (const mode of ['classic', 'mini', 'puzzle']) {
    assert.match((await leaderboard(mode)).html, /No results yet/);
    const statement = statements.at(-1);
    assert.match(statement.text, /FROM games WHERE mode = \?/);
    assert.ok(statement.values.length > 0);
    assert.ok(statement.values.every((value) => value === mode));
  }
  player(1, 'Classic', 1);
  const attack = "mini'; DROP TABLE players; --";
  const result = await leaderboard(attack);
  assert.match(result.html, /<b>Chess leaderboard<\/b>/);
  assert.deepEqual(entries(result), ['1. Classic - <b>1000</b> (1W / 0L / 0D)']);
  assert.ok(statements.at(-1).values.every((value) => value === 'classic'));
  assert.ok(!statements.at(-1).text.includes(attack));
  assert.equal(sqlite.prepare('SELECT count(*) AS count FROM players').get().count, 1);
});
