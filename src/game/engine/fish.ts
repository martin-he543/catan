/**
 * Fishermen of Catan. Fishing grounds and the lake hand out fish tokens
 * (1-3 fish each) on their numbers; tokens are spent, without change, on:
 *
 *   2 fish  banish the robber from the island
 *   3 fish  steal a card from any player
 *   4 fish  take any resource from the bank
 *   5 fish  build a road for free
 *   7 fish  take a development card
 *
 * The old boot hides among the tokens: whoever holds it needs one more point
 * to win, and may hand it to anyone with at least as many points.
 */
import type { ActionHandler, PromptHandler } from './game'
import { legalRoutes, routeAnswer } from './placement'
import { revealFog, steal, type Ctx } from './rules'
import {
  handSize,
  log,
  makePrompt,
  nameOf,
  othersInOrder,
  publicPoints,
  pushFront,
  cardName,
  DEV_NAMES,
} from './state'
import { RESOURCES, RuleError, type Action, type FishUse, type GameState, type Prompt, type Resource } from './types'

export const FISH_COSTS: Record<FishUse, number> = { robber: 2, steal: 3, resource: 4, road: 5, dev: 7 }

export const FISH_LABELS: Record<FishUse, string> = {
  robber: 'Banish the robber',
  steal: 'Steal a card',
  resource: 'Take a resource',
  road: 'Build a free road',
  dev: 'Take a development card',
}

/** 11 one-fish, 10 two-fish and 8 three-fish tokens, and the boot (0). */
export function fishDeck(): number[] {
  return [...Array<number>(11).fill(1), ...Array<number>(10).fill(2), ...Array<number>(8).fill(3), 0]
}

const fish: ActionHandler = (state, seat, action, ctx) => {
  const { use, tokens } = action as Extract<Action, { type: 'fish' }>
  const cost = FISH_COSTS[use]
  if (cost === undefined) throw new RuleError('no such use for fish')
  const player = state.players[seat]
  if (state.turn.stage.kind === 'specialBuild') throw new RuleError('no fishing in the special build phase')
  const picked = [...new Set(tokens)]
  if (picked.length !== tokens.length || picked.some((i) => !Number.isInteger(i) || i < 0 || i >= player.fish.length)) {
    throw new RuleError('choose tokens from your catch')
  }
  const value = picked.reduce((s, i) => s + player.fish[i], 0)
  if (value < cost) throw new RuleError(`that needs ${cost} fish; those tokens make ${value}`)

  // Check the purchase can happen before taking the fish.
  if (use === 'robber' && state.robber < 0) throw new RuleError('the robber is already off the island')
  if (use === 'steal' && !othersInOrder(state, seat).some((o) => handSize(state.players[o].hand) > 0)) {
    throw new RuleError('nobody has a card to steal')
  }
  if (use === 'resource' && !RESOURCES.some((r) => state.bank[r] > 0)) throw new RuleError('the bank is empty')
  if (use === 'road' && legalRoutes(state, seat, 'road').length === 0 &&
      !(state.config.seafarers && legalRoutes(state, seat, 'ship').length > 0)) {
    throw new RuleError('there is nowhere to build')
  }
  if (use === 'dev' && (state.config.citiesKnights || state.devDeck.length === 0)) {
    throw new RuleError('there is no development card to take')
  }

  // Spend: no change is given.
  for (const i of [...picked].sort((a, b) => b - a)) {
    state.fishDiscard.push(player.fish[i])
    player.fish.splice(i, 1)
  }
  log(state, seat, `${player.name} spends ${value} fish: ${FISH_LABELS[use].toLowerCase()}`)

  switch (use) {
    case 'robber':
      state.robber = -1
      log(state, seat, 'The robber leaves the island until the next 7')
      break
    case 'steal': {
      const targets = othersInOrder(state, seat).filter((o) => handSize(state.players[o].hand) > 0)
      if (targets.length === 1) steal(state, seat, targets[0], ctx)
      else {
        pushFront(state, makePrompt(state, {
          seat, type: 'fishSteal', text: 'Choose who to steal from',
          input: { kind: 'choice', options: targets.map((o) => ({ id: String(o), label: nameOf(state, o) })) },
        }))
      }
      break
    }
    case 'resource':
      pushFront(state, makePrompt(state, {
        seat, type: 'fishResource', text: 'Take a resource from the bank',
        input: { kind: 'cards', count: 1, source: 'bank', allowed: [...RESOURCES] },
      }))
      break
    case 'road': {
      const edges = [...new Set([...legalRoutes(state, seat, 'road'), ...(state.config.seafarers ? legalRoutes(state, seat, 'ship') : [])])]
      pushFront(state, makePrompt(state, {
        seat, type: 'fishRoad', text: 'Build a free road',
        input: { kind: 'board', edges, pieces: state.config.seafarers ? ['road', 'ship'] : ['road'] },
      }))
      break
    }
    case 'dev': {
      const card = state.devDeck.pop()!
      player.dev.push({ type: card, bought: state.turn.number })
      log(state, seat, `${player.name} takes a development card`, { secret: { seats: [seat], text: DEV_NAMES[card] } })
      break
    }
  }
}

const passBoot: ActionHandler = (state, seat, action) => {
  const { to } = action as Extract<Action, { type: 'passBoot' }>
  const player = state.players[seat]
  if (!player.hasBoot) throw new RuleError("you don't have the boot")
  if (!state.players[to] || to === seat || state.players[to].resigned) throw new RuleError('choose another player')
  if (publicPoints(state, to) < publicPoints(state, seat)) throw new RuleError('the boot can only go to someone with at least as many points')
  player.hasBoot = false
  state.players[to].hasBoot = true
  log(state, seat, `${player.name} passes the old boot to ${nameOf(state, to)}`)
}

export const fishActions = { fish, passBoot } satisfies Record<string, ActionHandler>

type Respond = Extract<Action, { type: 'respond' }>

export const fishPrompts: Partial<Record<Prompt['type'], PromptHandler>> = {
  fishSteal(state: GameState, prompt: Prompt, response: Respond, ctx: Ctx) {
    if (prompt.input.kind !== 'choice' || !prompt.input.options.some((o) => o.id === response.choice)) {
      throw new RuleError('pick one of the options')
    }
    steal(state, prompt.seat, Number(response.choice), ctx)
  },
  fishResource(state, prompt, response) {
    const entries = Object.entries(response.cards ?? {}).filter(([, n]) => (n ?? 0) > 0)
    if (entries.length !== 1 || entries[0][1] !== 1 || !(RESOURCES as readonly string[]).includes(entries[0][0])) {
      throw new RuleError('choose one resource')
    }
    const r = entries[0][0] as Resource
    if (state.bank[r] <= 0) throw new RuleError("the bank doesn't have that")
    state.bank[r]--
    state.players[prompt.seat].hand[r]++
    log(state, prompt.seat, `${nameOf(state, prompt.seat)} takes 1 ${cardName(r)}`)
  },
  fishRoad(state, prompt, response) {
    const e = response.edge
    if (prompt.input.kind !== 'board' || e === undefined || !prompt.input.edges?.includes(e)) {
      throw new RuleError("that isn't one of the highlighted edges")
    }
    const kind = routeAnswer(state, prompt, e, response.piece)
    state.routes[e] = { owner: prompt.seat, kind, built: state.turn.number }
    revealFog(state, prompt.seat, e)
    log(state, prompt.seat, `${nameOf(state, prompt.seat)} builds a free ${kind}`)
  },
}
