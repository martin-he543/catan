/**
 * Rules shared across the base game and the expansions: dice, production,
 * the robber and pirate, discovery, awards, turn order and victory.
 */
import { updateLargestArmy, updateLongestRoad } from './placement'
import { rollDie, shuffle, type Rng } from './rng'
import {
  COMMODITY_OF,
  activePrompts,
  addCards,
  cardName,
  describeCards,
  discardLimit,
  fishLimit,
  handSize,
  isResource,
  knownLand,
  knownSea,
  log,
  makePrompt,
  nameOf,
  nextSeat,
  ownersOnHex,
  publicPoints,
  pushFront,
  shipOwnersOnHex,
  stealRandom,
  targetFor,
  topo,
  totalPoints,
} from './state'
import {
  CARDS,
  RESOURCES,
  type Card,
  type CardCounts,
  type Dice,
  type EventFace,
  type GameState,
  type Hand,
  type Prompt,
  type Step,
} from './types'

export interface Ctx {
  rng: Rng
  now: number
}

/* ------------------------------------------------------------------ *
 * Dice
 * ------------------------------------------------------------------ */

const FULL_DICE_DECK = Array.from({ length: 36 }, (_, i) => (Math.floor(i / 6) + 1) * 10 + (i % 6) + 1)

const EVENT_FACES: EventFace[] = ['barbarian', 'barbarian', 'barbarian', 'trade', 'politics', 'science']

/**
 * Roll for the current player. Balanced dice draw without replacement from
 * the 36 combinations, so the long run matches the odds; balanced sevens put
 * a 7 back when this player has already rolled more of them than the others.
 */
export function rollDice(state: GameState, ctx: Ctx): Dice {
  const seat = state.turn.seat
  let a: number
  let b: number
  if (state.turn.alchemist) {
    ;({ a, b } = state.turn.alchemist)
    state.turn.alchemist = null
  } else if (state.config.dice === 'balanced') {
    if (state.diceDeck.length < 5) state.diceDeck = [...FULL_DICE_DECK]
    const draw = () => state.diceDeck.splice(Math.floor(ctx.rng.next() * state.diceDeck.length), 1)[0]
    let card = draw()
    if (state.config.balancedSevens && Math.floor(card / 10) + (card % 10) === 7) {
      const others = state.players.filter((p, i) => i !== seat && !p.resigned).map((p) => p.sevens)
      if (others.length && state.players[seat].sevens > Math.min(...others)) {
        state.diceDeck.push(card)
        card = draw()
      }
    }
    a = Math.floor(card / 10)
    b = card % 10
  } else {
    a = rollDie(ctx.rng)
    b = rollDie(ctx.rng)
  }
  const dice: Dice = { a, b }
  if (state.config.citiesKnights) dice.event = EVENT_FACES[rollDie(ctx.rng) - 1]
  if (a + b === 7) state.players[seat].sevens++
  state.rolls[a + b] = (state.rolls[a + b] ?? 0) + 1
  return dice
}

/* ------------------------------------------------------------------ *
 * Production
 * ------------------------------------------------------------------ */

const LAKE_NUMBERS = [2, 3, 11, 12]

function drawFish(state: GameState, seat: number, count: number, ctx: Ctx): number {
  const player = state.players[seat]
  let got = 0
  for (let i = 0; i < count; i++) {
    if (state.fishDeck.length === 0) {
      state.fishDeck = shuffle(ctx.rng, state.fishDiscard)
      state.fishDiscard = []
    }
    if (state.fishDeck.length === 0) break
    const idx = Math.floor(ctx.rng.next() * state.fishDeck.length)
    const token = state.fishDeck.splice(idx, 1)[0]
    if (token === 0) {
      player.hasBoot = true
      log(state, seat, `${player.name} fished up the old boot — they need one more point to win`)
      continue
    }
    if (player.fish.length >= fishLimit) {
      // A full creel: the smaller catch goes back.
      const smallest = Math.min(...player.fish)
      if (token > smallest) {
        player.fish.splice(player.fish.indexOf(smallest), 1, token)
        state.fishDiscard.push(smallest)
      } else {
        state.fishDiscard.push(token)
      }
      continue
    }
    player.fish.push(token)
    got += token
  }
  return got
}

