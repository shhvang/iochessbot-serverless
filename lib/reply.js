import { api, BotApiError } from 'sdk';
import { boardFromFen, emptyEmoji, legalMoves, moveCallback, pieceEmoji, selectedPieceEmoji, status, targetEmoji } from 'lib/chess';

const controls = { flip: '5877410604225924969', undo: '5843799474362652262', finish: '5985346521103604145' };
const pageControls = { previous: '5875078273775439450', next: '5875008416132370818' };

function emojiTag(emoji, premium) {
  return premium ? `<tg-emoji emoji-id="${emoji.custom_emoji_id}">${emoji.alternative_text}</tg-emoji>` : emoji.alternative_text;
}

function button(label, data, style = '') {
  const extra = style ? ` style="${style}"` : '';
  return `<tg-button type="callback_data"${extra} data="${data}">${label}</tg-button>`;
}

function boardHtml(fen, flipped, interactive, premium, selected, gameId = '') {
  const pieces = boardFromFen(fen);
  const targets = new Set(selected ? legalMoves(fen, selected).map((move) => move.to) : []);
  const files = flipped ? [...'hgfedcba'] : [...'abcdefgh'];
  const rows = [`<tr><th></th>${files.map((file) => `<th>${file}</th>`).join('')}<th></th></tr>`];

  for (let row = 0; row < 8; row++) {
    const boardRank = flipped ? row + 1 : 8 - row;
    const cells = [`<th>${boardRank}</th>`];
    for (let col = 0; col < 8; col++) {
      const index = (boardRank - 1) * 8 + (flipped ? 7 - col : col);
      const coordinate = `${files[col]}${boardRank}`;
      const emoji = coordinate === selected
        ? selectedPieceEmoji(pieces[index])
        : targets.has(coordinate) && pieces[index] ? selectedPieceEmoji(pieces[index])
        : targets.has(coordinate) ? targetEmoji() : pieces[index] ? pieceEmoji(pieces[index]) : emptyEmoji(col, row);
      const content = emojiTag(emoji, premium);
      const callback = targets.has(coordinate) ? moveCallback('mv', `${gameId}:${selected}${coordinate}`) : pieces[index] ? moveCallback('sq', `${gameId}:${coordinate}`) : moveCallback('noop', '');
      const cell = (row + col) % 2 === 0 ? 'th' : 'td';
      cells.push(`<${cell} align="center" valign="middle">${interactive ? button(content, callback, 'link') : content}</${cell}>`);
    }
    cells.push(`<th>${boardRank}</th>`);
    rows.push(`<tr>${cells.join('')}</tr>`);
  }

  rows.push(`<tr><th></th>${files.map((file) => `<th>${file}</th>`).join('')}<th></th></tr>`);
  return `<table compact>${rows.join('')}</table>`;
}

export function richBoard(game, premium = true) {
  const result = game.result || ({ checkmate: 'Checkmate', draw: 'Draw' }[status(game.fen)] ?? null);
  const undo = game.history.length
    ? button(`${emojiTag({ custom_emoji_id: controls.undo, alternative_text: '🔄' }, premium)}&nbsp;Undo`, moveCallback('act', `${game.id}:undo`))
    : `<tg-button type="disabled">${emojiTag({ custom_emoji_id: controls.undo, alternative_text: '🔄' }, premium)}&nbsp;Undo</tg-button>`;
  return {
    html: `${boardHtml(game.fen, game.flipped, !result, premium, result ? null : game.selected, game.id)}${result ? `<p><b>${result}</b>. Finish this game to start another one.</p>` : '<blockquote>Tap a piece, then the square it goes to. I answer as Black – <b>Flip Board</b> if you would rather play the other side.</blockquote>'}<tg-button-row>${button(`${emojiTag({ custom_emoji_id: controls.flip, alternative_text: '🔄' }, premium)}&nbsp;Flip Board`, moveCallback('act', `${game.id}:flip`))}${undo}</tg-button-row><tg-button-row>${game.history.length ? button(`${emojiTag({ custom_emoji_id: controls.finish, alternative_text: '❌' }, premium)}&nbsp;Finish Game`, moveCallback('act', `${game.id}:stop`)) : `<tg-button type="disabled">${emojiTag({ custom_emoji_id: controls.finish, alternative_text: '❌' }, premium)}&nbsp;Finish Game</tg-button>`}</tg-button-row>`,
  };
}

export function gamesMessage(game) {
  const previous = game.page > 0
    ? button(`${emojiTag({ custom_emoji_id: pageControls.previous, alternative_text: '🔝' }, true)}`, moveCallback('page', String(game.page - 1)))
    : `<tg-button type="disabled">${emojiTag({ custom_emoji_id: pageControls.previous, alternative_text: '🔝' }, true)}</tg-button>`;
  const next = button(`${emojiTag({ custom_emoji_id: pageControls.next, alternative_text: '🔽' }, true)}`, moveCallback('page', String(game.page + 1)));
  return {
    html: `${boardHtml(game.fen, game.flipped, false, true, null)}<tg-button-row align="center">${previous}${button('Continue Game', moveCallback('load', String(game.id)), 'primary')}${next}</tg-button-row>`,
  };
}

export async function editGames(chatId, messageId, game) {
  return api.editMessageText({ chat_id: chatId, message_id: messageId, rich_message: gamesMessage(game) });
}

export async function sendBoard(chatId, game) {
  try {
    return await api.sendRichMessage({ chat_id: chatId, rich_message: richBoard(game) });
  } catch (error) {
    if (!(error instanceof BotApiError) || !error.description.includes('RICH_MESSAGE_EMOJI_INVALID')) throw error;
    return api.sendRichMessage({ chat_id: chatId, rich_message: richBoard(game, false) });
  }
}

export async function editBoard(chatId, messageId, game) {
  try {
    return await api.editMessageText({ chat_id: chatId, message_id: messageId, rich_message: richBoard(game) });
  } catch (error) {
    if (!(error instanceof BotApiError) || !error.description.includes('RICH_MESSAGE_EMOJI_INVALID')) throw error;
    return api.editMessageText({ chat_id: chatId, message_id: messageId, rich_message: richBoard(game, false) });
  }
}
