import { api, BotApiError } from 'sdk';
import { boardFromFen, boardSize, emptyEmoji, isThreefold, legalMoves, moveCallback, pieceEmoji, selectedPieceEmoji, stateToken, status, targetEmoji } from 'lib/chess';
import { puzzles } from 'lib/puzzles';

const controls = { flip: '5877410604225924969', undo: '5843799474362652262', finish: '5985346521103604145' };
const pageControls = { previous: '5875078273775439450', next: '5875008416132370818' };
const miniRules = '<p>No castling or double pawn steps. Pawns promote on the last rank.</p>';

function emojiTag(emoji, premium) {
  return premium ? `<tg-emoji emoji-id="${emoji.custom_emoji_id}">${emoji.alternative_text}</tg-emoji>` : emoji.alternative_text;
}

function button(label, data, style = '') {
  const extra = style ? ` style="${style}"` : '';
  return `<tg-button type="callback_data"${extra} data="${data}">${label}</tg-button>`;
}

function boardHtml(fen, flipped, interactive, premium, selected, gameId = '', token = '') {
  const pieces = boardFromFen(fen);
  const { width, height } = boardSize(fen);
  const targets = new Set(selected ? legalMoves(fen, selected).map((move) => move.to) : []);
  const files = [...'abcdefgh'].slice(0, width);
  if (flipped) files.reverse();
  const rows = [`<tr><th></th>${files.map((file) => `<th>${file}</th>`).join('')}<th></th></tr>`];

  for (let row = 0; row < height; row++) {
    const boardRank = flipped ? row + 1 : height - row;
    const cells = [`<th>${boardRank}</th>`];
    for (let col = 0; col < width; col++) {
      const boardFile = flipped ? width - 1 - col : col;
      const index = (boardRank - 1) * width + boardFile;
      const coordinate = `${files[col]}${boardRank}`;
      const emoji = coordinate === selected
        ? selectedPieceEmoji(pieces[index])
        : targets.has(coordinate) && pieces[index] ? selectedPieceEmoji(pieces[index])
        : targets.has(coordinate) ? targetEmoji() : pieces[index] ? pieceEmoji(pieces[index]) : emptyEmoji(boardFile, height - boardRank);
      const content = emojiTag(emoji, premium);
      const callback = targets.has(coordinate) ? moveCallback('mv', `${gameId}:${token}:${selected}${coordinate}`) : pieces[index] ? moveCallback('sq', `${gameId}:${token}:${coordinate}`) : moveCallback('noop', '');
      const cell = (boardRank + boardFile) % 2 === 0 ? 'th' : 'td';
      cells.push(`<${cell} align="center" valign="middle">${interactive ? button(content, callback, 'link') : content}</${cell}>`);
    }
    cells.push(`<th>${boardRank}</th>`);
    rows.push(`<tr>${cells.join('')}</tr>`);
  }

  rows.push(`<tr><th></th>${files.map((file) => `<th>${file}</th>`).join('')}<th></th></tr>`);
  return `<table compact>${rows.join('')}</table>`;
}

function gameResult(game, positionStatus = status(game.fen)) {
  return game.result || ({ checkmate: 'Checkmate', draw: 'Draw' }[positionStatus]
    ?? (isThreefold(game.positions?.length ? game.positions : [game.fen], game.fen) ? 'Draw' : null));
}

export function richBoard(game, premium = true) {
  const isPuzzle = game.mode === 'puzzle';
  const puzzle = isPuzzle ? puzzles.find((item) => item.id === game.puzzleId) : null;
  const positionStatus = status(game.fen);
  const result = gameResult(game, positionStatus);
  if (!result && game.setup?.pending) return gameSetup(game);
  const playerTurn = game.fen.split(' ')[1] === game.playerColor;
  const canMove = !result && !game.promotion && playerTurn;
  const playerColor = game.playerColor === 'b' ? 'Black' : 'White';
  const difficulty = { easy: 'Easy', normal: 'Normal', hard: 'Hard' }[game.difficulty] || 'Normal';
  const outcome = result === 'Checkmate' ? `${playerTurn ? 'Loss' : 'Win'} by checkmate`
    : result === 'Resigned' ? 'Loss by resignation' : result;
  const turn = `${positionStatus === 'check' ? 'Check! ' : ''}${playerTurn ? 'Your turn' : 'Engine to move'}`;
  const moveCount = Math.ceil((game.moves?.length || 0) / 2);
  const firstMove = Math.max(0, moveCount - 20);
  const moveLines = isPuzzle ? (game.moves || []).map((move, index) => `${index + 1}${game.playerColor === 'b' ? '...' : '.'} ${move}`) : Array.from({ length: moveCount - firstMove }, (_, offset) => {
    const index = firstMove + offset;
    return `${index + 1}. ${game.moves[index * 2]}${game.moves[index * 2 + 1] ? ` ${game.moves[index * 2 + 1]}` : ''}`;
  });
  const moves = moveLines.length ? [
    `<blockquote expandable><b>Moves</b><br>${moveLines.join('<br>')}</blockquote>`,
    firstMove ? '<p>/pgn shows the full history of your latest game.</p>' : '',
  ].join('') : '';
  const header = isPuzzle
    ? `<p><b>${puzzle?.title || 'Chess Puzzle'}</b><br>${playerColor} to move: mate in one${result ? `<br>${result}` : ''}</p><p>Puzzles do not change your rating.</p>`
    : `<p><b>${game.mode === 'mini' ? 'Mini-chess 5x6<br>' : ''}You: ${playerColor} | Engine: ${difficulty}</b><br>`
      + `${outcome || turn} | ${moveCount} ${moveCount === 1 ? 'move' : 'moves'}</p>`
      + (game.mode === 'mini' ? miniRules : '');
  if (!result && game.promotion) return { html: header + promotionBoard(game, premium).html + moves };

  const callback = `${game.id}:${stateToken(game)}`;
  const flip = button(`${emojiTag({ custom_emoji_id: controls.flip, alternative_text: '🔄' }, premium)}&nbsp;Flip Board`, moveCallback('act', `${callback}:flip`), 'primary');
  const undoLabel = `${emojiTag({ custom_emoji_id: controls.undo, alternative_text: '🔄' }, premium)}&nbsp;Undo`;
  const undo = game.history?.[0]?.split(' ')[1] === game.playerColor
    ? button(undoLabel, moveCallback('act', `${callback}:undo`))
    : `<tg-button type="disabled">${undoLabel}</tg-button>`;
  const played = (game.moves?.length || 0) > (game.playerColor === 'b' ? 1 : 0);
  return {
    html: [
      header,
      boardHtml(game.fen, game.flipped, canMove, premium, canMove ? game.selected : null, game.id, stateToken(game)),
      moves,
      result ? '' : '<p>Tap a piece, then its destination. Flip Board changes orientation only.</p>',
      `<tg-button-row>${flip}${result ? (game.guestQueryId ? '' : button(isPuzzle ? 'Next Puzzle' : 'Rematch', moveCallback('act', `${callback}:new`), 'success')) : isPuzzle ? '' : undo}</tg-button-row>`,
      result && game.guestQueryId ? '<p>Mention @IOChessBot again to play here, or open <a href="https://t.me/IOChessBot?start=chess">/start in the bot</a>.</p>' : '',
      result || isPuzzle ? '' : `<p>${played ? 'Finish Game resigns and counts as a loss.' : 'Finish Game cancels this unplayed game.'}</p>`,
      result ? '' : `<tg-button-row>${button(isPuzzle ? 'Skip Puzzle' : `${emojiTag({ custom_emoji_id: controls.finish, alternative_text: '❌' }, premium)}&nbsp;Finish Game`, moveCallback('act', `${callback}:stop`), 'danger')}</tg-button-row>`,
    ].join(''),
  };
}

