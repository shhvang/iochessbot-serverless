const pieceIds = {
  R: '5469768635323032101', N: '5469865151828110432', B: '5469665856755638615', Q: '5467752654983702502', K: '5467393935020170256', P: '5469921214036223278',
  r: '5470104136693362691', n: '5469892403395602271', b: '5469961088512598930', q: '5469713225949948533', k: '5470074673217787995', p: '5469995525560381442',
};
const selectedPieceIds = {
  P: '5474352868666417129', R: '5472381465792652517', N: '5474347487072394765',
  B: '5474297596732283645', Q: '5472283562013140759', K: '5472083107299500051',
  p: '5474420862293678532', r: '5472240273037763229', n: '5472166468319750320',
  b: '5471913129673797137', q: '5474287421954758903', k: '5472198938272509926',
};
const alternatives = {
  '5469768635323032101': '🗿', '5469865151828110432': '🐴', '5469665856755638615': '🐘', '5467752654983702502': '👸', '5467393935020170256': '🤴', '5469921214036223278': '♟',
  '5470104136693362691': '🗿', '5469892403395602271': '🐴', '5469961088512598930': '🐘', '5469713225949948533': '👸', '5470074673217787995': '🤴', '5469995525560381442': '♟',
};
const empty = ['5220005833110199517'];
const target = { custom_emoji_id: '5474473625966913073', alternative_text: '⬛️' };

export const initialFen = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';

const color = (piece) => piece && (piece === piece.toUpperCase() ? 'w' : 'b');
const file = (square) => square.charCodeAt(0) - 97;
const rank = (square) => +square[1] - 1;
const square = (f, r) => f >= 0 && f < 8 && r >= 0 && r < 8 ? `${String.fromCharCode(97 + f)}${r + 1}` : null;

export function boardFromFen(fen) {
  return fen.split(' ')[0].split('/').reverse().flatMap((row) => [...row].flatMap((cell) => /[1-8]/.test(cell) ? Array(+cell).fill(null) : cell));
}

function read(fen) {
  const [placement, turn, castling, ep, half, full] = fen.split(' ');
  return { board: boardFromFen(fen), turn, castling, ep, half: +half, full: +full };
}

function write(s) {
  const rows = [];
  for (let r = 7; r >= 0; r--) {
    let row = '', empty = 0;
    for (let f = 0; f < 8; f++) {
      const piece = s.board[r * 8 + f];
      if (!piece) empty++;
      else { if (empty) row += empty, empty = 0; row += piece; }
    }
    if (empty) row += empty;
    rows.push(row);
  }
  return `${rows.join('/')} ${s.turn} ${s.castling || '-'} ${s.ep || '-'} ${s.half} ${s.full}`;
}

function attacked(s, target, by) {
  const tf = file(target), tr = rank(target);
  const pawn = by === 'w' ? 'P' : 'p';
  for (const df of [-1, 1]) {
    const f = tf + df, r = tr + (by === 'w' ? -1 : 1);
    if (f >= 0 && f < 8 && r >= 0 && r < 8 && s.board[r * 8 + f] === pawn) return true;
  }
  const knight = by === 'w' ? 'N' : 'n';
  for (const [df, dr] of [[1, 2], [2, 1], [-1, 2], [-2, 1], [1, -2], [2, -1], [-1, -2], [-2, -1]]) {
    const f = tf + df, r = tr + dr;
    if (f >= 0 && f < 8 && r >= 0 && r < 8 && s.board[r * 8 + f] === knight) return true;
  }
  const king = by === 'w' ? 'K' : 'k';
  for (const df of [-1, 0, 1]) for (const dr of [-1, 0, 1]) {
    const f = tf + df, r = tr + dr;
    if ((df || dr) && f >= 0 && f < 8 && r >= 0 && r < 8 && s.board[r * 8 + f] === king) return true;
  }
  for (const [df, dr, pieces] of [[1, 0, 'RQ'], [-1, 0, 'RQ'], [0, 1, 'RQ'], [0, -1, 'RQ'], [1, 1, 'BQ'], [-1, 1, 'BQ'], [1, -1, 'BQ'], [-1, -1, 'BQ']]) {
    for (let f = tf + df, r = tr + dr; f >= 0 && f < 8 && r >= 0 && r < 8; f += df, r += dr) {
      const piece = s.board[r * 8 + f];
      if (piece) { if (color(piece) === by && pieces.includes(piece.toUpperCase())) return true; break; }
    }
  }
  return false;
}

