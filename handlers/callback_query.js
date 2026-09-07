import { api, db } from 'sdk';
import { and, desc, eq } from 'sdk/db';
import { games } from 'schema';
import { engine, isThreefold, legalMoves, moveNotation, playMove, stateToken, status } from 'lib/chess';
import { editBoard, editGames, sendBoard } from 'lib/reply';
import { createGame } from 'lib/games';

function gameResult(game) {
  return game.result || ({ checkmate: 'Checkmate', draw: 'Draw' }[status(game.fen)] ?? null)
    || (isThreefold(game.positions || [], game.fen) ? 'Draw' : null);
}

export default async function (query) {
  const chatId = query.message?.chat?.id, userId = query.from?.id;
  const inlineId = query.inline_message_id;
  if ((!chatId && !inlineId) || !userId) return;
  const answer = (text) => api.answerCallbackQuery({ callback_query_id: query.id, ...(text ? { text } : {}) });
  const render = (game) => editBoard(chatId, query.message?.message_id, game, inlineId);
  const match = query.data?.match(/^p:([^:]+):?(.*)$/);
  if (!match) return answer();
  const [, name, payload] = match;
  if (name === 'noop') return answer();
  if (name === 'page') {
    if (inlineId || query.message?.chat.type !== 'private') return answer('Open /games privately to browse.');
    const page = Math.max(0, +payload || 0);
    const list = await db.select().from(games).where(eq(games.userId, userId)).orderBy(desc(games.id)).all();
    if (!list[page]) return answer();
    await answer();
    return editGames(chatId, query.message.message_id, { ...list[page], page, pageCount: list.length });
  }
  if (name === 'load') {
    if (inlineId || query.message?.chat.type !== 'private') return answer('Open /games privately to continue.');
    const game = await db.select().from(games).where(and(eq(games.id, +payload), eq(games.userId, userId))).get();
    await answer();
    return game ? sendBoard(chatId, game) : undefined;
  }
  if (!['sq', 'mv', 'setup', 'promote', 'act'].includes(name)) return answer();
  const [id, token, ...parts] = payload.split(':');
  const gameId = +id, value = parts.join(':');
  if (!Number.isSafeInteger(gameId) || gameId <= 0 || !token) return answer('Open your game with /games.');
  let game = await db.select().from(games).where(and(eq(games.id, gameId), eq(games.userId, userId))).get();
  if (!game && inlineId) return answer('This board belongs to another player. Mention @IOChessBot for your own game.');
  if (!game && query.message?.chat.type !== 'private') {
    const source = await db.select().from(games).where(and(eq(games.id, gameId), eq(games.chatId, chatId))).get();
    if (!source || token !== stateToken(source)) return answer('This board is out of date.');
    return answer('This is another player\'s game. Open the bot privately and send /new for your own board.');
  }
  if (!game) return answer('This game is no longer available. Open /games.');
  if (inlineId && game.inlineMessageId !== inlineId) return answer('This game belongs to a different message.');
  if (token !== stateToken(game)) {
    await answer('This board is out of date.');
    if (inlineId) return render(game);
    return;
  }

  const original = game;
  const result = gameResult(game);
  let patch = {}, notice;
  if (result && (name !== 'act' || !['flip', 'new', 'stop', 'finish'].includes(value))) return answer(`${result}. Start a rematch instead.`);
  if (game.setup?.pending && name !== 'setup' && !(name === 'act' && ['stop', 'finish'].includes(value))) return answer('Choose your side and difficulty first.');

  if (name === 'setup') {
    if (!game.setup?.pending) return answer();
    const setup = { ...game.setup };
    if (['w', 'b', 'r'].includes(value)) setup.playerColor = value;
    else if (['easy', 'normal', 'hard'].includes(value)) setup.difficulty = value;
    else return answer();
    patch = { setup };
    if (setup.playerColor && setup.difficulty) {
      const playerColor = setup.playerColor === 'r' ? (Math.random() < 0.5 ? 'w' : 'b') : setup.playerColor;
      patch = { playerColor, difficulty: setup.difficulty, flipped: playerColor === 'b', setup: {}, history: [] };
      if (playerColor === 'b') {
        const reply = engine(game.fen, setup.difficulty);
        const fen = playMove(game.fen, reply);
        patch = { ...patch, fen, moves: [moveNotation(game.fen, reply)], positions: [game.fen, fen] };
      }
    }
  } else if (['sq', 'mv', 'promote'].includes(name)) {
    if (game.fen.split(' ')[1] !== game.playerColor) return answer('Wait for the engine to move.');
    let from, to, promotion;
    if (name === 'promote') {
      if (!game.promotion || !['q', 'r', 'b', 'n'].includes(value)) return answer();
      [from, to] = game.promotion.split(':');
      promotion = value;
    } else {
      if (game.promotion) return answer('Choose a promotion piece first.');
      from = name === 'mv' ? value.slice(0, 2) : game.selected;
      to = name === 'mv' ? value.slice(2) : value;
      if (!/^[a-h][1-8]$/.test(to) || (from && !/^[a-h][1-8]$/.test(from))) return answer();
      if (name === 'mv' && game.selected !== from) return answer();
    }
    const move = from && legalMoves(game.fen, from).find((item) => item.to === to && (!promotion || item.promotion?.toLowerCase() === promotion));
    if (!move) {
      if (name !== 'sq' || !legalMoves(game.fen, to).length) return answer('Choose one of your pieces, then a legal destination.');
      patch = { selected: game.selected === to ? null : to };
    } else if (move.promotion && !promotion) {
      patch = { promotion: `${from}:${to}`, selected: null };
    } else {
      const fen = playMove(game.fen, move);
      if (game.mode === 'puzzle') {
        if (status(fen) !== 'checkmate') {
          patch = { selected: null, promotion: null };
          notice = 'Not checkmate. Try another move.';
        } else {
          patch = { fen, positions: [game.fen, fen], moves: [moveNotation(game.fen, move)], selected: null, promotion: null, result: 'Solved' };
          notice = 'Checkmate! Puzzle solved.';
        }
      } else {
        const positions = [...(game.positions?.length ? game.positions : [game.fen]), fen];
        const humanResult = gameResult({ fen, positions });
        const reply = humanResult ? null : engine(fen, game.difficulty);
        const nextFen = reply ? playMove(fen, reply) : fen;
        if (reply) positions.push(nextFen);
        patch = {
          fen: nextFen, positions, history: [game.fen, ...(game.history || [])],
          moves: [...(game.moves || []), moveNotation(game.fen, move), ...(reply ? [moveNotation(fen, reply)] : [])],
          selected: null, promotion: null, result: humanResult || gameResult({ fen: nextFen, positions }),
        };
      }
    }
  } else if (name === 'act') {
    if (value === 'flip') patch = { flipped: !game.flipped };
    else if (value === 'undo') {
      if (game.mode === 'puzzle') return answer('Find checkmate in one move.');
      const [fen, ...history] = game.history || [];
      if (!fen || fen.split(' ')[1] !== game.playerColor) return answer('Nothing to undo.');
      const positions = game.positions?.length ? game.positions : [game.fen];
      const index = positions.lastIndexOf(fen, positions.length - 2);
      const count = index >= 0 ? positions.length - index - 1 : 2;
      patch = { fen, history, moves: (game.moves || []).slice(0, -count), positions: index >= 0 ? positions.slice(0, index + 1) : [fen], selected: null, promotion: null };
      notice = 'Move undone.';
    } else if (['resign', 'finish', 'stop'].includes(value)) {
      const played = (game.moves?.length || 0) > (game.playerColor === 'b' ? 1 : 0);
      patch = { result: result || (game.mode === 'puzzle' ? 'Skipped' : played || value === 'resign' ? 'Resigned' : 'Cancelled'), setup: {}, selected: null, promotion: null };
      notice = 'Game finished. Final board saved.';
    } else if (value === 'draw') return answer('Draw offers are not available against the computer.');
    else if (value === 'cancel-promotion') patch = { promotion: null, selected: null };
    else if (value === 'new') {
      if (!result) return answer('Finish this game first.');
      if (inlineId) return answer('Mention @IOChessBot again for a new game or puzzle.');
      const list = await db.select().from(games).where(eq(games.userId, userId)).all();
      if (list.filter((item) => !gameResult(item)).length >= 10) return answer('Finish an active game first.');
      const revision = (game.revision || 0) + 1;
      const claimed = await db.update(games).set({ revision }).where(and(eq(games.id, game.id), eq(games.revision, game.revision || 0))).returning().run();
      if (!claimed.length) return answer('A rematch was already requested. Open /games.');
      const next = await createGame(userId, chatId, game.mode || 'classic');
      if (!next) return answer('Finish an active game first.');
      await answer('New game started.');
      await render({ ...game, revision });
      return sendBoard(chatId, next);
    } else return answer();
  }

  if (!original.result && patch.result) {
    patch.outcome = patch.result === 'Solved' ? 'solved' : patch.result === 'Draw' ? 'draw' : patch.result === 'Resigned' ? 'loss'
      : patch.result === 'Checkmate' ? ((patch.fen || game.fen).split(' ')[1] === game.playerColor ? 'loss' : 'win') : null;
  }
  patch.revision = (original.revision || 0) + 1;
  const saved = await db.update(games).set(patch).where(and(eq(games.id, game.id), eq(games.revision, original.revision || 0))).returning().run();
  if (!saved.length) return answer('This board changed. Open the latest game.');
  game = { ...game, ...patch };
  await answer(notice);
  return render(game);
}
