import { describe, expect, it } from 'vitest'
import {
  AI_PROVIDERS,
  BOARD_SCHEMA,
  PROVIDERS,
  buildPrompt,
  effectiveModel,
  extractJson,
  isProvider,
  modelStorage,
  toBoard,
} from '../ai'
import { HEX_LABELS, PORT_SLOT_LABELS, hexIndex } from '../notation'
import { NO_NUMBER, TILE_SUPPLY, boardProblems } from '../vision'
import { TILE_TYPES, type TileType } from '../types'

/** The reply shape, kept loose on purpose so tests can post nonsense at it. */
interface Reply {
  tiles: Array<{ cell: string; terrain: string; number: number | null; unsure: boolean }>
  ports: Array<{ berth: string; trade: string }>
}

/** A correct reply: the box's tiles spread over the board, every one legible. */
function goodReply(): Reply {
  const terrain: TileType[] = TILE_TYPES.flatMap((t) =>
    Array.from({ length: TILE_SUPPLY[t] }, () => t),
  )
  const numbers = [2, 3, 3, 4, 4, 5, 5, 6, 6, 8, 8, 9, 9, 10, 10, 11, 11, 12]
  let next = 0
  return {
    tiles: HEX_LABELS.map((cell, i) => ({
      cell,
      terrain: terrain[i],
      number: terrain[i] === 'desert' ? null : numbers[next++],
      unsure: false,
    })),
    ports: PORT_SLOT_LABELS.map((berth, i) => ({
      berth,
      trade: ['any', 'wheat', 'any', 'brick', 'ore', 'any', 'sheep', 'any', 'lumber'][i],
    })),
  }
}

describe('folding Claude’s answer onto the board', () => {
  it('accepts a clean reading and produces a legal board', () => {
    const board = toBoard(goodReply())
    expect(boardProblems(board.tiles)).toEqual([])
    expect(board.notes).toEqual([])
    expect(board.unsure.every((u) => !u)).toBe(true)
    expect(board.ports).toHaveLength(9)
    expect(board.ports[1]).toBe('wheat')
  })

  it('places tiles by the cell they name, not by position', () => {
    const reply = goodReply()
    // Same data, shuffled: a correct reader must not care about array order.
    const shuffled = { ...reply, tiles: [...reply.tiles].reverse() }
    expect(toBoard(shuffled).tiles).toEqual(toBoard(reply).tiles)
  })

  it('gives the desert a 7 and no token of its own', () => {
    const board = toBoard(goodReply())
    const desert = board.tiles.findIndex((t) => t.type === 'desert')
    expect(board.tiles[desert].number).toBe(7)
  })

  it('leaves a hidden number blank rather than inventing one', () => {
    const reply = goodReply()
    reply.tiles[4] = { ...reply.tiles[4], number: null, unsure: true }
    const board = toBoard(reply)
    expect(board.tiles[4].number).toBe(NO_NUMBER)
    expect(board.unsure[4]).toBe(true)
    expect(boardProblems(board.tiles)).toContain('1 tile still needs a number')
  })

  it('rejects a 7, which is never a token', () => {
    const reply = goodReply()
    reply.tiles[2] = { ...reply.tiles[2], number: 7 }
    const board = toBoard(reply)
    expect(board.tiles[2].number).toBe(NO_NUMBER)
    expect(board.unsure[2]).toBe(true)
    expect(board.notes.join(' ')).toMatch(/A3 came back with a 7/)
  })

  it('keeps the rest of the board when one entry is nonsense', () => {
    const reply = goodReply()
    reply.tiles[0] = { ...reply.tiles[0], cell: 'Z9' }
    reply.tiles[1] = { ...reply.tiles[1], terrain: 'lava' }
    const board = toBoard(reply)
    expect(board.notes.join(' ')).toMatch(/"Z9", which is not a square/)
    expect(board.notes.join(' ')).toMatch(/"lava", which is not a terrain/)
    // A2 and A1 are left blank, but C5 and the rest still came through.
    expect(board.tiles[hexIndex('C5')]).toEqual(toBoard(goodReply()).tiles[hexIndex('C5')])
  })

  it('notices a tile the model never mentioned', () => {
    const reply = goodReply()
    reply.tiles = reply.tiles.filter((t) => t.cell !== 'D2')
    expect(toBoard(reply).notes.join(' ')).toMatch(/D2 was not reported at all/)
  })

  it('keeps the first of a duplicated cell', () => {
    const reply = goodReply()
    reply.tiles = [...reply.tiles, { cell: 'A1', terrain: 'ore', number: 11, unsure: false }]
    const board = toBoard(reply)
    expect(board.tiles[0]).toEqual(toBoard(goodReply()).tiles[0])
    expect(board.notes.join(' ')).toMatch(/A1 was read twice/)
  })

  it('survives a reply with nothing usable in it at all', () => {
    const board = toBoard({ tiles: [], ports: [] })
    expect(board.tiles).toHaveLength(19)
    expect(board.ports).toHaveLength(9)
    expect(board.unsure.every(Boolean)).toBe(true)
    expect(board.notes.length).toBeGreaterThan(19)
  })

  it('ignores a port it cannot place, and defaults the rest to 3:1', () => {
    const board = toBoard({ tiles: [], ports: [{ berth: 'Q9-nw', trade: 'ore' }] })
    expect(board.notes.join(' ')).toMatch(/"Q9-nw", which is not a berth/)
    expect(board.ports.every((p) => p === '31')).toBe(true)
  })

  it('treats a 0 as "could not read it", not as a contradiction', () => {
    const reply = goodReply()
    // 0 is what the schema asks for when a token is hidden; it earns a blank
    // and an amber ring, but no complaint.
    reply.tiles[6] = { ...reply.tiles[6], number: 0, unsure: true }
    const board = toBoard(reply)
    expect(board.tiles[6].number).toBe(NO_NUMBER)
    expect(board.unsure[6]).toBe(true)
    expect(board.notes.join(' ')).not.toMatch(/not a token/)
  })

  it('counts the unsure tiles for the user', () => {
    const reply = goodReply()
    reply.tiles[3] = { ...reply.tiles[3], unsure: true }
    reply.tiles[7] = { ...reply.tiles[7], unsure: true }
    expect(toBoard(reply).notes.at(-1)).toMatch(/^2 tiles are marked unsure/)
  })
})

