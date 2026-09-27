import { useMemo } from 'react'
import { Link } from 'react-router-dom'
import { HexTile } from '../components/HexTile'
import { Accordion } from '../components/Accordion'
import { HEX_CENTERS, SEA_CENTERS, VIEW } from '../lib/geometry'
import { newGame } from '../lib/board'
import { LEADERBOARDS, VARIANTS } from '../lib/content'
import { GAME_TYPE_LABELS, type GameType } from '../lib/types'
import { asset } from '../lib/assets'

/** A non-interactive board, purely as a backdrop for the hero. */
function BoardPreview() {
  const game = useMemo(() => newGame('spiral'), [])

  return (
    <div
      className="relative w-full"
      style={{ aspectRatio: `${VIEW.width} / ${VIEW.height}`, containerType: 'inline-size' }}
      aria-hidden
    >
      {SEA_CENTERS.map((c, i) => (
        <HexTile key={`s${i}`} center={c} sea />
      ))}
      {HEX_CENTERS.map((c, i) => (
        <HexTile key={`t${i}`} center={c} tile={game.tiles[i]} />
      ))}
    </div>
  )
}

export function Home() {
  return (
    <div className="mx-auto max-w-6xl px-4 pb-20 lg:px-8">
      <section className="grid items-center gap-10 py-12 lg:grid-cols-[1.1fr_1fr] lg:py-20">
        <div>
          <p className="font-display text-sm tracking-[0.2em] text-sea-200 uppercase">
            Hanover House
          </p>
          <h1 className="mt-3 font-display text-5xl leading-[1.05] font-bold sm:text-6xl">
            Settlers of Catan{' '}
            <span className="text-sea-400" aria-hidden>
              ⬢
            </span>
          </h1>
          <p className="mt-5 max-w-lg text-lg leading-relaxed text-sea-100/80">
            A board generator, a dice roller, five house variants and a leaderboard that
            somebody eventually has to run away with.
          </p>

          <div className="mt-8 flex flex-wrap gap-3">
            <Link
              to="/board"
              className="rounded-xl bg-sea-400 px-5 py-3 font-display font-semibold text-sea-950
                         transition hover:brightness-110"
            >
              Generate a board
            </Link>
            <a
              href={asset('rules/base-game.jpg')}
              target="_blank"
              rel="noreferrer"
              className="rounded-xl border border-white/15 px-5 py-3 font-display font-semibold
                         transition hover:bg-white/10"
            >
              Base game rules
            </a>
          </div>
        </div>

        <div className="relative">
          <div className="absolute -inset-8 -z-10 rounded-full bg-sea-400/20 blur-3xl" />
          <BoardPreview />
        </div>
      </section>

      <section className="py-8">
        <h2 className="font-display text-2xl font-bold">Three ways to deal the island</h2>
        <div className="mt-5 grid gap-4 sm:grid-cols-3">
          {(Object.keys(GAME_TYPE_LABELS) as GameType[]).map((type) => (
            <Link
              key={type}
              to={`/board?gameType=${type}`}
              className="panel group p-5 transition hover:border-sea-400/50 hover:bg-white/10"
            >
              <h3 className="font-display text-lg font-semibold">
                {GAME_TYPE_LABELS[type].title}
              </h3>
              <p className="mt-2 text-sm leading-relaxed text-sea-100/75">
                {GAME_TYPE_LABELS[type].blurb}
              </p>
              <span className="mt-3 inline-block text-sm text-sea-200 transition group-hover:text-sea-400">
                Deal it →
              </span>
            </Link>
          ))}
        </div>
      </section>

      <section className="py-8">
        <h2 className="font-display text-2xl font-bold">Alternative expansion rules</h2>
        <p className="mt-2 text-sm text-sea-100/70">
          House variants. Agree on one before the first settlement goes down, not after.
        </p>
        <div className="panel mt-5 overflow-hidden">
          {VARIANTS.map((variant) => (
            <Accordion key={variant.title} title={variant.title} subtitle={variant.tagline}>
              <ol className="list-decimal space-y-2 pl-5 marker:text-sea-400">
                {variant.rules.map((rule) => (
                  <li key={rule}>{rule}</li>
                ))}
              </ol>
            </Accordion>
          ))}
        </div>
      </section>

      <section className="py-8">
        <h2 className="font-display text-2xl font-bold">Leaderboards</h2>
        <div className="panel mt-5 overflow-hidden">
          {LEADERBOARDS.map((board) => (
            <Accordion
              key={board.title}
              title={board.title}
              subtitle={`${board.totalGames} games played`}
              defaultOpen
            >
              <table className="w-full max-w-md">
                <caption className="sr-only">{board.title}</caption>
                <thead className="text-xs text-sea-200 uppercase">
                  <tr>
                    <th scope="col" className="pb-2 text-left font-medium">#</th>
                    <th scope="col" className="pb-2 text-left font-medium">Player</th>
                    <th scope="col" className="pb-2 text-right font-medium">Wins</th>
                  </tr>
                </thead>
                <tbody>
                  {board.entries.map((entry) => (
                    <tr key={entry.name} className="border-t border-white/10">
                      <td className="py-2 tabular-nums text-sea-200">{entry.rank}</td>
                      <th scope="row" className="py-2 text-left font-normal">
                        {entry.name}
                        {entry.champion && <span className="ml-2" title="Champion">👑</span>}
                      </th>
                      <td className="py-2 text-right font-display font-semibold tabular-nums">
                        {entry.wins}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </Accordion>
          ))}
        </div>
      </section>
    </div>
  )
}
