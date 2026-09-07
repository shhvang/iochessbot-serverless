export const puzzles = [
  {
    id: 'back-rank-rook',
    title: 'The Back Rank',
    fen: '6k1/5ppp/8/8/8/8/8/R5K1 w - - 0 1',
  },
  {
    id: 'queen-and-king',
    title: 'Royal Teamwork',
    fen: '7k/8/5K2/6Q1/8/8/8/8 w - - 0 1',
  },
  {
    id: 'smothered-knight',
    title: 'No Breathing Room',
    fen: 'k7/8/8/8/4n3/8/6PP/6RK b - - 0 1',
  },
  {
    id: 'queen-and-bishop',
    title: 'Break the Shelter',
    fen: 'k7/8/3b4/8/7q/8/5PPP/5RK1 b - - 0 1',
  },
  {
    id: 'knight-promotion',
    title: 'Choose Wisely',
    fen: '6br/5Ppk/7p/5K2/8/8/8/8 w - - 0 1',
  },
  {
    id: 'bishop-net',
    title: 'The Closing Diagonal',
    fen: '8/8/8/8/1b6/8/P1k5/K7 b - - 0 1',
  },
];

export function puzzleGame(puzzle) {
  const { fen } = puzzle;
  const playerColor = fen.split(' ')[1];
  return {
    mode: 'puzzle',
    puzzleId: puzzle.id,
    fen,
    positions: [fen],
    history: [],
    moves: [],
    playerColor,
    flipped: playerColor === 'b',
    setup: {},
    selected: null,
    promotion: null,
    result: null,
    outcome: null,
  };
}
