import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { isDeepStrictEqual } from 'node:util';
import { boardSize, initialFen, miniInitialFen, legalMoves, playMove, stateToken, status } from '../lib/chess.js';
import { puzzles, puzzleGame } from '../lib/puzzles.js';

const source = (path) => readFile(new URL(path, import.meta.url), 'utf8');
const url = (text) => `data:text/javascript,${encodeURIComponent(text).replaceAll("'", '%27')}`;
const shared = {
  api: {}, db: {}, games: fields('id', 'userId', 'chatId', 'fen', 'history', 'moves', 'positions', 'playerColor', 'difficulty', 'setup', 'flipped', 'selected', 'promotion', 'result', 'outcome', 'revision', 'mode', 'puzzleId', 'guestQueryId', 'inlineMessageId'),
  players: fields('id', 'userId', 'name', 'wins', 'losses', 'draws', 'rating'),
  BotApiError: class BotApiError extends Error {},
};
globalThis.__gameTest = shared;

const realChessUrl = url(await source('../lib/chess.js'));
const chessUrl = url(`export * from '${realChessUrl}'; import { engine as realEngine } from '${realChessUrl}'; export function engine(...args) { globalThis.__gameTest.calls.engine.push(args); return realEngine(...args); }`);
const sdkUrl = url(`export const api = globalThis.__gameTest.api; export const db = globalThis.__gameTest.db; export const BotApiError = globalThis.__gameTest.BotApiError;`);
const dbUrl = url(`export const and = (...args) => globalThis.__gameTest.and(...args); export const desc = (...args) => globalThis.__gameTest.desc(...args); export const eq = (...args) => globalThis.__gameTest.eq(...args); export const isNull = (...args) => globalThis.__gameTest.isNull(...args); export const sql = (...args) => globalThis.__gameTest.sql(...args);`);
const schemaUrl = url(`export const games = globalThis.__gameTest.games; export const players = globalThis.__gameTest.players;`);
const modules = { sdk: sdkUrl, 'sdk/db': dbUrl, schema: schemaUrl, 'lib/chess': chessUrl };
for (const path of ['lib/puzzles', 'lib/games', 'lib/leaderboard', 'lib/reply', 'handlers/callback_query', 'handlers/message', 'handlers/guest_message']) {
  modules[path] = url((await source(`../${path}.js`)).replace(/from '([^']+)'/g, (_, name) => {
    assert.ok(modules[name], `Missing test module: ${name}`);
    return `from '${modules[name]}'`;
  }));
}
const callback = (await import(modules['handlers/callback_query'])).default;
const reply = await import(modules['lib/reply']);
const message = (await import(modules['handlers/message'])).default;
const guest = (await import(modules['handlers/guest_message'])).default;
const { createGame } = await import(modules['lib/games']);
const { leaderboard } = await import(modules['lib/leaderboard']);

function fields(...names) {
  return Object.fromEntries(names.map((name) => [name, { name }]));
}

function game(overrides = {}) {
  return {
    id: 1, userId: 10, chatId: 10, fen: initialFen, history: [], moves: [], positions: [initialFen],
    playerColor: 'w', difficulty: 'normal', setup: {}, flipped: false, selected: null,
    promotion: null, result: null, outcome: null, revision: 0,
    mode: 'classic', puzzleId: null, guestQueryId: null, inlineMessageId: null, ...overrides,
  };
}

function clone(value) {
  return structuredClone(value);
}