/**
 * Hand out what a roll produces. When the bank can't cover everyone who is
 * owed a resource, nobody gets it — unless only one player is owed, who then
 * takes what is left.
 */
export function produce(state: GameState, total: number, ctx: Ctx) {
  const t = topo(state)
  const ck = state.config.citiesKnights
  const owed: Hand[] = state.players.map(() => Object.fromEntries(CARDS.map((c) => [c, 0])) as Hand)
  const gold = state.players.map(() => 0)
  const fish = state.players.map(() => 0)

  state.map.hexes.forEach((hex, i) => {
    if (hex.veil === 'fog' || i === state.robber) return
    const producing = hex.number === total
    const lake = hex.terrain === 'lake' && LAKE_NUMBERS.includes(total)
    const ground = hex.terrain === 'sea' && hex.fishing === total
    if (!producing && !lake && !ground) return
    for (const v of t.hexes[i].corners) {
      const b = state.buildings[v]
      if (!b || state.players[b.owner].resigned) continue
      const n = b.kind === 'city' ? 2 : 1
      if (lake || ground) {
        fish[b.owner] += n
        continue
      }
      if (hex.terrain === 'gold') gold[b.owner] += n
      else if (isResource(hex.terrain)) {
        const commodity = COMMODITY_OF[hex.terrain]
        if (ck && b.kind === 'city' && commodity) {
          owed[b.owner][hex.terrain] += 1
          owed[b.owner][commodity] += 1
        } else {
          owed[b.owner][hex.terrain] += n
        }
      }
    }
  })

  for (const c of CARDS) {
    const demand = owed.reduce((sum, h) => sum + h[c], 0)
    if (demand <= state.bank[c]) continue
    const takers = owed.flatMap((h, i) => (h[c] > 0 ? [i] : []))
    if (takers.length === 1) owed[takers[0]][c] = state.bank[c]
    else {
      for (const h of owed) h[c] = 0
      log(state, null, `The bank is short of ${cardName(c)}, so nobody gets any`)
    }
  }

  // Pay everyone first, so the picks below see the bank as it really is.
  owed.forEach((hand, seat) => {
    if (CARDS.reduce((s, c) => s + hand[c], 0) === 0) return
    for (const c of CARDS) state.bank[c] -= hand[c]
    addCards(state.players[seat].hand, hand)
    log(state, seat, `${nameOf(state, seat)} collects ${describeCards(hand)}`)
  })

  // Gold and aqueduct picks all draw on the bank at once: reserve as we go,
  // so every prompt can still be answered whatever the others choose.
  const prompts: Prompt[] = []
  const group = `production-${state.seq}`
  let bankLeft = RESOURCES.reduce((s, r) => s + state.bank[r], 0)
  owed.forEach((hand, seat) => {
    const got = CARDS.reduce((s, c) => s + hand[c], 0)
    if (fish[seat] > 0) {
      const caught = drawFish(state, seat, fish[seat], ctx)
      if (caught > 0) log(state, seat, `${nameOf(state, seat)} catches ${fish[seat]} fish token${fish[seat] > 1 ? 's' : ''}`)
    }
    if (gold[seat] > 0 && !state.players[seat].resigned) {
      const count = Math.min(gold[seat], bankLeft)
      bankLeft -= count
      if (count > 0) {
        prompts.push(makePrompt(state, {
          group,
          seat,
          type: 'gold',
          text: `Gold field: choose ${count} resource${count > 1 ? 's' : ''}`,
          input: { kind: 'cards', count, source: 'bank', allowed: [...RESOURCES] },
        }))
      }
    }
    // Aqueduct: a science-3 player who gets nothing from a roll picks a resource.
    const nothing = got === 0 && gold[seat] === 0 && fish[seat] === 0
    if (ck && nothing && bankLeft > 0 && state.players[seat].improvements.science >= 3 && !state.players[seat].resigned) {
      bankLeft--
      prompts.push(makePrompt(state, {
        group,
        seat,
        type: 'aqueduct',
        text: 'Aqueduct: nothing was produced for you — take a resource',
        input: { kind: 'cards', count: 1, source: 'bank', allowed: [...RESOURCES] },
      }))
    }
  })
  if (prompts.length) pushFront(state, ...prompts)
}

