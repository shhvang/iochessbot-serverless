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
export const miniInitialFen = 'kqbnr/ppppp/5/5/PPPPP/RNBQK w - - 0 1';

export function positionKey(fen) {
  const parts = fen.split(' ');
  if (parts[3] !== '-' && !legalMoves(fen).some((move) => move.enPassant)) parts[3] = '-';
  return parts.slice(0, 4).join(' ');
}

export function isThreefold(positions = [], fen) {
  const key = positionKey(fen);
  return positions.filter((item) => positionKey(item) === key).length >= 3;
}

export function stateToken(game) {
  let hash = 2166136261;
  for (const char of JSON.stringify([game.id, game.revision || 0, game.fen, game.selected, game.promotion, game.setup, game.result, game.flipped])) {
    hash ^= char.charCodeAt(0);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36);
}

const color = (piece) => piece && (piece === piece.toUpperCase() ? 'w' : 'b');
const file = (square) => square.charCodeAt(0) - 97;
const rank = (square) => +square[1] - 1;
const square = (s, f, r) => f >= 0 && f < s.width && r >= 0 && r < s.height ? `${String.fromCharCode(97 + f)}${r + 1}` : null;
const index = (s, square) => rank(square) * s.width + file(square);
const at = (s, square) => s.board[index(s, square)];

export function boardSize(fen) {
  const rows = fen.split(' ')[0].split('/');
  return { width: [...rows[0]].reduce((size, cell) => size + (/\d/.test(cell) ? +cell : 1), 0), height: rows.length };
}

export function boardFromFen(fen) {
  return fen.split(' ')[0].split('/').reverse().flatMap((row) => [...row].flatMap((cell) => /[1-8]/.test(cell) ? Array(+cell).fill(null) : cell));
}

function read(fen) {
  const [placement, turn, castling, ep, half, full] = fen.split(' ');
  const { width, height } = boardSize(fen), mini = width === 5 && height === 6;
  return { board: boardFromFen(fen), width, height, mini, turn, castling: mini ? '-' : castling, ep: mini ? '-' : ep, half: +half, full: +full };
}

