import { db } from 'sdk';
import { eq } from 'sdk/db';
import { games, players } from 'schema';
import { initialFen, miniInitialFen } from 'lib/chess';
import { puzzles, puzzleGame } from 'lib/puzzles';

export async function ensurePlayer(user) {
  const name = (user.first_name || 'Player').slice(0, 64);
  const [player] = await db.insert(players).values({ userId: user.id, name })
    .onConflictDoUpdate({ target: players.userId, set: { name } }).returning().run();
  return player;
}

export async function createGame(userId, chatId, mode = 'classic', guestQueryId = null) {
  if (!['classic', 'mini', 'puzzle'].includes(mode)) throw new Error('Unknown game mode');
  if (guestQueryId) {
    const existing = await db.select().from(games).where(eq(games.guestQueryId, guestQueryId)).get();
    if (existing) return existing;
  }
  const list = await db.select().from(games).where(eq(games.userId, userId)).all();
  if (list.filter((game) => !game.result).length >= 10) return null;
  const solved = new Set(list.filter((game) => game.outcome === 'solved').map((game) => game.puzzleId));
  const lastSeen = (id) => Math.max(0, ...list.filter((game) => game.puzzleId === id).map((game) => game.id));
  const puzzle = [...puzzles].sort((a, b) => Number(solved.has(a.id)) - Number(solved.has(b.id)) || lastSeen(a.id) - lastSeen(b.id))[0];
  const fen = mode === 'mini' ? miniInitialFen : initialFen;
  const values = {
    userId, chatId, mode, guestQueryId, fen, history: [], moves: [], positions: [fen],
    playerColor: 'w', difficulty: 'normal', setup: { pending: true }, flipped: false, selected: null,
    ...(mode === 'puzzle' ? puzzleGame(puzzle) : {}),
  };
  const insert = db.insert(games).values(values);
  if (guestQueryId) insert.onConflictDoUpdate({ target: games.guestQueryId, set: { guestQueryId } });
  const [game] = await insert.returning().run();
  return game;
}