export function gameSetup(game) {
  const callback = `${game.id}:${stateToken(game)}`;
  const colors = { w: 'White', b: 'Black', r: 'Random' };
  const difficulties = { easy: 'Easy', normal: 'Normal', hard: 'Hard' };
  const choices = (options, selected) => Object.entries(options).map(([value, label]) =>
    button(`${label}${value === selected ? ' (selected)' : ''}`, moveCallback('setup', `${callback}:${value}`), value === selected ? 'primary' : '')
  ).join('');
  return {
    html: [
      `<p><b>${game.mode === 'mini' ? 'Mini-chess 5x6' : 'New chess game'}</b><br>Starts automatically when both choices are made.</p>`,
      game.mode === 'mini' ? miniRules : '',
      `<p>Your side: <b>${colors[game.setup?.playerColor] || 'Not chosen'}</b></p>`,
      `<tg-button-row>${choices(colors, game.setup?.playerColor)}</tg-button-row>`,
      `<p>Difficulty: <b>${difficulties[game.setup?.difficulty] || 'Not chosen'}</b></p>`,
      `<tg-button-row>${choices(difficulties, game.setup?.difficulty)}</tg-button-row>`,
      `<tg-button-row>${button('Cancel', moveCallback('act', `${callback}:stop`))}</tg-button-row>`,
    ].join(''),
  };
}

export function promotionBoard(game, premium = true) {
  return {
    html: [
      boardHtml(game.fen, game.flipped, false, premium, null, game.id, stateToken(game)),
      '<p>Choose promotion:</p>',
      `<tg-button-row>${['q', 'r', 'b', 'n'].map((piece) => button(piece.toUpperCase(), moveCallback('promote', `${game.id}:${stateToken(game)}:${piece}`), piece === 'q' ? 'primary' : '')).join('')}</tg-button-row>`,
      `<tg-button-row>${button('Cancel', moveCallback('act', `${game.id}:${stateToken(game)}:cancel-promotion`))}</tg-button-row>`,
    ].join(''),
  };
}

export function gamesMessage(game) {
  const previous = game.page > 0
    ? button(`${emojiTag({ custom_emoji_id: pageControls.previous, alternative_text: '🔝' }, true)}`, moveCallback('page', String(game.page - 1)))
    : `<tg-button type="disabled">${emojiTag({ custom_emoji_id: pageControls.previous, alternative_text: '🔝' }, true)}</tg-button>`;
  const next = game.page + 1 < game.pageCount
    ? button(`${emojiTag({ custom_emoji_id: pageControls.next, alternative_text: '🔽' }, true)}`, moveCallback('page', String(game.page + 1)))
    : `<tg-button type="disabled">${emojiTag({ custom_emoji_id: pageControls.next, alternative_text: '🔽' }, true)}</tg-button>`;
  return {
    html: boardHtml(game.fen, game.flipped, false, true, null)
      + `<tg-button-row align="center">${previous}${button(gameResult(game) ? 'View Game' : 'Continue Game', moveCallback('load', String(game.id)), 'primary')}${next}</tg-button-row>`,
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

export async function editBoard(chatId, messageId, game, inlineMessageId) {
  const target = inlineMessageId ? { inline_message_id: inlineMessageId } : { chat_id: chatId, message_id: messageId };
  try {
    return await api.editMessageText({ ...target, rich_message: richBoard(game) });
  } catch (error) {
    if (!(error instanceof BotApiError) || !error.description.includes('RICH_MESSAGE_EMOJI_INVALID')) throw error;
    return api.editMessageText({ ...target, rich_message: richBoard(game, false) });
  }
}
