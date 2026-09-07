import { api, db } from 'sdk';
import { desc, eq, sql } from 'sdk/db';
import { games } from 'schema';
import { gamesMessage, sendBoard } from 'lib/reply';
import { createGame, ensurePlayer } from 'lib/games';
import { leaderboard } from 'lib/leaderboard';

const commands = [
  { command: 'start', description: 'New game against the engine' },
  { command: 'new', description: 'Start a configured game' },
  { command: 'games', description: 'Your active and finished games' },
  { command: 'group', description: 'Add a board to one of your groups' },
  { command: 'channel', description: 'Put a board in one of your channels' },
  { command: 'help', description: 'How this works' },
  { command: 'stats', description: 'Your chess statistics' },
  { command: 'pgn', description: 'Export your latest game' },
  { command: 'mini', description: 'Play mini-chess on a 5x6 board' },
  { command: 'puzzle', description: 'Solve a mate-in-one puzzle' },
  { command: 'leaderboard', description: 'Top chess, mini-chess and puzzle players' },
];

function command(text = '') {
  return text.trim().split(/\s+/, 1)[0].toLowerCase().split('@', 1)[0];
}

async function chatGame(userId, chatId) {
  return db.select().from(games).where(eq(games.userId, userId)).all().then((list) => list.filter((game) => game.chatId === chatId).sort((a, b) => b.id - a.id)[0]);
}

async function help(chatId) {
  await api.sendRichMessage({ chat_id: chatId, rich_message: { html: '<p>Play chess against a computer. Tap a piece, then its destination.</p><p><b>/new</b> - classic chess<br><b>/mini</b> - 5x6 mini-chess<br><b>/puzzle</b> - mate in one<br><b>/leaderboard</b> - top players (also: mini or puzzle)<br><b>/games</b> - active and finished games<br><b>/stats</b> - your record<br><b>/pgn</b> - export your latest game</p><p><b>Play anywhere:</b> mention @IOChessBot mini or @IOChessBot puzzle in a chat. No need to add the bot. Only the caller controls their board.</p><p><b>/group</b> or <b>/channel</b> - post your board for others to watch.</p>' } });
}

async function startGame(userId, chatId, mode = 'classic') {
  const game = await createGame(userId, chatId, mode);
  if (!game) {
    await api.sendRichMessage({ chat_id: chatId, rich_message: { html: '<p>You already have 10 active games. Finish one with the <b>Finish Game</b> button, then start a new one.</p>' } });
    return;
  }
  await sendBoard(chatId, game);
}

async function channelPicker(chatId) {
  await api.sendRichMessage({
    chat_id: chatId,
    rich_message: { html: '<p>Pick a channel to post your board. Everyone can watch, but only you can play it.</p><p>You need permission to post there. For a private game, use /new in this chat instead.</p>' },
    reply_markup: { keyboard: [[{ text: 'Choose a channel', request_chat: { request_id: 1, chat_is_channel: true, user_administrator_rights: { can_manage_chat: true, can_post_messages: true }, bot_administrator_rights: { can_manage_chat: true, can_post_messages: true } } }]], resize_keyboard: true, one_time_keyboard: true, is_personal: true },
  });
}