function inCheck(s, side) {
  const index = s.board.findIndex((piece) => piece === (side === 'w' ? 'K' : 'k'));
  return index >= 0 && attacked(s, square(index % 8, Math.floor(index / 8)), side === 'w' ? 'b' : 'w');
}

function apply(s, move) {
  const next = { ...s, board: [...s.board], castling: s.castling, ep: '-', half: s.half + 1, full: s.full + (s.turn === 'b' ? 1 : 0), turn: s.turn === 'w' ? 'b' : 'w' };
  const from = file(move.from) + rank(move.from) * 8, to = file(move.to) + rank(move.to) * 8;
  const piece = next.board[from];
  next.board[from] = null;
  const captured = next.board[to];
  next.board[to] = move.promotion || piece;
  if (move.enPassant) next.board[rank(move.from) * 8 + file(move.to)] = null;
  if (piece.toUpperCase() === 'P' || captured) next.half = 0;
  if (piece.toUpperCase() === 'P' && Math.abs(rank(move.to) - rank(move.from)) === 2) next.ep = square(file(move.from), (rank(move.from) + rank(move.to)) / 2);
  if (piece === 'K') next.castling = next.castling.replace('K', '').replace('Q', '');
  if (piece === 'k') next.castling = next.castling.replace('k', '').replace('q', '');
  if (move.from === 'a1' || move.to === 'a1') next.castling = next.castling.replace('Q', '');
  if (move.from === 'h1' || move.to === 'h1') next.castling = next.castling.replace('K', '');
  if (move.from === 'a8' || move.to === 'a8') next.castling = next.castling.replace('q', '');
  if (move.from === 'h8' || move.to === 'h8') next.castling = next.castling.replace('k', '');
  if (move.castle) {
    const rookFrom = move.to[0] === 'g' ? `${move.to[0] === 'g' ? 'h' : 'a'}${move.to[1]}` : `a${move.to[1]}`;
    const rookTo = move.to[0] === 'g' ? `f${move.to[1]}` : `d${move.to[1]}`;
    next.board[rank(rookTo) * 8 + file(rookTo)] = next.board[rank(rookFrom) * 8 + file(rookFrom)];
    next.board[rank(rookFrom) * 8 + file(rookFrom)] = null;
  }
  return next;
}

function pseudo(s, from) {
  const piece = s.board[rank(from) * 8 + file(from)], result = [], side = color(piece), kind = piece?.toUpperCase();
  if (!piece || side !== s.turn) return result;
  const add = (to, extra = {}) => {
    if (!to) return;
    const target = s.board[rank(to) * 8 + file(to)];
    if ((!target || color(target) !== side) && target?.toUpperCase() !== 'K') result.push({ from, to, ...extra });
  };
  if (kind === 'P') {
    const dir = side === 'w' ? 1 : -1, start = side === 'w' ? 1 : 6, end = side === 'w' ? 7 : 0;
    const one = square(file(from), rank(from) + dir), two = square(file(from), rank(from) + dir * 2);
    if (one && !s.board[rank(one) * 8 + file(one)]) { add(one, rank(one) === end ? { promotion: side === 'w' ? 'Q' : 'q' } : {}); if (rank(from) === start && !s.board[rank(two) * 8 + file(two)]) add(two); }
    for (const df of [-1, 1]) { const to = square(file(from) + df, rank(from) + dir); if (to && (s.board[rank(to) * 8 + file(to)] || to === s.ep)) add(to, { ...(rank(to) === end ? { promotion: side === 'w' ? 'Q' : 'q' } : {}), ...(to === s.ep ? { enPassant: true } : {}) }); }
  } else if (kind === 'N' || kind === 'K') {
    const offsets = kind === 'N' ? [[1, 2], [2, 1], [-1, 2], [-2, 1], [1, -2], [2, -1], [-1, -2], [-2, -1]] : [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [-1, 1], [1, -1], [-1, -1]];
    for (const [df, dr] of offsets) add(square(file(from) + df, rank(from) + dr));
    if (kind === 'K' && !attacked(s, from, side === 'w' ? 'b' : 'w')) {
      for (const [to, rights, between, crossed] of [['g1', 'K', ['f1'], ['f1', 'g1']], ['c1', 'Q', ['b1', 'c1', 'd1'], ['d1', 'c1']], ['g8', 'k', ['f8'], ['f8', 'g8']], ['c8', 'q', ['b8', 'c8', 'd8'], ['d8', 'c8']]]) {
        const home = side === 'w' ? 'e1' : 'e8';
        const enemy = side === 'w' ? 'b' : 'w';
        if (from === home && s.castling.includes(rights) && !between.some((x) => s.board[rank(x) * 8 + file(x)]) && !crossed.some((x) => attacked(s, x, enemy))) add(to, { castle: true });
      }
    }
  } else {
    const dirs = kind === 'B' ? [[1, 1], [-1, 1], [1, -1], [-1, -1]] : kind === 'R' ? [[1, 0], [-1, 0], [0, 1], [0, -1]] : [[1, 1], [-1, 1], [1, -1], [-1, -1], [1, 0], [-1, 0], [0, 1], [0, -1]];
    for (const [df, dr] of dirs) for (let f = file(from) + df, r = rank(from) + dr; f >= 0 && f < 8 && r >= 0 && r < 8; f += df, r += dr) { const to = square(f, r); add(to); if (s.board[r * 8 + f]) break; }
  }
  return result;
}