describe('providers', () => {
  it('describes every provider it offers', () => {
    expect(AI_PROVIDERS.length).toBeGreaterThanOrEqual(5)
    const storage = new Set<string>()
    for (const id of AI_PROVIDERS) {
      const info = PROVIDERS[id]
      expect(info.id, id).toBe(id)
      expect(info.label, id).toBeTruthy()
      expect(info.model, id).toBeTruthy()
      expect(info.note, id).toBeTruthy()
      expect(info.console, id).toMatch(/^https:\/\//)
      // The default must be one the picker actually offers.
      expect(info.models, id).toContain(info.model)
      // Two providers sharing a slot would overwrite each other's key or model.
      expect(storage.has(info.storage), info.storage).toBe(false)
      storage.add(info.storage)
      expect(storage.has(modelStorage(id)), modelStorage(id)).toBe(false)
      storage.add(modelStorage(id))
    }
  })

  it('offers free options, since that is the point of having a choice', () => {
    expect(AI_PROVIDERS.filter((id) => PROVIDERS[id].free).length).toBeGreaterThanOrEqual(3)
  })

  it('points every OpenAI-compatible provider at an https endpoint', () => {
    for (const id of AI_PROVIDERS) {
      const openai = PROVIDERS[id].openai
      if (!openai) continue
      // A base URL is joined with "/chat/completions", so a trailing slash
      // would quietly produce a double slash in the request path.
      expect(openai.baseUrl, id).toMatch(/^https:\/\//)
      expect(openai.baseUrl.endsWith('/'), id).toBe(false)
    }
  })

  it('never defaults Gemini to a Pro model, which has no free quota', () => {
    // The mistake that produced a 429 reading like a billing failure.
    expect(PROVIDERS.gemini.model).not.toMatch(/pro/)
  })

  it('falls back to the provider default when no override is set', () => {
    expect(effectiveModel('groq')).toBe(PROVIDERS.groq.model)
    expect(effectiveModel('groq', '')).toBe(PROVIDERS.groq.model)
    expect(effectiveModel('groq', '   ')).toBe(PROVIDERS.groq.model)
    expect(effectiveModel('groq', ' custom/model ')).toBe('custom/model')
  })

  it('only recognises providers it can actually call', () => {
    expect(isProvider('claude')).toBe(true)
    expect(isProvider('gemini')).toBe(true)
    expect(isProvider('gpt')).toBe(false)
    expect(isProvider(null)).toBe(false)
  })
})

describe('the shared schema', () => {
  it('names every berth on the board in the prompt', () => {
    const prompt = buildPrompt()
    for (const berth of PORT_SLOT_LABELS) expect(prompt).toContain(berth)
    expect(prompt).not.toContain('BERTHS')
  })

  it('asks for the terrains the board actually has', () => {
    const terrain = BOARD_SCHEMA.properties.tiles.items.properties.terrain.enum
    expect([...terrain].sort()).toEqual([...TILE_TYPES].sort())
  })

  /**
   * Gemini's `responseJsonSchema` takes a subset of JSON Schema: no nullable
   * types and no `type: [...]` unions. Since both providers are handed the very
   * same object, a change that suits one and breaks the other is easy to make
   * and invisible until a live call fails — so assert the intersection here.
   */
  it('stays inside the dialect both providers accept', () => {
    const walk = (node: unknown, path: string) => {
      if (!node || typeof node !== 'object') return
      const schema = node as Record<string, unknown>
      if ('type' in schema) {
        expect(typeof schema.type, `${path}.type must be a single type`).toBe('string')
      }
      expect(schema, `${path} must not be nullable`).not.toHaveProperty('nullable')
      for (const key of ['properties', 'items']) {
        const child = schema[key]
        if (key === 'items') walk(child, `${path}.items`)
        else if (child && typeof child === 'object') {
          for (const [name, value] of Object.entries(child)) walk(value, `${path}.${name}`)
        }
      }
    }
    walk(BOARD_SCHEMA, 'schema')
  })

  it('requires every property it defines, so no field comes back missing', () => {
    const check = (node: { properties: object; required: readonly string[] }, path: string) => {
      expect([...node.required].sort(), `${path} required`).toEqual(
        Object.keys(node.properties).sort(),
      )
    }
    check(BOARD_SCHEMA, 'schema')
    check(BOARD_SCHEMA.properties.tiles.items, 'tiles.items')
    check(BOARD_SCHEMA.properties.ports.items, 'ports.items')
  })
})

describe('pulling JSON out of an open model’s reply', () => {
  const board = '{"tiles":[{"cell":"A1","terrain":"ore","number":6,"unsure":false}],"ports":[]}'

  it('reads a bare JSON reply', () => {
    expect(extractJson(board).tiles).toHaveLength(1)
  })

  it('unwraps a markdown fence', () => {
    expect(extractJson('```json\n' + board + '\n```').tiles).toHaveLength(1)
    expect(extractJson('```\n' + board + '\n```').tiles).toHaveLength(1)
  })

  it('skips a sentence of preamble, and a sign-off', () => {
    expect(extractJson(`Here is the board you asked for:\n${board}\nHope that helps!`).tiles)
      .toHaveLength(1)
  })

  it('survives the round trip into a real board', () => {
    const parsed = extractJson('```json\n' + board + '\n```')
    const folded = toBoard(parsed)
    expect(folded.tiles[0]).toEqual({ type: 'ore', number: 6 })
    expect(folded.unsure[0]).toBe(false)
  })

  it('complains clearly when there is no JSON at all', () => {
    expect(() => extractJson('I cannot see a board in this image.')).toThrow(/did not return any JSON/)
  })

  it('complains clearly when the JSON is broken', () => {
    expect(() => extractJson('{"tiles": [,,] }')).toThrow(/not valid JSON/)
  })

  it('treats a truncated reply as no JSON at all', () => {
    // Cut off by a token limit: there is no closing brace to bound an object.
    expect(() => extractJson('{"tiles": [')).toThrow(/did not return any JSON/)
  })
})
