import { db } from 'sdk';
import { sql } from 'sdk/db';

export async function leaderboard(mode = 'classic') {
  if (!['classic', 'mini', 'puzzle'].includes(mode)) mode = 'classic';
  const rows = await db.all(sql`
    WITH results AS (
      SELECT user_id, sum(outcome = 'win') AS wins, sum(outcome = 'loss') AS losses,
        sum(outcome = 'draw') AS draws, count(distinct case when outcome = 'solved' then puzzle_id end) AS solved
      FROM games WHERE mode = ${mode} AND outcome IS NOT NULL GROUP BY user_id
    ), ids AS (
      SELECT user_id FROM results UNION SELECT user_id FROM players
    ), scores AS (
      SELECT ids.user_id, coalesce(players.name, 'Player') AS name,
        coalesce(results.wins, 0) + case when ${mode} = 'classic' then coalesce(players.wins, 0) else 0 end AS wins,
        coalesce(results.losses, 0) + case when ${mode} = 'classic' then coalesce(players.losses, 0) else 0 end AS losses,
        coalesce(results.draws, 0) + case when ${mode} = 'classic' then coalesce(players.draws, 0) else 0 end AS draws,
        coalesce(results.solved, 0) AS solved,
        case when ${mode} = 'puzzle' then coalesce(results.solved, 0)
          else case when ${mode} = 'classic' then coalesce(players.rating, 1000) else 1000 end
          + 10 * (coalesce(results.wins, 0) - coalesce(results.losses, 0)) end AS score
      FROM ids LEFT JOIN players ON players.user_id = ids.user_id
        LEFT JOIN results ON results.user_id = ids.user_id
    ) SELECT * FROM scores WHERE wins + losses + draws + solved > 0
      ORDER BY score DESC, wins DESC, user_id ASC LIMIT 10
  `);
  const escape = (value) => String(value).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
  const title = { classic: 'Chess', mini: 'Mini-chess', puzzle: 'Puzzles' }[mode];
  return { html: `<p><b>${title} leaderboard</b></p>`
    + (rows.length ? `<p>${rows.map((row, index) => `${index + 1}. ${escape(row.name)} - <b>${row.score}</b>${mode === 'puzzle' ? ' unique solves' : ` (${row.wins}W / ${row.losses}L / ${row.draws}D)`}`).join('<br>')}</p>` : '<p>No results yet. Be the first to play!</p>')
    + '<p>Separate boards: /leaderboard, /leaderboard mini, /leaderboard puzzle.</p>'
    + (mode === 'puzzle' ? '<p>Each puzzle counts once per player, even after replays.</p>' : '<p>Bot score: 1000 to start, +10 per win, -10 per loss. Not Elo. Games allow Undo.</p>') };
}
