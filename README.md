# IOChessBot

Telegram rich-message chess running on Telegram Serverless.

## Play

- `/new`: classic chess against Easy, Normal, or Hard engine.
- `/mini`: 5x6 mini-chess. No castling, double pawn moves, or en passant. Pawns promote on the last rank.
- `/puzzle`: one of six mate-in-one puzzles. Wrong moves leave the position unchanged; skipping rotates to another puzzle.
- `/games`: browse active and finished boards privately.
- `/stats`: classic and mini records, plus unique puzzles solved.
- `/leaderboard`, `/leaderboard mini`, `/leaderboard puzzle`: separate global top tens, displaying first names.
- `/pgn`: move notation from the latest game; mini-chess uses its 5x6 coordinates.

Classic and mini bot scores start at 1000, with +10 for wins and -10 for losses. These are casual scores, not Elo; Undo is allowed. Previously stored classic totals are retained. Puzzle replays count only once per puzzle and never affect game scores.

## Guest Mode

The owner must enable **Guest Mode** in BotFather's Mini App under the bot's settings. Then mention `@IOChessBot mini`, `@IOChessBot puzzle`, or `@IOChessBot chess` in a supported chat, even without adding the bot. `@IOChessBot leaderboard puzzle` posts the puzzle leaderboard.

Only the caller can control their board. Others can mention the bot to get their own. Each invocation permits one guest reply; mention the bot again for another game. Guest board callbacks edit the returned inline message ID, not an ordinary chat message.

## Develop

Runtime imports use bare serverless names. No npm packages are loaded by the runtime.

```bash
npm test
npx tgcloud push
npx tgcloud migrate --safe
npx tgcloud webhook sync
```

Tests use Node 24 built-ins, including SQLite for leaderboard queries. The CLI token lives in git-ignored `.tgcloud/credentials`.