function write(s) {
  const rows = [];
  for (let r = s.height - 1; r >= 0; r--) {
    let row = '', empty = 0;
    for (let f = 0; f < s.width; f++) {
      const piece = s.board[r * s.width + f];
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
    if (f >= 0 && f < s.width && r >= 0 && r < s.height && s.board[r * s.width + f] === pawn) return true;
  }
  const knight = by === 'w' ? 'N' : 'n';
  for (const [df, dr] of [[1, 2], [2, 1], [-1, 2], [-2, 1], [1, -2], [2, -1], [-1, -2], [-2, -1]]) {
    const f = tf + df, r = tr + dr;
    if (f >= 0 && f < s.width && r >= 0 && r < s.height && s.board[r * s.width + f] === knight) return true;
  }
  const king = by === 'w' ? 'K' : 'k';
  for (const df of [-1, 0, 1]) for (const dr of [-1, 0, 1]) {
    const f = tf + df, r = tr + dr;
    if ((df || dr) && f >= 0 && f < s.width && r >= 0 && r < s.height && s.board[r * s.width + f] === king) return true;
  }
  for (const [df, dr, pieces] of [[1, 0, 'RQ'], [-1, 0, 'RQ'], [0, 1, 'RQ'], [0, -1, 'RQ'], [1, 1, 'BQ'], [-1, 1, 'BQ'], [1, -1, 'BQ'], [-1, -1, 'BQ']]) {
    for (let f = tf + df, r = tr + dr; f >= 0 && f < s.width && r >= 0 && r < s.height; f += df, r += dr) {
      const piece = s.board[r * s.width + f];
      if (piece) { if (color(piece) === by && pieces.includes(piece.toUpperCase())) return true; break; }
    }
  }
  return false;
}

function inCheck(s, side) {
  const index = s.board.findIndex((piece) => piece === (side === 'w' ? 'K' : 'k'));
  return index >= 0 && attacked(s, square(s, index % s.width, Math.floor(index / s.width)), side === 'w' ? 'b' : 'w');
}

function apply(s, move) {
  const next = { ...s, board: [...s.board], castling: s.castling, ep: '-', half: s.half + 1, full: s.full + (s.turn === 'b' ? 1 : 0), turn: s.turn === 'w' ? 'b' : 'w' };
  const from = index(s, move.from), to = index(s, move.to);
  const piece = next.board[from];
  next.board[from] = null;
  const captured = next.board[to];
  next.board[to] = move.promotion || piece;
  if (move.enPassant) next.board[rank(move.from) * s.width + file(move.to)] = null;
  if (piece.toUpperCase() === 'P' || captured) next.half = 0;
  if (!s.mini && piece.toUpperCase() === 'P' && Math.abs(rank(move.to) - rank(move.from)) === 2) next.ep = square(s, file(move.from), (rank(move.from) + rank(move.to)) / 2);
  if (!s.mini) {
    if (piece === 'K') next.castling = next.castling.replace('K', '').replace('Q', '');
    if (piece === 'k') next.castling = next.castling.replace('k', '').replace('q', '');
    if (move.from === 'a1' || move.to === 'a1') next.castling = next.castling.replace('Q', '');
    if (move.from === 'h1' || move.to === 'h1') next.castling = next.castling.replace('K', '');
    if (move.from === 'a8' || move.to === 'a8') next.castling = next.castling.replace('q', '');
    if (move.from === 'h8' || move.to === 'h8') next.castling = next.castling.replace('k', '');
  }
  if (move.castle) {
    const rookFrom = move.to[0] === 'g' ? `h${move.to[1]}` : `a${move.to[1]}`;
    const rookTo = move.to[0] === 'g' ? `f${move.to[1]}` : `d${move.to[1]}`;
    next.board[index(s, rookTo)] = next.board[index(s, rookFrom)];
    next.board[index(s, rookFrom)] = null;
  }
  return next;
}

function pseudo(s, from) {
  if (!/^[a-h][1-8]$/.test(from) || file(from) >= s.width || rank(from) >= s.height) return [];
  const piece = at(s, from), result = [], side = color(piece), kind = piece?.toUpperCase();
  if (!piece || side !== s.turn) return result;
  const add = (to, extra = {}) => {
    if (!to) return;
    const target = at(s, to);
    if ((!target || color(target) !== side) && target?.toUpperCase() !== 'K') result.push({ from, to, ...extra });
  };
  if (kind === 'P') {
    const dir = side === 'w' ? 1 : -1, start = side === 'w' ? 1 : s.height - 2, end = side === 'w' ? s.height - 1 : 0;
    const one = square(s, file(from), rank(from) + dir), two = square(s, file(from), rank(from) + dir * 2);
    const promotions = side === 'w' ? ['Q', 'R', 'B', 'N'] : ['q', 'r', 'b', 'n'];
    if (one && !at(s, one)) {
      for (const promotion of rank(one) === end ? promotions : [null]) add(one, promotion ? { promotion } : {});
      if (!s.mini && rank(from) === start && !at(s, two)) add(two);
    }
    for (const df of [-1, 1]) {
      const to = square(s, file(from) + df, rank(from) + dir);
      if (!to || (!at(s, to) && to !== s.ep)) continue;
      for (const promotion of rank(to) === end ? promotions : [null]) add(to, { ...(promotion ? { promotion } : {}), ...(to === s.ep ? { enPassant: true } : {}) });
    }
  } else if (kind === 'N' || kind === 'K') {
    const offsets = kind === 'N' ? [[1, 2], [2, 1], [-1, 2], [-2, 1], [1, -2], [2, -1], [-1, -2], [-2, -1]] : [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [-1, 1], [1, -1], [-1, -1]];
    for (const [df, dr] of offsets) add(square(s, file(from) + df, rank(from) + dr));
    if (!s.mini && kind === 'K' && !attacked(s, from, side === 'w' ? 'b' : 'w')) {
      for (const [to, rights, between, crossed] of [['g1', 'K', ['f1', 'g1'], ['f1', 'g1']], ['c1', 'Q', ['b1', 'c1', 'd1'], ['d1', 'c1']], ['g8', 'k', ['f8', 'g8'], ['f8', 'g8']], ['c8', 'q', ['b8', 'c8', 'd8'], ['d8', 'c8']]]) {
        const home = side === 'w' ? 'e1' : 'e8';
        const enemy = side === 'w' ? 'b' : 'w';
        const rookSquare = to[0] === 'g' ? `h${to[1]}` : `a${to[1]}`;
        const rook = side === 'w' ? 'R' : 'r';
        if (from === home && s.castling.includes(rights) && at(s, rookSquare) === rook && !between.some((x) => at(s, x)) && !crossed.some((x) => attacked(s, x, enemy))) add(to, { castle: true });
      }
    }
  } else {
    const dirs = kind === 'B' ? [[1, 1], [-1, 1], [1, -1], [-1, -1]] : kind === 'R' ? [[1, 0], [-1, 0], [0, 1], [0, -1]] : [[1, 1], [-1, 1], [1, -1], [-1, -1], [1, 0], [-1, 0], [0, 1], [0, -1]];
    for (const [df, dr] of dirs) for (let f = file(from) + df, r = rank(from) + dr; f >= 0 && f < s.width && r >= 0 && r < s.height; f += df, r += dr) { const to = square(s, f, r); add(to); if (s.board[r * s.width + f]) break; }
  }
  return result;
}

export function legalMoves(fen, from) {
  const s = read(fen), moves = from ? pseudo(s, from) : s.board.flatMap((piece, i) => piece && color(piece) === s.turn ? pseudo(s, square(s, i % s.width, Math.floor(i / s.width))) : []);
  return moves.filter((move) => !inCheck(apply(s, move), s.turn));
}

export function play(fen, from, to) {
  const move = legalMoves(fen, from).find((item) => item.to === to);
  return move ? write(apply(read(fen), move)) : null;
}

export function playMove(fen, move) {
  return move ? write(apply(read(fen), move)) : null;
}

export function moveNotation(fen, move) {
  const state = read(fen), piece = at(state, move.from);
  const target = at(state, move.to) || (move.enPassant ? 'p' : null);
  const capture = target ? 'x' : '';
  const name = piece.toUpperCase() === 'P' ? (capture ? move.from[0] : '') : piece.toUpperCase();
  const others = piece.toUpperCase() === 'P' ? [] : legalMoves(fen).filter((item) => item.from !== move.from && item.to === move.to && at(state, item.from) === piece);
  const disambiguation = !others.length ? '' : !others.some((item) => item.from[0] === move.from[0]) ? move.from[0] : !others.some((item) => item.from[1] === move.from[1]) ? move.from[1] : move.from;
  const promotion = move.promotion ? `=${move.promotion.toUpperCase()}` : '';
  const after = apply(state, move);
  const suffix = inCheck(after, after.turn) ? (legalStateMoves(after).length ? '+' : '#') : '';
  const notation = move.castle ? (move.to[0] === 'g' ? 'O-O' : 'O-O-O') : `${name}${disambiguation}${capture}${move.to}${promotion}`;
  return `${notation}${suffix}`;
}

const values = { P: 100, N: 320, B: 330, R: 500, Q: 900, K: 20000 };

function evaluate(s) {
  const moves = legalStateMoves(s);
  if (!moves.length) return inCheck(s, s.turn) ? (s.turn === 'w' ? 999999 : -999999) : 0;
  return s.board.reduce((score, piece) => piece ? score + (color(piece) === 'b' ? values[piece.toUpperCase()] : -values[piece]) : score, 0);
}

function legalStateMoves(s) {
  return s.board.flatMap((piece, i) => piece && color(piece) === s.turn ? pseudo(s, square(s, i % s.width, Math.floor(i / s.width))) : [])
    .filter((move) => !inCheck(apply(s, move), s.turn));
}

function orderedMoves(s) {
  return legalStateMoves(s).sort((a, b) => {
    const capture = (move) => at(s, move.to) ? values[at(s, move.to).toUpperCase()] : 0;
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

export function engine(fen, difficulty = 'normal') {
  const state = read(fen);
  const moves = legalStateMoves(state);
  if (!moves.length || status(fen) === 'draw') return null;
  if (difficulty === 'easy') return moves[Math.floor(Math.random() * moves.length)];
  return search(state, difficulty === 'hard' ? 3 : 2, -Infinity, Infinity).move;
}

export function status(fen) {
  const state = read(fen), moves = legalStateMoves(state);
  if (!moves.length) return inCheck(state, state.turn) ? 'checkmate' : 'draw';
  const minors = state.board.filter((piece) => piece && piece.toUpperCase() !== 'K');
  const bishopSquares = state.board.flatMap((piece, index) => piece?.toUpperCase() === 'B' ? [index] : []);
  const insufficient = !minors.length
    || (minors.length === 1 && ['B', 'N'].includes(minors[0].toUpperCase()))
    || (minors.length === 2 && bishopSquares.length === 2 && new Set(bishopSquares.map((index) => (index % state.width + Math.floor(index / state.width)) % 2)).size === 1);
  if (state.half >= 100 || insufficient) return 'draw';
  return inCheck(state, state.turn) ? 'check' : 'playing';
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
