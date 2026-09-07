import { api, db } from 'sdk';
import { and, desc, eq } from 'sdk/db';
import { games } from 'schema';
import { engine, initialFen, legalMoves, moveNotation, play, playMove, status } from 'lib/chess';
import { editBoard, editGames, sendBoard } from 'lib/reply';

function action(data) {
  const match = data?.match(/^p:([^:]+):?(.*)$/);
  return match ? { name: match[1], value: match[2] } : null;
}

function resultFor(fen) {
  return ({ checkmate: 'Checkmate', draw: 'Draw' }[status(fen)] ?? null);
}

export default async function (query) {
  const chatId = query.message?.chat?.id;
  const userId = query.from?.id;
  if (!chatId || !userId) return;
  const selected = action(query.data);
  if (!selected) return api.answerCallbackQuery({ callback_query_id: query.id });
  if (selected.name === 'noop') return api.answerCallbackQuery({ callback_query_id: query.id });
  if (selected.name === 'page') {
    const page = Math.max(0, +selected.value || 0);
    const list = await db.select().from(games).where(eq(games.userId, userId)).orderBy(desc(games.id)).all();
    const item = list[page];
    if (!item) return api.answerCallbackQuery({ callback_query_id: query.id });
    await api.answerCallbackQuery({ callback_query_id: query.id });
    return editGames(chatId, query.message.message_id, { ...item, page, pageCount: list.length });
  }
  const scoped = ['sq', 'mv', 'act'].includes(selected.name) ? selected.value.indexOf(':') : -1;
  const gameId = scoped >= 0 ? +selected.value.slice(0, scoped) : null;
  const value = scoped >= 0 ? selected.value.slice(scoped + 1) : selected.value;
  let game = selected.name === 'load'
    ? await db.select().from(games).where(and(eq(games.id, +selected.value), eq(games.userId, userId))).get()
    : gameId
      ? await db.select().from(games).where(and(eq(games.id, gameId), eq(games.userId, userId))).get()
      : (await db.select().from(games).where(and(eq(games.userId, userId), eq(games.chatId, chatId))).orderBy(desc(games.id)).all())[0];
  if (!game && gameId && query.message.chat.type !== 'private') {
    const source = await db.select().from(games).where(and(eq(games.id, gameId), eq(games.chatId, chatId))).get();
    const active = await db.select().from(games).where(eq(games.userId, userId)).all();
    if (source && active.length < 10) {
      [game] = await db.insert(games).values({
        userId,
        chatId,
        fen: source.fen,
        history: source.history,
        moves: source.moves || [],
        flipped: source.flipped,
        selected: null,
        result: source.result,
      }).returning().run();
    }
  }
  if (!game) return api.answerCallbackQuery({ callback_query_id: query.id, text: 'Start a game first.' });


  if (game.result && selected.name !== 'act' && selected.name !== 'load') {
    return api.answerCallbackQuery({ callback_query_id: query.id, text: `${game.result}. Finish this game first.`, show_alert: true });
  }

  if (selected.name === 'mv') {
    const from = value.slice(0, 2), to = value.slice(2), move = legalMoves(game.fen, from).find((item) => item.to === to), fen = move ? playMove(game.fen, move) : null;
    if (game.selected !== from || !fen) return api.answerCallbackQuery({ callback_query_id: query.id });
    const reply = engine(fen), nextFen = reply ? playMove(fen, reply) : fen;
    const history = [game.fen, ...game.history];
    const moves = [...(game.moves || []), moveNotation(game.fen, move), ...(reply ? [moveNotation(fen, reply)] : [])];
    game = { ...game, fen: nextFen, history, moves, selected: null, result: resultFor(nextFen) };
    await db.update(games).set({ fen: game.fen, history, moves, selected: null, result: game.result }).where(eq(games.id, game.id)).run();
    await api.answerCallbackQuery({ callback_query_id: query.id });
    return editBoard(chatId, query.message.message_id, game);
  }

  if (selected.name === 'sq') {
    if (game.selected) {
      const move = legalMoves(game.fen, game.selected).find((item) => item.to === value), fen = move ? playMove(game.fen, move) : null;
      if (!fen) {
        if (legalMoves(game.fen, value).length) {
          game = { ...game, selected: value };
          await db.update(games).set({ selected: value }).where(eq(games.id, game.id)).run();
          await api.answerCallbackQuery({ callback_query_id: query.id });
          return editBoard(chatId, query.message.message_id, game);
        }
        await api.answerCallbackQuery({ callback_query_id: query.id, text: 'That move is not legal.', show_alert: true });
        return;
      }
      const reply = engine(fen);
      const nextFen = reply ? playMove(fen, reply) : fen;
      const history = [game.fen, ...game.history];
      const moves = [...(game.moves || []), moveNotation(game.fen, move), ...(reply ? [moveNotation(fen, reply)] : [])];
      game = { ...game, fen: nextFen, history, moves, selected: null, result: resultFor(nextFen) };
      await db.update(games).set({ fen: game.fen, history, moves, selected: null, result: game.result }).where(eq(games.id, game.id)).run();
    } else if (legalMoves(game.fen, value).length) {
      game = { ...game, selected: value };
      await db.update(games).set({ selected: value }).where(eq(games.id, game.id)).run();
    } else {
      await api.answerCallbackQuery({ callback_query_id: query.id, text: 'Choose one of your pieces.', show_alert: true });
      return;
    }
    await api.answerCallbackQuery({ callback_query_id: query.id });
    return editBoard(chatId, query.message.message_id, game);
  }

  if (selected.name === 'act' && value === 'flip') {
    game = { ...game, flipped: !game.flipped };
    await db.update(games).set({ flipped: game.flipped }).where(eq(games.id, game.id)).run();
    await api.answerCallbackQuery({ callback_query_id: query.id });
    return editBoard(chatId, query.message.message_id, game);
  }
  if (selected.name === 'act' && value === 'undo') {
    const history = [...game.history];
    const fen = history.shift() || initialFen;
    const count = game.fen.split(' ')[1] === 'w' ? 2 : 1;
    const moves = (game.moves || []).slice(0, -count);
    game = { ...game, fen, history, moves, selected: null, result: resultFor(fen) };
    await db.update(games).set({ fen, history, moves, selected: null, result: game.result }).where(eq(games.id, game.id)).run();
    await api.answerCallbackQuery({ callback_query_id: query.id, text: 'Move undone.' });
    return editBoard(chatId, query.message.message_id, game);
  }
  if (selected.name === 'act' && value === 'new') {
    await db.delete(games).where(eq(games.id, game.id)).run();
    const [next] = await db.insert(games).values({ userId, chatId, fen: initialFen, history: [], moves: [], flipped: false, selected: null }).returning().run();
    await api.answerCallbackQuery({ callback_query_id: query.id, text: 'New game started.' });
    return editBoard(chatId, query.message.message_id, next);
  }
  if (selected.name === 'act' && ['finish', 'stop'].includes(value)) {
    await db.delete(games).where(eq(games.id, game.id)).run();
    await api.answerCallbackQuery({ callback_query_id: query.id, text: 'Game finished.' });
    return api.editMessageText({ chat_id: chatId, message_id: query.message.message_id, text: 'Game finished.' });
  }
  if (selected.name === 'load') {
    await api.answerCallbackQuery({ callback_query_id: query.id });
    return sendBoard(chatId, game);
  }
  await api.answerCallbackQuery({ callback_query_id: query.id });
}