/* ------------------------------------------------------------------ *
 * Sevens, the robber and the pirate
 * ------------------------------------------------------------------ */

/** Everyone over the limit discards half, rounded down, all at once. */
export function discardPrompts(state: GameState): Prompt[] {
  const group = `discard-${state.seq}`
  return state.players.flatMap((p, seat) => {
    if (p.resigned) return []
    const size = handSize(p.hand)
    if (size <= discardLimit(state, seat)) return []
    const count = Math.floor(size / 2)
    return [makePrompt(state, {
      group,
      seat,
      type: 'discard',
      text: `Discard ${count} card${count > 1 ? 's' : ''}`,
      input: { kind: 'cards', count, source: 'hand' },
    })]
  })
}

export type RobberCause = 'seven' | 'knight' | 'bishop' | 'chase' | 'fish'

/**
 * Where the robber (or, in Seafarers, the pirate) may go. With the friendly
 * robber, tiles touching a player on two visible points or fewer are off
 * limits — unless that leaves nowhere at all.
 */
export function robberTargets(state: GameState, seat: number, cause: RobberCause): number[] {
  const pirate = state.config.seafarers && (cause === 'seven' || cause === 'knight')
  const land: number[] = []
  const sea: number[] = []
  state.map.hexes.forEach((h, i) => {
    if (knownLand(h) && i !== state.robber) land.push(i)
    if (pirate && knownSea(h) && i !== state.pirate) sea.push(i)
  })
  let allowed = land
  if (state.config.friendlyRobber) {
    const shielded = new Set(
      state.players.flatMap((p, i) => (i !== seat && !p.resigned && publicPoints(state, i) <= 2 ? [i] : [])),
    )
    const friendly = land.filter((h) => !ownersOnHex(state, h).some((o) => shielded.has(o)))
    if (friendly.length > 0) allowed = friendly
  }
  return [...allowed, ...sea]
}

export function robberPrompt(state: GameState, seat: number, cause: RobberCause): Prompt {
  const hexes = robberTargets(state, seat, cause)
  const what = state.config.seafarers && (cause === 'seven' || cause === 'knight') ? 'the robber or the pirate' : 'the robber'
  return makePrompt(state, {
    seat,
    type: 'robber',
    text: `Move ${what}`,
    input: { kind: 'board', hexes },
    data: { cause },
  })
}

/** Move the robber or pirate to `hex`, then steal. */
export function moveRobber(state: GameState, seat: number, hex: number, cause: RobberCause, ctx: Ctx) {
  const onSea = knownSea(state.map.hexes[hex])
  if (onSea) {
    state.pirate = hex
    log(state, seat, `${nameOf(state, seat)} moves the pirate`)
  } else {
    state.robber = hex
    log(state, seat, `${nameOf(state, seat)} moves the robber`)
  }
  const victims = (onSea ? shipOwnersOnHex(state, hex, seat) : ownersOnHex(state, hex, seat)).filter(
    (o) => handSize(state.players[o].hand) > 0 && !state.players[o].resigned,
  )
  if (cause === 'bishop') {
    for (const v of victims) steal(state, seat, v, ctx)
    return
  }
  if (victims.length === 1) steal(state, seat, victims[0], ctx)
  else if (victims.length > 1) {
    pushFront(state, makePrompt(state, {
      seat,
      type: 'steal',
      text: 'Choose who to steal from',
      input: {
        kind: 'choice',
        options: victims.map((v) => ({
          id: String(v),
          label: `${nameOf(state, v)} (${handSize(state.players[v].hand)} cards)`,
        })),
      },
    }))
  }
}

