import { table, integer, text, json, uniqueIndex } from 'sdk/db';

export const games = table('games', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  userId: integer('user_id').notNull(),
  chatId: integer('chat_id').notNull(),
  fen: text('fen').notNull(),
  history: json('history').notNull().default([]),
  moves: json('moves').notNull().default([]),
  positions: json('positions').notNull().default([]),
  playerColor: text('player_color').notNull().default('w'),
  difficulty: text('difficulty').notNull().default('normal'),
  promotion: text('promotion'),
  drawOffer: integer('draw_offer'),
  setup: json('setup').notNull().default({}),
  flipped: integer('flipped', { mode: 'boolean' }).notNull().default(false),
  selected: text('selected'),
  result: text('result'),
  outcome: text('outcome'),
  revision: integer('revision').notNull().default(0),
  mode: text('mode').notNull().default('classic'),
  puzzleId: text('puzzle_id'),
  guestQueryId: text('guest_query_id'),
  inlineMessageId: text('inline_message_id'),
}, (t) => ({ guestQuery: uniqueIndex('games_guest_query_id_unique').on(t.guestQueryId) }));

export const players = table('players', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  userId: integer('user_id').notNull().unique(),
  name: text('name').notNull().default('Player'),
  wins: integer('wins').notNull().default(0),
  losses: integer('losses').notNull().default(0),
  draws: integer('draws').notNull().default(0),
  rating: integer('rating').notNull().default(1000),
});
