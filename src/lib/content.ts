/**
 * House rules and leaderboard, carried over from the original `catan.md`.
 * The variants were stubs there; they are written out properly here.
 */
export interface Variant {
  title: string
  tagline: string
  rules: string[]
}

export const VARIANTS: Variant[] = [
  {
    title: 'Cold War Catan',
    tagline: 'Two blocs, one island, mutually assured settlement.',
    rules: [
      'Players pair into two blocs. Bloc partners may trade at 1:1 and never pay a port rate to each other.',
      'Trading across blocs costs a tax: hand one card of the traded resource to the bank.',
      'Ore is the strategic reserve. Any player holding six or more ore triggers an arms race — every other player immediately draws one development card.',
      'The robber is a proxy conflict: whoever moves it names the bloc it must land on, not the individual player.',
      'Victory is by bloc. The first bloc to a combined 18 points wins, and the partner with fewer points is remembered as the junior partner.',
    ],
  },
  {
    title: 'Crusader Catan',
    tagline: 'Longest road is a pilgrimage, and the desert is holy ground.',
    rules: [
      'The desert is the Holy Land. The first player to build a settlement on any corner touching it claims it and scores 2 bonus points.',
      'The claim is not permanent: a rival who later builds a city on a corner touching the desert seizes it, taking the bonus with them.',
      'Longest Road becomes the Pilgrim Road and is worth 3 points instead of 2, but it must terminate at a corner touching the desert.',
      'Knights are crusaders. Playing a knight lets you move the robber two tiles instead of one.',
      'No player may trade with whoever currently holds the Holy Land, including the bank at port rates.',
    ],
  },
  {
    title: 'Neoliberal Capitalist Catan',
    tagline: 'Deregulate the ports, privatise the sheep.',
    rules: [
      'All ports are open to all players from the start, regardless of who has settled beside them.',
      'Players may lend resources. Write down the debt; it is repaid at 2:1 on the debtor\'s next matching roll.',
      'A player may buy a development card on credit once per turn, paying its cost on their following turn or forfeiting a point.',
      'Monopoly may be played twice from a single card, naming a different resource each time.',
      'The player with the most total resources at the end of each round collects one card of their choice from the bank as a dividend.',
    ],
  },
  {
    title: 'Climate Armageddon Catan',
    tagline: 'The sea is rising and the numbers are getting worse.',
    rules: [
      'Every time a 7 is rolled, the sea level rises by one. Track it on a spare number token.',
      'At sea level 3, and every second level after, flip the highest-producing coastal tile face down. It produces nothing for the rest of the game.',
      'Cities emit. Each city a player owns adds one to the sea level counter every time they roll a 12.',
      'Forests offset. A player who owns a settlement touching two or more lumber tiles may spend two lumber to lower the sea level by one, once per turn.',
      'If the sea level reaches 10, the island is lost and everyone loses. Cooperation is allowed, and rarely happens.',
    ],
  },
  {
    title: 'Collusion (with the Robber) Catan',
    tagline: 'The robber can be bought.',
    rules: [
      'When you roll a 7, you may instead pay the robber two identical resources to leave it exactly where it is.',
      'Any player may bribe the robber on another player\'s turn: pay three resources to the bank to move it one tile in any direction.',
      'A player who has bribed the robber this round is immune to being robbed by it.',
      'The robber never steals from the player currently in last place.',
      'Knights played against a bribed robber are wasted; the card is discarded with no effect and no credit toward Largest Army.',
    ],
  },
]

export interface LeaderboardEntry {
  rank: string
  name: string
  wins: number
  champion?: boolean
}

export interface Leaderboard {
  title: string
  totalGames: number
  entries: LeaderboardEntry[]
}

export const LEADERBOARDS: Leaderboard[] = [
  {
    title: 'Catan Champion of Hanover House',
    totalGames: 6,
    entries: [
      { rank: '1', name: 'Seb the Younger', wins: 2, champion: true },
      { rank: '2=', name: 'Martin', wins: 1 },
      { rank: '2=', name: 'Hiroki', wins: 1 },
      { rank: '2=', name: 'Thomas', wins: 1 },
      { rank: '2=', name: 'Will', wins: 1 },
      { rank: '2=', name: 'Tudor', wins: 1 },
    ],
  },
]
