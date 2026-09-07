import { api, db, BotApiError } from 'sdk';
import { eq } from 'sdk/db';
import { games } from 'schema';
import { createGame, ensurePlayer } from 'lib/games';
import { leaderboard } from 'lib/leaderboard';
import { richBoard } from 'lib/reply';

export default async function (message) {
  if (!message.guest_query_id) return;
  const words = (message.text || '').replace(/@[a-z0-9_]+/gi, '').trim().toLowerCase().split(/\s+/).map((word) => word.replace(/^\//, ''));
  const command = words[0];
  const mode = words.includes('mini') ? 'mini' : words.some((word) => /^puzzles?$/.test(word)) ? 'puzzle' : 'classic';
  let game, content;
  if (!message.from?.id || message.sender_chat) content = { html: '<p>Mention me from your personal account to play a game.</p>' };
  else if (command === 'leaderboard') content = await leaderboard(mode);
  else if (command === 'help') content = { html: '<p>Mention @IOChessBot chess, @IOChessBot mini, or @IOChessBot puzzle to play here. Try @IOChessBot leaderboard too.</p><p>The caller controls the board; others can watch or mention me for their own game.</p>' };
  else {
    await ensurePlayer(message.from);
    game = await createGame(message.from.id, message.chat.id, mode, message.guest_query_id);
    if (game?.inlineMessageId) return;
    content = game ? richBoard(game) : { html: '<p>You have 10 active games. Open /games in the bot and finish one first.</p>' };
  }
  const answer = (richMessage) => api.answerGuestQuery({
    guest_query_id: message.guest_query_id,
    result: { type: 'article', id: game ? `game-${game.id}` : 'chess', title: 'Chess', input_message_content: { rich_message: richMessage } },
  });
  let sent;
  try {
    sent = await answer(content);
  } catch (error) {
    if (!game || !(error instanceof BotApiError) || !error.description.includes('RICH_MESSAGE_EMOJI_INVALID')) throw error;
    sent = await answer(richBoard(game, false));
  }
  if (game) await db.update(games).set({ inlineMessageId: sent.inline_message_id }).where(eq(games.id, game.id)).returning().run();
  return sent;
}