function harness(rows = [], playerRows = [], rawResults = []) {
  const calls = { answers: [], guestAnswers: [], edits: [], sends: [], updates: [], raw: [], engine: [] };
  const tables = { games: clone(rows), players: clone(playerRows) };
  const { games, players } = shared;
  const tableFor = (table) => table === games ? tables.games : tables.players;
  const eq = (field, value) => (row) => isDeepStrictEqual(row[field.name], value);
  const isNull = (field) => (row) => row[field.name] == null;
  const and = (...predicates) => (row) => predicates.every((predicate) => predicate(row));
  const desc = (field) => ({ field: field.name, direction: 'desc' });
  const sql = (strings, ...values) => ({ sql: strings.join('?'), values });
  const query = (table, projection) => {
    let predicate = () => true, order;
    const result = () => tableFor(table).filter(predicate).sort((a, b) => order ? (order.direction === 'desc' ? b[order.field] - a[order.field] : a[order.field] - b[order.field]) : 0);
    return {
      from(next) { table = next; return this; },
      where(next) { predicate = next; return this; },
      orderBy(next) { order = next; return this; },
      all: async () => clone(result()),
      get: async () => projection ? Object.fromEntries(Object.entries(projection).map(([name, expression]) => {
        const outcome = expression.sql.match(/= '(win|loss|draw|solved)'/)?.[1];
        const mode = expression.sql.match(/= '(classic|mini|puzzle)'/)?.[1];
        assert.ok(outcome, `Unsupported aggregate: ${expression.sql}`);
        const matched = result().filter((row) => row.outcome === outcome && (!mode || row.mode === mode));
        return [name, /count\(distinct/i.test(expression.sql)
          ? new Set(matched.map((row) => row.puzzleId).filter((id) => id != null)).size : matched.length];
      })) : clone(result()[0]),
    };
  };
  const db = {
    async all(statement) { calls.raw.push(clone(statement)); return clone(rawResults); },
    select(projection) { return query(null, projection); },
    insert(table) {
      let value, conflict;
      return {
        values(next) { value = next; return this; },
        onConflictDoUpdate(next) { conflict = next; return this; },
        returning() {
          return {
            run: async () => {
              const list = tableFor(table);
              const existing = conflict && list.find((row) => row[conflict.target.name] === value[conflict.target.name]);
              if (existing) {
                Object.assign(existing, clone(conflict.set));
                return [clone(existing)];
              }
              const defaults = table === games ? game({ positions: [] }) : { name: 'Player', wins: 0, losses: 0, draws: 0, rating: 1000 };
              const row = { ...defaults, id: Math.max(0, ...list.map((item) => item.id || 0)) + 1, ...clone(value) };
              list.push(row);
              return [clone(row)];
            },
          };
        },
      };
    },
    update(table) {
      let patch, predicate = () => true;
      return {
        set(next) { patch = next; return this; },
        where(next) { predicate = next; return this; },
        returning() {
          return {
            run: async () => {
              const row = tableFor(table).find(predicate);
              if (!row) return [];
              calls.updates.push({ id: row.id, patch: clone(patch) });
              Object.assign(row, clone(patch));
              return [clone(row)];
            },
          };
        },
      };
    },
  };
  Object.assign(shared.api, {
    answerCallbackQuery: async (value) => calls.answers.push(value),
    answerGuestQuery: async (value) => { calls.guestAnswers.push(value); return { inline_message_id: 'guest-inline' }; },
    editMessageText: async (value) => calls.edits.push(value),
    sendRichMessage: async (value) => calls.sends.push(value),
    sendMessage: async (value) => calls.sends.push(value),
    setMyCommands: async () => {},
  });
  Object.assign(shared.db, db);
  Object.assign(shared, { and, desc, eq, isNull, sql, calls });
  return { calls, tables, games, players };
}

function query(data, userId = 10, chatId = userId, type = 'private') {
  return { id: 'query', data, from: { id: userId }, message: { message_id: 7, chat: { id: chatId, type } } };
}

function action(name, row, value) {
  return `p:${name}:${row.id}:${stateToken(row)}:${value}`;
}

test('black setup opens with one engine move and no undo', async () => {
  const state = harness([game({ setup: { pending: true } })]);
  const row = state.tables.games[0];
  await callback(query(action('setup', row, 'b')));
  await callback(query(action('setup', state.tables.games[0], 'normal')));
  const saved = state.tables.games[0];
  assert.equal(saved.playerColor, 'b');
  assert.equal(saved.flipped, true);
  assert.equal(saved.moves.length, 1);
  assert.deepEqual(saved.history, []);
  assert.match(state.calls.edits.at(-1).rich_message.html, /<tg-button type="disabled">.*Undo/);
});

test('setup highlights choices and supports every declared button style', () => {
  const configured = reply.gameSetup(game({ setup: { pending: true, playerColor: 'b', difficulty: 'hard' } })).html;
  assert.match(configured, /style="primary"[^>]*>Black \(selected\)/);
  assert.match(configured, /style="primary"[^>]*>Hard \(selected\)/);
  const active = reply.richBoard(game()).html;
  const finished = reply.richBoard(game({ result: 'Checkmate' })).html;
  for (const style of ['primary', 'danger', 'success', 'link']) assert.match(`${active}${finished}`, new RegExp(`style="${style}"`));
});

test('mv promotion accepts an underpromotion after the promotion choice', async () => {
  const fen = '7k/P7/8/8/8/8/8/4K3 w - - 0 1';
  const state = harness([game({ fen, positions: [fen], selected: 'a7' })]);
  await callback(query(action('mv', state.tables.games[0], 'a7a8')));
  assert.equal(state.tables.games[0].promotion, 'a7:a8');
  await callback(query(action('promote', state.tables.games[0], 'n')));
  assert.match(state.tables.games[0].moves[0], /^a8=N/);
  assert.equal(state.tables.games[0].promotion, null);
});

test('a human third repetition is a draw before the engine replies', async () => {
  const fen = '4k3/8/8/8/8/8/8/R3K3 w - - 0 1';
  const move = legalMoves(fen, 'a1').find((item) => item.to === 'a2');
  const repeated = playMove(fen, move);
  const state = harness([game({ fen, selected: 'a1', positions: [repeated, repeated, fen] })]);
  await callback(query(action('mv', state.tables.games[0], 'a1a2')));
  const saved = state.tables.games[0];
  assert.equal(saved.result, 'Draw');
  assert.equal(saved.outcome, 'draw');
  assert.equal(saved.moves.length, 1);
  assert.equal(saved.fen, repeated);
});

test('finish preserves the final board and records a loss once; cancellation has no outcome', async () => {
  const played = game({ moves: ['e4', 'e5'], history: [initialFen] });
  const cancelled = game({ id: 2, userId: 11, chatId: 11, setup: { pending: true } });
  const state = harness([played, cancelled]);
  const before = clone(state.tables.games[0]);
  await callback(query(action('act', state.tables.games[0], 'finish')));
  assert.equal(state.tables.games[0].result, 'Resigned');
  assert.equal(state.tables.games[0].outcome, 'loss');
  assert.equal(state.tables.games[0].fen, before.fen);
  assert.deepEqual(state.tables.games[0].moves, before.moves);
  await callback(query(action('act', state.tables.games[0], 'finish')));
  assert.equal(state.tables.games[0].outcome, 'loss');
  assert.equal(state.calls.updates.filter(({ id, patch }) => id === 1 && patch.outcome === 'loss').length, 1);
  await callback(query(action('act', state.tables.games[1], 'stop'), 11));
  assert.equal(state.tables.games[1].result, 'Cancelled');
  assert.equal(state.tables.games[1].outcome, null);
});

test('rematch keeps the old game and sends a fresh setup board', async () => {
  const old = game({ result: 'Checkmate', outcome: 'loss', moves: ['f3', 'e5', 'g4', 'Qh4#'] });
  const state = harness([old]);
  await callback(query(action('act', state.tables.games[0], 'new')));
  assert.equal(state.tables.games.length, 2);
  assert.deepEqual(state.tables.games[0], { ...old, revision: 1 });
  assert.deepEqual(state.tables.games[1].setup, { pending: true });
  assert.equal(state.calls.sends.length, 1);
  await callback(query(action('act', old, 'new')));
  assert.equal(state.tables.games.length, 2);
});

test('stale, missing, and other-owned callbacks do not mutate games', async () => {
  const own = game({ selected: 'e2' });
  const other = game({ id: 2, userId: 20, chatId: 20, flipped: false });
  const state = harness([own, other]);
  await callback(query(`p:act:1:${stateToken({ ...own, selected: null })}:flip`));
  await callback(query('p:act:999:token:flip'));
  await callback(query(action('act', other, 'flip')));
  assert.deepEqual(state.tables.games, [own, other]);
  assert.equal(state.calls.updates.length, 0);
});

test('concurrent callbacks save only one state update and legacy draw is rejected', async () => {
  const state = harness([game()]);
  const data = action('act', state.tables.games[0], 'flip');
  await Promise.all([callback(query(data)), callback(query(data))]);
  assert.equal(state.calls.updates.length, 1);
  assert.equal(state.tables.games[0].flipped, true);
  await callback(query('p:act:1:draw'));
  assert.equal(state.calls.updates.length, 1);
  assert.equal(state.tables.games[0].result, null);
});

test('terminal boards retain their table but have no interactive squares', () => {
  const html = reply.richBoard(game({ result: 'Checkmate', moves: ['f3', 'e5', 'g4', 'Qh4#'] })).html;
  assert.match(html, /<table compact>/);
  assert.doesNotMatch(html, /p:(?:sq|mv):/);
  assert.match(html, /Rematch/);
});

test('move history is numbered, capped, and collapsible', () => {
  const moves = Array.from({ length: 42 }, (_, index) => `m${index + 1}`);
  const html = reply.richBoard(game({ moves })).html;
  assert.match(html, /<blockquote expandable><b>Moves<\/b><br>2\. m3 m4/);
  assert.match(html, /21\. m41 m42/);
  assert.doesNotMatch(html, /1\. m1 m2/);
  assert.match(html, /\/pgn shows the full history/);
});

test('stats add outcomes to baseline values and update only the player name', async () => {
  const player = { id: 1, userId: 10, name: 'Old name', wins: 2, losses: 3, draws: 4, rating: 1200 };
  const state = harness([
    game({ id: 1, outcome: 'win' }), game({ id: 2, outcome: 'loss' }), game({ id: 3, outcome: 'draw' }),
  ], [player]);
  await message({ chat: { id: 10, type: 'private' }, from: { id: 10, first_name: 'New name' }, text: '/stats' });
  const html = state.calls.sends.at(-1).rich_message.html;
  assert.match(html, /Wins: 3<br>Losses: 4<br>Draws: 5<br>Bot score: <b>1200<\/b>/);
  assert.deepEqual(state.tables.players, [{ ...player, name: 'New name' }]);
});

test('mini creation, move, undo and rematch preserve mode and a 5x6 board', async () => {
  const state = harness();
  await message({ chat: { id: 10, type: 'private' }, from: { id: 10 }, text: '/mini' });
  const row = state.tables.games[0];
  assert.equal(row.mode, 'mini');
  assert.equal(row.fen, miniInitialFen);
  assert.equal(row.revision, 0);
  assert.equal(row.result, null);
  assert.equal(row.outcome, null);
  assert.deepEqual(row.setup, { pending: true });
  assert.match(state.calls.sends[0].rich_message.html, /Mini-chess 5x6/);
  await callback(query(action('setup', row, 'w')));
  await callback(query(action('setup', row, 'normal')));

  const checkBoard = (saved) => {
    assert.equal(saved.mode, 'mini');
    assert.deepEqual(boardSize(saved.fen), { width: 5, height: 6 });
    const html = reply.richBoard(saved).html;
    const rows = html.match(/<tr>.*?<\/tr>/g);
    assert.equal(rows.length, 8);
    assert.match(rows[0], /<th>a<\/th><th>b<\/th><th>c<\/th><th>d<\/th><th>e<\/th>/);
    assert.doesNotMatch(html, /<th>[fgh78]<\/th>/);
    for (const rank of rows.slice(1, -1)) assert.equal((rank.match(/align="center"/g) || []).length, 5);
  };
  checkBoard(row);
  await callback(query(action('sq', row, 'a2')));
  await callback(query(action('mv', row, 'a2a3')));
  assert.notEqual(row.fen, miniInitialFen);
  assert.equal(row.moves.length, 2);
  assert.deepEqual(row.history, [miniInitialFen]);
  assert.equal(state.calls.engine.length, 1);
  checkBoard(row);
  await callback(query(action('act', row, 'undo')));
  assert.equal(row.fen, miniInitialFen);
  assert.deepEqual(row.moves, []);
  assert.deepEqual(row.history, []);
  assert.deepEqual(row.positions, [miniInitialFen]);
  checkBoard(row);
  await callback(query(action('act', row, 'stop')));
  const finished = clone(row);
  await callback(query(action('act', row, 'new')));
  assert.equal(state.tables.games.length, 2);
  assert.deepEqual(row, { ...finished, revision: finished.revision + 1 });
  const next = state.tables.games[1];
  assert.equal(next.mode, 'mini');
  assert.equal(next.fen, miniInitialFen);
  assert.deepEqual(next.setup, { pending: true });
  await callback(query(action('setup', next, 'w')));
  await callback(query(action('setup', next, 'normal')));
  checkBoard(next);
});

test('puzzle creation rejects a wrong move without changing the position or calling the engine, then records mate', async () => {
  const state = harness();
  await message({ chat: { id: 10, type: 'private' }, from: { id: 10 }, text: '/puzzle' });
  const row = state.tables.games[0];
  assert.equal(row.mode, 'puzzle');
  assert.equal(row.puzzleId, 'back-rank-rook');
  assert.deepEqual(row.setup, {});
  const before = clone(row);
  await callback(query(action('sq', row, 'a1')));
  await callback(query(action('mv', row, 'a1a2')));
  assert.equal(row.fen, before.fen);
  assert.deepEqual(row.positions, before.positions);
  assert.deepEqual(row.history, []);
  assert.deepEqual(row.moves, []);
  assert.equal(row.selected, null);
  assert.equal(row.promotion, null);
  assert.equal(row.result, null);
  assert.equal(row.outcome, null);
  assert.match(state.calls.answers.at(-1).text, /Not checkmate/);
  assert.equal(state.calls.engine.length, 0);
  await callback(query(action('sq', row, 'a1')));
  await callback(query(action('mv', row, 'a1a8')));
  assert.equal(status(row.fen), 'checkmate');
  assert.equal(row.result, 'Solved');
  assert.equal(row.outcome, 'solved');
  assert.deepEqual(row.moves, ['Ra8#']);
  assert.deepEqual(row.positions, [before.fen, row.fen]);
  assert.equal(state.calls.engine.length, 0);
  assert.doesNotMatch(state.calls.edits.at(-1).rich_message.html, /p:(?:sq|mv):/);
});

test('Black puzzles start flipped and show Black move notation after solving', async () => {
  const state = harness([game(puzzleGame(puzzles.find((puzzle) => puzzle.id === 'smothered-knight')))]);
  const row = state.tables.games[0];
  assert.equal(row.playerColor, 'b');
  assert.equal(row.flipped, true);
  assert.match(reply.richBoard(row).html, /Black to move: mate in one/);
  await callback(query(action('sq', row, 'e4')));
  await callback(query(action('mv', row, 'e4f2')));
  assert.equal(row.result, 'Solved');
  assert.equal(row.outcome, 'solved');
  assert.deepEqual(row.moves, ['Nf2#']);
  assert.match(state.calls.edits.at(-1).rich_message.html, /<b>Moves<\/b><br>1\.\.\. Nf2#/);
  assert.equal(state.calls.engine.length, 0);
});

test('PGN export uses Black move notation for a solved Black puzzle', async () => {
  harness([game({
    ...puzzleGame(puzzles.find((puzzle) => puzzle.id === 'smothered-knight')),
    moves: ['Nf2#'], result: 'Solved', outcome: 'solved',
  })]);
  await message({ chat: { id: 10, type: 'private' }, from: { id: 10 }, text: '/pgn' });
  assert.equal(shared.calls.sends.at(-1).text, '1... Nf2#');
});

test('skipping a puzzle keeps its position and does not record a game loss', async () => {
  const state = harness([game(puzzleGame(puzzles[0]))]);
  const row = state.tables.games[0], fen = row.fen;
  assert.match(reply.richBoard(row).html, /Skip Puzzle/);
  assert.doesNotMatch(reply.richBoard(row).html, /:undo/);
  await callback(query(action('act', row, 'stop')));
  assert.equal(row.result, 'Skipped');
  assert.equal(row.outcome, null);
  assert.equal(row.fen, fen);
  assert.deepEqual(row.moves, []);
  await message({ chat: { id: 10, type: 'private' }, from: { id: 10 }, text: '/stats' });
  assert.match(state.calls.sends.at(-1).rich_message.html, /Wins: 0<br>Losses: 0<br>Draws: 0/);
  assert.match(state.calls.sends.at(-1).rich_message.html, /0 unique puzzles solved/);
  assert.equal(state.calls.engine.length, 0);
});

test('knight underpromotion solves its puzzle after queen promotion is rejected', async () => {
  const state = harness([game(puzzleGame(puzzles.find((puzzle) => puzzle.id === 'knight-promotion')))]);
  const row = state.tables.games[0], fen = row.fen;
  await callback(query(action('sq', row, 'f7')));
  await callback(query(action('mv', row, 'f7f8')));
  assert.equal(row.promotion, 'f7:f8');
  assert.match(state.calls.edits.at(-1).rich_message.html, /:n">N<\/tg-button>/);
  await callback(query(action('promote', row, 'q')));
  assert.equal(row.fen, fen);
  assert.equal(row.result, null);
  assert.equal(row.outcome, null);
  assert.equal(row.promotion, null);
  assert.deepEqual(row.moves, []);
  await callback(query(action('sq', row, 'f7')));
  await callback(query(action('mv', row, 'f7f8')));
  await callback(query(action('promote', row, 'n')));
  assert.equal(status(row.fen), 'checkmate');
  assert.equal(row.result, 'Solved');
  assert.equal(row.outcome, 'solved');
  assert.deepEqual(row.moves, ['f8=N#']);
  assert.equal(state.calls.engine.length, 0);
});

test('stats separate modes and count each solved puzzle once even across duplicate games', async () => {
  const state = harness([
    game({ id: 1, outcome: 'win' }),
    game({ id: 2, mode: 'mini', outcome: 'win' }),
    game({ id: 3, mode: 'mini', outcome: 'loss' }),
    game({ id: 4, mode: 'mini', outcome: 'draw' }),
    ...['back-rank-rook', 'back-rank-rook', 'queen-and-king'].map((puzzleId, index) =>
      game({ id: index + 5, mode: 'puzzle', puzzleId, result: 'Solved', outcome: 'solved' })),
    game({ id: 8, mode: 'puzzle', puzzleId: 'smothered-knight', result: 'Skipped' }),
    game({ id: 9, userId: 20, mode: 'puzzle', puzzleId: 'smothered-knight', outcome: 'solved' }),
  ]);
  await message({ chat: { id: 10, type: 'private' }, from: { id: 10 }, text: '/stats' });
  const html = state.calls.sends.at(-1).rich_message.html;
  assert.match(html, /Wins: 1<br>Losses: 0<br>Draws: 0<br>Bot score: <b>1010<\/b>/);
  assert.match(html, /Mini-chess<\/b><br>1 wins \/ 1 losses \/ 1 draws<br>Bot score: 1000/);
  assert.match(html, /2 unique puzzles solved/);
  await message({ chat: { id: 10, type: 'private' }, from: { id: 10 }, text: '/puzzle' });
  assert.equal(state.tables.games.at(-1).puzzleId, 'queen-and-bishop');
});

test('leaderboard command passes its mode as SQL parameters and escapes raw player names', async () => {
  const name = '<b>Alice & Bob</b>';
  for (const [argument, mode, title] of [['', 'classic', 'Chess'], [' MINI', 'mini', 'Mini-chess'], [' puzzle', 'puzzle', 'Puzzles']]) {
    const state = harness([], [], [{ user_id: 10, name, score: 2, wins: 1, losses: 0, draws: 1, solved: 2 }]);
    await message({ chat: { id: 10, type: 'private' }, from: { id: 10 }, text: `/leaderboard${argument}` });
    assert.equal(state.calls.raw.length, 1);
    const statement = state.calls.raw[0];
    assert.match(statement.sql, /FROM games WHERE mode = \?/);
    assert.ok(statement.values.length > 0);
    assert.ok(statement.values.every((value) => value === mode));
    assert.match(statement.sql, /count\(distinct case when outcome = 'solved' then puzzle_id end\)/i);
    const html = state.calls.sends.at(-1).rich_message.html;
    assert.ok(html.includes(`<b>${title} leaderboard</b>`));
    assert.match(html, /&lt;b&gt;Alice &amp; Bob&lt;\/b&gt;/);
    assert.ok(!html.includes(name));
    assert.match(html, mode === 'puzzle' ? /<b>2<\/b> unique solves/ : /\(1W \/ 0L \/ 1D\)/);
  }
  const state = harness();
  const attack = "mini'; DROP TABLE players; --";
  const content = await leaderboard(attack);
  assert.ok(!state.calls.raw[0].sql.includes(attack));
  assert.ok(state.calls.raw[0].values.every((value) => value === 'classic'));
  assert.match(content.html, /Chess leaderboard/);
  assert.match(content.html, /No results yet/);
});

test('guest queries answer the correct ID with article content without sending a chat message', async () => {
  for (const [command, mode, title] of [['chess', 'classic', 'New chess game'], ['mini', 'mini', 'Mini-chess 5x6'], ['puzzle', 'puzzle', 'mate in one']]) {
    const state = harness();
    const sent = await guest({ guest_query_id: `guest-${mode}`, message_id: 42, chat: { id: -100, type: 'supergroup' }, from: { id: 10, first_name: 'Guest' }, text: `@IOChessBot ${command}` });
    assert.equal(state.calls.guestAnswers.length, 1);
    const answer = state.calls.guestAnswers[0], row = state.tables.games[0];
    assert.equal(answer.guest_query_id, `guest-${mode}`);
    assert.equal(answer.result.type, 'article');
    assert.equal(answer.result.id, `game-${row.id}`);
    assert.equal(answer.result.title, 'Chess');
    assert.deepEqual(answer.result.input_message_content, { rich_message: reply.richBoard(row) });
    assert.ok(answer.result.input_message_content.rich_message.html.includes(title));
    assert.equal(row.mode, mode);
    assert.equal(row.userId, 10);
    assert.equal(row.chatId, -100);
    assert.equal(row.guestQueryId, `guest-${mode}`);
    assert.deepEqual(sent, { inline_message_id: 'guest-inline' });
    assert.equal(row.inlineMessageId, sent.inline_message_id);
    assert.deepEqual(state.calls.updates, [{ id: row.id, patch: { inlineMessageId: 'guest-inline' } }]);
    assert.equal(state.tables.players[0].name, 'Guest');
    assert.equal(state.calls.sends.length, 0);
    assert.equal(state.calls.edits.length, 0);
  }
});

test('guest leaderboard answers inline with the requested mode and does not create a game', async () => {
  const state = harness([], [], [{ name: '<Guest>', score: 3, solved: 3 }]);
  await guest({ guest_query_id: 'guest-ranks', chat: { id: -100 }, from: { id: 10 }, text: '@IOChessBot leaderboard puzzle' });
  assert.equal(state.calls.guestAnswers[0].guest_query_id, 'guest-ranks');
  assert.match(state.calls.guestAnswers[0].result.input_message_content.rich_message.html, /Puzzles leaderboard/);
  assert.match(state.calls.guestAnswers[0].result.input_message_content.rich_message.html, /&lt;Guest&gt; - <b>3<\/b> unique solves/);
  assert.ok(state.calls.raw[0].values.every((value) => value === 'puzzle'));
  assert.equal(state.tables.games.length, 0);
  assert.equal(state.calls.sends.length, 0);
});

test('guest duplicates after sending do not answer again and concurrent deliveries insert only one row', async () => {
  const state = harness();
  const event = { guest_query_id: 'guest-duplicate', chat: { id: -100 }, from: { id: 10 }, text: '@IOChessBot puzzle' };
  await Promise.all([guest(event), guest(event)]);
  assert.equal(state.tables.games.length, 1);
  assert.equal(state.tables.players.length, 1);
  assert.equal(state.calls.guestAnswers.length, 2);
  assert.equal(state.calls.guestAnswers[0].result.id, state.calls.guestAnswers[1].result.id);
  const row = state.tables.games[0];
  assert.equal(row.inlineMessageId, 'guest-inline');
  await callback({ id: 'select', from: { id: 10 }, inline_message_id: 'guest-inline', data: action('sq', row, 'a1') });
  assert.equal(row.selected, 'a1');
  const before = clone(row);
  const updates = clone(state.calls.updates);
  await guest({ ...event, text: '@IOChessBot mini' });
  assert.deepEqual(state.tables.games, [before]);
  assert.deepEqual(state.calls.updates, updates);
  assert.equal(state.calls.guestAnswers.length, 2);
  await guest({ ...event, guest_query_id: 'guest-distinct' });
  assert.equal(state.calls.guestAnswers.length, 3);
  assert.equal(state.tables.games.length, 2);
  assert.equal(state.tables.games[1].guestQueryId, 'guest-distinct');
  assert.notEqual(state.tables.games[1].id, row.id);
  assert.equal(state.calls.sends.length, 0);
});

test('inline callbacks without a message allow only the owner and edit the inline ID', async () => {
  const state = harness([game({ ...puzzleGame(puzzles[0]), chatId: -100, guestQueryId: 'guest-owner', inlineMessageId: 'inline-owner' })]);
  const row = state.tables.games[0];
  const inline = { id: 'owner-callback', from: { id: 10 }, inline_message_id: 'inline-owner' };
  await callback({ ...inline, data: action('sq', row, 'a1') });
  assert.equal(row.selected, 'a1');
  await callback({ ...inline, data: action('mv', row, 'a1a8') });
  assert.equal(row.outcome, 'solved');
  assert.equal(state.calls.edits.length, 2);
  for (const edit of state.calls.edits) {
    assert.equal(edit.inline_message_id, 'inline-owner');
    assert.ok(!Object.hasOwn(edit, 'chat_id'));
    assert.ok(!Object.hasOwn(edit, 'message_id'));
  }
  assert.equal(state.calls.answers.at(-1).callback_query_id, 'owner-callback');
  const before = clone(row);
  await callback({ ...inline, data: action('act', row, 'new') });
  assert.deepEqual(state.tables.games, [before]);
  assert.match(state.calls.answers.at(-1).text, /Mention @IOChessBot again/);
  assert.equal(state.calls.edits.length, 2);
  assert.equal(state.calls.sends.length, 0);
});

test('foreign inline and group callbacks are denied without changing or rendering the owner board', async () => {
  const row = game({ ...puzzleGame(puzzles[0]), chatId: -100, guestQueryId: 'guest-foreign', inlineMessageId: 'inline-foreign' });
  const state = harness([row]);
  const data = action('sq', row, 'a1');
  await callback({ id: 'foreign-inline', from: { id: 20 }, inline_message_id: 'inline-foreign', data });
  assert.match(state.calls.answers.at(-1).text, /another player/);
  await callback(query(data, 20, -100, 'supergroup'));
  assert.match(state.calls.answers.at(-1).text, /another player/);
  assert.deepEqual(state.tables.games, [row]);
  assert.equal(state.calls.updates.length, 0);
  assert.equal(state.calls.edits.length, 0);
  assert.equal(state.calls.sends.length, 0);
});

test('swapped own-game tokens cannot target another inline message', async () => {
  const rows = [
    game({ chatId: -100, guestQueryId: 'guest-first', inlineMessageId: 'inline-first' }),
    game({ id: 2, chatId: -100, guestQueryId: 'guest-second', inlineMessageId: 'inline-second' }),
    game({ id: 3 }),
  ];
  const state = harness(rows);
  for (const row of [rows[1], rows[2]]) {
    await callback({ id: 'swapped', from: { id: 10 }, inline_message_id: 'inline-first', data: action('act', row, 'flip') });
    assert.match(state.calls.answers.at(-1).text, /different message/);
  }
  assert.deepEqual(state.tables.games, rows);
  assert.equal(state.calls.updates.length, 0);
  assert.equal(state.calls.edits.length, 0);
  assert.equal(state.calls.sends.length, 0);
});

test('stale own inline callbacks refresh the bound board without changing it', async () => {
  const row = game({ ...puzzleGame(puzzles[0]), chatId: -100, guestQueryId: 'guest-stale', inlineMessageId: 'inline-stale', selected: 'a1', revision: 1 });
  const state = harness([row]);
  await callback({ id: 'stale', from: { id: 10 }, inline_message_id: 'inline-stale', data: action('mv', { ...row, revision: 0 }, 'a1a8') });
  assert.deepEqual(state.calls.answers, [{ callback_query_id: 'stale', text: 'This board is out of date.' }]);
  assert.deepEqual(state.calls.edits, [{ inline_message_id: 'inline-stale', rich_message: reply.richBoard(row) }]);
  assert.deepEqual(state.tables.games, [row]);
  assert.equal(state.calls.updates.length, 0);
  assert.equal(state.calls.engine.length, 0);
  assert.equal(state.calls.sends.length, 0);
});

test('public page and load callbacks cannot render or send private games', async () => {
  const row = game();
  const state = harness([row]);
  for (const data of ['p:page:0', 'p:load:1']) {
    for (const event of [
      { id: 'public-inline', from: { id: 10 }, inline_message_id: 'inline-public', data },
      ...['group', 'supergroup', 'channel'].map((type) => query(data, 10, -100, type)),
    ]) {
      await callback(event);
      assert.equal(state.calls.answers.at(-1).callback_query_id, event.id);
      assert.match(state.calls.answers.at(-1).text, /Open \/games privately/);
    }
  }
  assert.equal(state.calls.answers.length, 8);
  assert.deepEqual(state.tables.games, [row]);
  assert.equal(state.calls.updates.length, 0);
  assert.equal(state.calls.edits.length, 0);
  assert.equal(state.calls.sends.length, 0);
});

test('sender_chat and missing personal senders cannot create guest games', async () => {
  for (const sender of [{ from: { id: 10 }, sender_chat: { id: -100 } }, {}]) {
    const state = harness();
    await guest({ guest_query_id: 'guest-anonymous', chat: { id: -100 }, text: '@IOChessBot mini', ...sender });
    assert.equal(state.calls.guestAnswers[0].guest_query_id, 'guest-anonymous');
    assert.match(state.calls.guestAnswers[0].result.input_message_content.rich_message.html, /personal account/);
    assert.deepEqual(state.tables, { games: [], players: [] });
    assert.equal(state.calls.sends.length, 0);
  }
  const state = harness();
  await message({ chat: { id: -100, type: 'supergroup' }, from: { id: 10 }, sender_chat: { id: -100 }, text: '/mini' });
  assert.deepEqual(state.tables, { games: [], players: [] });
  assert.match(state.calls.sends[0].text, /personal account/);
});

test('ten active games block new modes and rematches but not a repeated guest query', async () => {
  const rows = Array.from({ length: 10 }, (_, index) => game({ id: index + 1, mode: ['classic', 'mini', 'puzzle'][index % 3] }));
  rows[0].guestQueryId = 'guest-existing';
  const finished = game({ id: 11, result: 'Resigned', outcome: 'loss' });
  const state = harness([...rows, finished]);
  for (const text of ['/new', '/mini', '/puzzle']) {
    await message({ chat: { id: 10, type: 'private' }, from: { id: 10 }, text });
    assert.match(state.calls.sends.at(-1).rich_message.html, /10 active games/);
  }
  const event = { guest_query_id: 'guest-new', chat: { id: -100 }, from: { id: 10 }, text: '@IOChessBot puzzle' };
  await guest(event);
  assert.match(state.calls.guestAnswers.at(-1).result.input_message_content.rich_message.html, /10 active games/);
  await callback(query(action('act', finished, 'new')));
  assert.match(state.calls.answers.at(-1).text, /Finish an active game/);
  await guest({ ...event, guest_query_id: 'guest-existing' });
  assert.equal(state.calls.guestAnswers.at(-1).result.id, 'game-1');
  assert.deepEqual(state.tables.games, [{ ...rows[0], inlineMessageId: 'guest-inline' }, ...rows.slice(1), finished]);
  const other = await createGame(20, 20, 'mini');
  assert.equal(other.mode, 'mini');
  await callback(query(action('act', state.tables.games[0], 'stop')));
  await guest(event);
  assert.equal(state.tables.games.length, 13);
  assert.equal(state.tables.games.at(-1).mode, 'puzzle');
  assert.equal(state.tables.games.filter((row) => row.userId === 10 && !row.result).length, 10);
});

test('stale and concurrent puzzle solves record exactly one solve and never call the engine', async () => {
  const initial = game({ ...puzzleGame(puzzles[0]), selected: 'a1', revision: 1 });
  const state = harness([initial]);
  const row = state.tables.games[0];
  await callback(query(action('mv', { ...initial, revision: 0 }, 'a1a8')));
  assert.deepEqual(row, initial);
  assert.match(state.calls.answers.at(-1).text, /out of date/);
  assert.equal(state.calls.updates.length, 0);
  const data = action('mv', row, 'a1a8');
  await Promise.all([callback(query(data)), callback(query(data))]);
  assert.equal(row.result, 'Solved');
  assert.equal(row.outcome, 'solved');
  assert.deepEqual(row.moves, ['Ra8#']);
  assert.equal(row.revision, 2);
  assert.equal(state.calls.updates.length, 1);
  assert.equal(state.calls.edits.length, 1);
  assert.ok(state.calls.answers.some((answer) => /board changed/.test(answer.text)));
  const solved = clone(row);
  await callback(query(data));
  await callback(query(action('mv', row, 'a1a8')));
  assert.deepEqual(row, solved);
  assert.equal(state.calls.updates.length, 1);
  assert.equal(state.calls.engine.length, 0);
  await message({ chat: { id: 10, type: 'private' }, from: { id: 10 }, text: '/stats' });
  assert.match(state.calls.sends.at(-1).rich_message.html, /1 unique puzzles solved/);
});
