import { table, integer, text, json } from 'sdk/db';

export const games = table('games', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  userId: integer('user_id').notNull(),
  chatId: integer('chat_id').notNull(),
  fen: text('fen').notNull(),
  history: json('history').notNull().default([]),
  flipped: integer('flipped', { mode: 'boolean' }).notNull().default(false),
  selected: text('selected'),
  result: text('result'),
});