export function steal(state: GameState, thief: number, victim: number, ctx: Ctx): Card | null {
  const card = stealRandom(state, victim, thief, ctx.rng)
  if (card) {
    log(state, thief, `${nameOf(state, thief)} steals a card from ${nameOf(state, victim)}`, {
      secret: { seats: [thief, victim], text: cardName(card) },
    })
  }
  return card
}

/* ------------------------------------------------------------------ *
 * Discovery
 * ------------------------------------------------------------------ */

/** Lift the fog beside a newly built road or ship, rewarding the discoverer. */
export function revealFog(state: GameState, seat: number, edge: number) {
  const t = topo(state)
  for (const h of t.edges[edge].hexes) {
    const hex = state.map.hexes[h]
    if (hex.veil !== 'fog') continue
    delete hex.veil
    if (hex.terrain === 'sea') {
      log(state, seat, `${nameOf(state, seat)} parts the fog: open sea`)
    } else if (hex.terrain === 'gold') {
      log(state, seat, `${nameOf(state, seat)} discovers a gold field`)
      if (RESOURCES.some((r) => state.bank[r] > 0)) {
        pushFront(state, makePrompt(state, {
          seat,
          type: 'gold',
          text: 'You found gold: choose a resource',
          input: { kind: 'cards', count: 1, source: 'bank', allowed: [...RESOURCES] },
        }))
      }
    } else if (isResource(hex.terrain)) {
      const r = hex.terrain
      const got = state.bank[r] > 0
      if (got) {
        state.bank[r]--
        state.players[seat].hand[r]++
      }
      log(state, seat, `${nameOf(state, seat)} discovers ${cardName(r)} land${got ? ` and takes 1 ${cardName(r)}` : ''}`)
    } else {
      log(state, seat, `${nameOf(state, seat)} discovers ${hex.terrain}`)
    }
  }
}

/** Blind placement: turn over the tiles around a new building. */
export function revealCorner(state: GameState, vertex: number) {
  const t = topo(state)
  for (const h of t.vertices[vertex].hexes) {
    const hex = state.map.hexes[h]
    if (hex.veil === 'blind' || hex.veil === 'terrain') delete hex.veil
  }
}

export function revealAllVeils(state: GameState) {
  for (const hex of state.map.hexes) {
    if (hex.veil === 'blind' || hex.veil === 'terrain') delete hex.veil
  }
}

/** Seafarers: the first settlement on a new island pays a bonus. */
export function islandBonus(state: GameState, seat: number, vertex: number) {
  if (state.config.islandBonus <= 0) return
  const t = topo(state)
  const player = state.players[seat]
  for (const h of t.vertices[vertex].hexes) {
    const region = state.map.hexes[h].region
    if (region < 0 || player.homeRegions.includes(region) || player.rewardedRegions.includes(region)) continue
    player.rewardedRegions.push(region)
    player.islandPoints += state.config.islandBonus
    log(state, seat, `${player.name} settles a new island: +${state.config.islandBonus} VP`)
    return
  }
}

/* ------------------------------------------------------------------ *
 * Dust Bowl
 * ------------------------------------------------------------------ */

/**
 * After a 7, the desert spreads: any tile already on a 2 or 12 beside a
 * desert turns to sand, and every other numbered tile beside a desert drifts
 * one step towards 2 or 12.
 */
export function spreadDesert(state: GameState) {
  const t = topo(state)
  const hexes = state.map.hexes
  const nearDesert = (i: number) => t.hexes[i].neighbors.some((n) => n >= 0 && hexes[n].terrain === 'desert')
  const touched = hexes.flatMap((h, i) =>
    h.number !== undefined && h.terrain !== 'sea' && h.terrain !== 'desert' && nearDesert(i) ? [i] : [],
  )
  let consumed = 0
  for (const i of touched) {
    const h = hexes[i]
    if (h.number === 2 || h.number === 12) {
      h.terrain = 'desert'
      delete h.number
      consumed++
    } else if (h.number! < 7) h.number = h.number! - 1
    else h.number = h.number! + 1
  }
  if (touched.length) {
    log(state, null, consumed
      ? `The dust spreads: ${consumed} tile${consumed > 1 ? 's' : ''} turn${consumed > 1 ? '' : 's'} to desert`
      : 'The dust spreads: the land beside the desert weakens')
  }
  const productive = hexes.some((h) => h.terrain !== 'sea' && h.terrain !== 'desert' && h.terrain !== 'lake')
  if (!productive) {
    // The whole island is sand: most points wins, then most cards.
    const ranked = state.players
      .map((p, i) => ({ i, points: totalPoints(state, i), cards: handSize(p.hand) }))
      .filter((r) => !state.players[r.i].resigned)
      .sort((a, b) => b.points - a.points || b.cards - a.cards)
    endGame(state, ranked[0].i, 'The island turned entirely to desert')
  }
}