export default async function (message) {
  const chatId = message.chat.id;
  const userId = message.from?.id ?? chatId;
  const action = command(message.text);
  if (commands.some((item) => `/${item.command}` === action) || action === '/chess') {
    await api.setMyCommands({ commands });
    if (!message.from?.id || message.sender_chat) return api.sendMessage({ chat_id: chatId, text: 'Use your personal account to play and track your results.' });
    await ensurePlayer(message.from);
  }

  if (message.chat_shared) {
    await startGame(userId, message.chat_shared.chat_id);
    return;
  }

  if (['/start', '/new', '/mini', '/puzzle'].includes(action)) {
    const argument = message.text.trim().split(/\s+/)[1];
    const mode = action === '/mini' || (action === '/start' && argument === 'mini') ? 'mini'
      : action === '/puzzle' || (action === '/start' && argument === 'puzzle') ? 'puzzle' : 'classic';
    await startGame(userId, chatId, mode);
  } else if (action === '/leaderboard') {
    const mode = message.text.trim().split(/\s+/)[1]?.toLowerCase();
    await api.sendRichMessage({ chat_id: chatId, rich_message: await leaderboard(mode) });
  } else if (action === '/games') {
    if (message.chat.type !== 'private') return api.sendMessage({ chat_id: chatId, text: 'Open /games in a private chat with me to browse your games.' });
    const list = await db.select().from(games).where(eq(games.userId, userId)).orderBy(desc(games.id)).all();
    if (!list.length) return help(chatId);
    await api.sendRichMessage({ chat_id: chatId, rich_message: gamesMessage({ ...list[0], page: 0, pageCount: list.length }) });
  } else if (action === '/help') {
    await help(chatId);
  } else if (action === '/stats') {
    const player = await ensurePlayer(message.from);
    const totals = await db.select({
      wins: sql`coalesce(sum(case when ${games.mode} = 'classic' and ${games.outcome} = 'win' then 1 else 0 end), 0)`,
      losses: sql`coalesce(sum(case when ${games.mode} = 'classic' and ${games.outcome} = 'loss' then 1 else 0 end), 0)`,
      draws: sql`coalesce(sum(case when ${games.mode} = 'classic' and ${games.outcome} = 'draw' then 1 else 0 end), 0)`,
      miniWins: sql`coalesce(sum(case when ${games.mode} = 'mini' and ${games.outcome} = 'win' then 1 else 0 end), 0)`,
      miniLosses: sql`coalesce(sum(case when ${games.mode} = 'mini' and ${games.outcome} = 'loss' then 1 else 0 end), 0)`,
      miniDraws: sql`coalesce(sum(case when ${games.mode} = 'mini' and ${games.outcome} = 'draw' then 1 else 0 end), 0)`,
      solved: sql`count(distinct case when ${games.outcome} = 'solved' then ${games.puzzleId} end)`,
    }).from(games).where(eq(games.userId, userId)).get();
    await api.sendRichMessage({ chat_id: chatId, rich_message: { html: `<p><b>Your chess stats</b></p><p>Wins: ${player.wins + totals.wins}<br>Losses: ${player.losses + totals.losses}<br>Draws: ${player.draws + totals.draws}<br>Bot score: <b>${player.rating + 10 * (totals.wins - totals.losses)}</b></p><p><b>Mini-chess</b><br>${totals.miniWins} wins / ${totals.miniLosses} losses / ${totals.miniDraws} draws<br>Bot score: ${1000 + 10 * (totals.miniWins - totals.miniLosses)}</p><p><b>Puzzles</b><br>${totals.solved} unique puzzles solved</p><p>Bot score changes by +10 for a win and -10 for a loss. It is not an Elo rating.</p>` } });
  } else if (action === '/pgn') {
    const game = (await db.select().from(games).where(eq(games.userId, userId)).orderBy(desc(games.id)).all())[0];
    if (!game) return help(chatId);
    const pgn = game.mode === 'puzzle' && game.playerColor === 'b'
      ? (game.moves || []).map((move, index) => `${index + 1}... ${move}`).join(' ')
      : (game.moves || []).reduce((text, move, index) => `${text}${index % 2 === 0 ? `${index / 2 + 1}. ` : ''}${move} `, '').trim();
    await api.sendMessage({ chat_id: chatId, text: pgn || 'No moves in the latest game.' });
  } else if (action === '/group') {
    await api.sendRichMessage({ chat_id: chatId, rich_message: { html: '<p>Add this bot to any of your groups, then send <b>/chess</b>.</p><p>Or just follow this link – <a href="https://t.me/IOChessBot?startgroup=chess">t.me/IOChessBot?startgroup=chess</a></p>' } });
  } else if (action === '/channel') {
    await channelPicker(chatId);
  } else if (action === '/chess' && message.chat.type !== 'private') {
    const game = await chatGame(userId, chatId);
    await (game ? sendBoard(chatId, game) : startGame(userId, chatId));
  }
}