export function legalMoves(fen, from) {
  const s = read(fen), moves = from ? pseudo(s, from) : s.board.flatMap((piece, i) => piece && color(piece) === s.turn ? pseudo(s, square(i % 8, Math.floor(i / 8))) : []);
  return moves.filter((move) => !inCheck(apply(s, move), s.turn));
}

export function play(fen, from, to) {
  const move = legalMoves(fen, from).find((item) => item.to === to);
  return move ? write(apply(read(fen), move)) : null;
}

export function playMove(fen, move) {
  return move ? write(apply(read(fen), move)) : null;
}

const values = { P: 100, N: 320, B: 330, R: 500, Q: 900, K: 20000 };

function evaluate(s) {
  if (inCheck(s, 'w') && !legalStateMoves(s).length && s.turn === 'w') return 999999;
  if (inCheck(s, 'b') && !legalStateMoves(s).length && s.turn === 'b') return -999999;
  return s.board.reduce((score, piece) => piece ? score + (color(piece) === 'b' ? values[piece.toUpperCase()] : -values[piece]) : score, 0);
}

function legalStateMoves(s) {
  return s.board.flatMap((piece, i) => piece && color(piece) === s.turn ? pseudo(s, square(i % 8, Math.floor(i / 8))) : [])
    .filter((move) => !inCheck(apply(s, move), s.turn));
}

function orderedMoves(s) {
  return legalStateMoves(s).sort((a, b) => {
    const capture = (move) => s.board[rank(move.to) * 8 + file(move.to)] ? values[s.board[rank(move.to) * 8 + file(move.to)].toUpperCase()] : 0;
    return capture(b) - capture(a);
  });
}

function search(s, depth, alpha, beta) {
  const moves = orderedMoves(s);
  if (!depth || !moves.length) return { score: evaluate(s) };
  const maximizing = s.turn === 'b';
  let best = maximizing ? -Infinity : Infinity;
  let bestMove = null;
  for (const move of moves) {
    const score = search(apply(s, move), depth - 1, alpha, beta).score;
    if (maximizing ? score > best : score < best) best = score, bestMove = move;
    if (maximizing) alpha = Math.max(alpha, best); else beta = Math.min(beta, best);
    if (beta <= alpha) break;
  }
  return { score: best, move: bestMove };
}

export function engine(fen) {
  const state = read(fen);
  return search(state, 2, -Infinity, Infinity).move;
}

export function status(fen) {
  const state = read(fen), moves = legalStateMoves(state);
  if (moves.length) return inCheck(state, state.turn) ? 'check' : 'playing';
  return inCheck(state, state.turn) ? 'checkmate' : 'draw';
}

export function pieceEmoji(piece) {
  if (!piece) return { type: 'custom_emoji', custom_emoji_id: empty[0], alternative_text: '🫣' };
  return { type: 'custom_emoji', custom_emoji_id: pieceIds[piece], alternative_text: alternatives[pieceIds[piece]] };
}

export function selectedPieceEmoji(piece) {
  return { type: 'custom_emoji', custom_emoji_id: selectedPieceIds[piece], alternative_text: alternatives[pieceIds[piece]] };
}

export function targetEmoji() {
  return { type: 'custom_emoji', ...target };
}

export function emptyEmoji(file, rank) {
  return { type: 'custom_emoji', custom_emoji_id: empty[0], alternative_text: '🫣' };
}

export function moveCallback(action, value) { return `p:${action}:${value}`; }