/* ------------------------------------------------------------------ *
 * Awards, victory and turn order
 * ------------------------------------------------------------------ */

export function updateAwards(state: GameState) {
  const road = updateLongestRoad(state)
  if (road !== null) log(state, road, `${nameOf(state, road)} takes the Longest Road`)
  const army = updateLargestArmy(state)
  if (army !== null) log(state, army, `${nameOf(state, army)} takes the Largest Army`)
}

export function endGame(state: GameState, winner: number, reason: string) {
  state.phase = 'ended'
  state.winner = winner
  state.endReason = reason
  state.queue = []
  state.offers = []
  state.deadline = null
  log(state, winner, `${nameOf(state, winner)} wins! ${reason}`)
}

/**
 * You can only win on your own turn — so this looks at whoever is playing
 * the turn (and, with the second-settler rule, the settler sharing it).
 */
export function checkVictory(state: GameState) {
  if (state.phase !== 'main') return
  const standing = state.players.flatMap((p, i) => (p.resigned ? [] : [i]))
  if (standing.length === 1) {
    endGame(state, standing[0], 'Everyone else resigned')
    return
  }
  // During someone's special build phase it isn't anyone's own turn.
  if (state.turn.stage.kind === 'specialBuild') return
  const candidates = [state.turn.seat]
  if (state.turn.stage.kind === 'secondSettler') candidates.push(state.turn.stage.seat)
  for (const seat of candidates) {
    if (state.players[seat].resigned) continue
    const points = totalPoints(state, seat)
    if (points >= targetFor(state, seat)) {
      endGame(state, seat, `${points} victory points`)
      return
    }
  }
}

export function startNextTurn(state: GameState) {
  const seat = nextSeat(state, state.turn.seat)
  state.turn = {
    seat,
    number: state.turn.number + 1,
    rolled: false,
    dice: null,
    devPlayed: false,
    shipMoved: false,
    stage: { kind: 'main' },
    fleet: null,
    crane: false,
    alchemist: null,
  }
  state.offers = []
  log(state, seat, `Turn ${state.turn.number}: ${nameOf(state, seat)}`)
  checkVictory(state)
}

/** The seat whose part of the turn it is: the player, or the second settler / special builder. */
export const turnHolder = (state: GameState) =>
  state.turn.stage.kind === 'main' ? state.turn.seat : state.turn.stage.seat

/** Who may take ordinary actions right now, or null while prompts are open. */
export function actingSeat(state: GameState): number | null {
  if (state.phase === 'setup') return state.setup ? state.setup.steps[state.setup.index]?.seat ?? null : null
  if (state.phase !== 'main') return null
  if (activePrompts(state).length > 0) return null
  const stage = state.turn.stage
  return stage.kind === 'main' ? state.turn.seat : stage.seat
}

/** Seats the game is currently waiting on. */
export function waitingOn(state: GameState): number[] {
  const prompts = activePrompts(state)
  if (prompts.length) return [...new Set(prompts.map((p) => p.seat))]
  const seat = actingSeat(state)
  return seat === null ? [] : [seat]
}

/* ------------------------------------------------------------------ *
 * Tasks
 * ------------------------------------------------------------------ */

export const task = (name: string, data?: Record<string, unknown>): Step => ({ kind: 'task', task: name, data })

export const cardsTotal = (cards: CardCounts) => Object.values(cards).reduce<number>((s, n) => s + (n ?? 0), 0)
