import { api, db } from 'sdk';
import { desc, eq } from 'sdk/db';
import { games } from 'schema';
import { initialFen } from 'lib/chess';
import { gamesMessage, sendBoard } from 'lib/reply';

const commands = [
  { command: 'start', description: 'New game against the engine' },
  { command: 'games', description: 'Games you have in progress' },
  { command: 'group', description: 'Add a board to one of your groups' },
  { command: 'channel', description: 'Put a board in one of your channels' },
  { command: 'help', description: 'How this works' },
];

function command(text = '') {
  return text.trim().split(/\s+/, 1)[0].toLowerCase().split('@', 1)[0];
}

async function createGame(userId, chatId) {
  const [game] = await db.insert(games).values({ userId, chatId, fen: initialFen, history: [], flipped: false, selected: null })
    .returning().run();
  return game;
}

async function chatGame(userId, chatId) {
  return db.select().from(games).where(eq(games.userId, userId)).all().then((list) => list.find((game) => game.chatId === chatId));
}

async function help(chatId) {
  await api.sendRichMessage({ chat_id: chatId, rich_message: { html: '<p>This bot lets you play chess against a computer, on a board where every square is a button.</p><p>If you add it to a group or channel, everyone will be able to play their own game from the same message.</p><p><b>/start</b> – a new game</p><p><b>/games</b> – pick up one you left</p><p><b>/group</b> – add a board to one of your groups</p><p><b>/channel</b> – put a board in one of your channels</p>' } });
}

async function startGame(userId, chatId) {
  const gamesForUser = await db.select().from(games).where(eq(games.userId, userId)).all();
  if (gamesForUser.length >= 10) {
    await api.sendRichMessage({ chat_id: chatId, rich_message: { html: '<p>You already have 10 active games. Finish one with the <b>Finish Game</b> button, then start a new one.</p>' } });
    return;
  }
  await sendBoard(chatId, await createGame(userId, chatId));
}

async function channelPicker(chatId) {
  await api.sendRichMessage({
    chat_id: chatId,
    rich_message: { html: '<p>Pick a channel and I will post a board in it. Everyone reading it gets their own game on that board, and nobody sees anyone else\'s moves.</p><p>You need to be able to post there yourself. All I ask for is the right to post – the board is never edited once it is up.</p>' },
    reply_markup: { keyboard: [[{ text: 'Choose a channel', request_chat: { request_id: 1, chat_is_channel: true, user_administrator_rights: { can_manage_chat: true, can_post_messages: true }, bot_administrator_rights: { can_manage_chat: true, can_post_messages: true } } }]], resize_keyboard: true, one_time_keyboard: true, is_personal: true },
  });
}

export default async function (message) {
  const chatId = message.chat.id;
  const userId = message.from?.id ?? chatId;
  const action = command(message.text);
  if (['/start', '/games', '/group', '/channel', '/help', '/chess'].includes(action)) {
    await api.setMyCommands({ commands });
  }

  if (message.chat_shared) {
    await startGame(userId, message.chat_shared.chat_id);
    return;
  }

  if (action === '/start') {
    await startGame(userId, chatId);
  } else if (action === '/games') {
    const list = await db.select().from(games).where(eq(games.userId, userId)).orderBy(desc(games.id)).all();
    if (!list.length) return help(chatId);
    await api.sendRichMessage({ chat_id: chatId, rich_message: gamesMessage({ ...list[0], page: 0, pageCount: list.length }) });
  } else if (action === '/help') {
    await help(chatId);
  } else if (action === '/group') {
    await api.sendRichMessage({ chat_id: chatId, rich_message: { html: '<p>Add this bot to any of your groups, then send <b>/chess</b>.</p><p>Or just follow this link – <a href="https://t.me/IOChessBot?startgroup=chess">t.me/IOChessBot?startgroup=chess</a></p>' } });
  } else if (action === '/channel') {
    await channelPicker(chatId);
  } else if (action === '/chess' && message.chat.type !== 'private') {
    const game = await chatGame(userId, chatId);
    await (game ? sendBoard(chatId, game) : startGame(userId, chatId));
  }
}
