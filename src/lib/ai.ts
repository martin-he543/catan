/**
 * Reading a board with a vision model.
 *
 * The colour classifier in `vision.ts` is good at terrain and useless at number
 * tokens — OCR on a small printed numeral in a phone photo is exactly the kind
 * of thing it cannot do. A vision model reads both, so this is offered as an
 * opt-in upgrade rather than a replacement: no key, no network, no problem.
 *
 * Two providers are supported, and everything except the call itself is shared:
 * one prompt, one schema, one function that folds the answer onto the board. A
 * provider module is only allowed to differ in how it asks.
 *
 * The site is static, so there is nowhere to keep a secret. Keys are the user's
 * own, live in their browser, and go straight to the provider — see the warning
 * the settings panel renders beside them.
 */
import { HEX_LABELS, PORT_SLOT_LABELS, hexIndex } from './notation'
import { NO_NUMBER, blankBoard } from './vision'
import { PORT_TYPES, TILE_TYPES, type PortType, type Tile, type TileType } from './types'

/* ------------------------------------------------------------------ *
 * Providers
 * ------------------------------------------------------------------ */

export const AI_PROVIDERS = ['claude', 'gemini', 'openrouter', 'groq', 'mistral'] as const
export type AiProvider = (typeof AI_PROVIDERS)[number]

export interface ProviderInfo {
  id: AiProvider
  label: string
  /** Where this provider's key is kept in local storage. */
  storage: string
  /** Shown in the empty key box, so a key pasted in the wrong slot is obvious. */
  placeholder: string
  /** Where to go to mint or revoke one. */
  console: string
  consoleLabel: string
  /** The model used unless the user overrides it. */
  model: string
  /** Vision-capable models known to work here, offered as suggestions. */
  models: string[]
  /** Whether a board read costs nothing on the provider's entry tier. */
  free: boolean
  /** A word on what the free tier actually gets you. */
  note: string
  /**
   * OpenAI-compatible providers share one client; these are its settings.
   * Absent for providers with their own SDK.
   */
  openai?: {
    baseUrl: string
    /** Whether the provider accepts `response_format: {type: 'json_object'}`. */
    jsonMode: boolean
    /** Sent by OpenRouter's ranking headers; harmless elsewhere. */
    referer?: boolean
  }
}

/**
 * Every provider here answers cross-origin — checked against each API's CORS
 * preflight, because a static site has no server to proxy through and a key
 * alone is not enough. GitHub Models, for one, sends no CORS headers and so
 * cannot be offered at all.
 */
export const PROVIDERS: Record<AiProvider, ProviderInfo> = {
  claude: {
    id: 'claude',
    label: 'Claude',
    storage: 'catan.anthropic-key',
    placeholder: 'sk-ant-…',
    console: 'https://console.anthropic.com/settings/keys',
    consoleLabel: 'Anthropic console',
    model: 'claude-opus-5',
    models: ['claude-opus-5', 'claude-sonnet-5', 'claude-haiku-4-5'],
    free: false,
    note: 'Paid, and the most accurate of these. A penny or two per board.',
  },
  gemini: {
    id: 'gemini',
    label: 'Gemini',
    storage: 'catan.gemini-key',
    placeholder: 'AIza…',
    console: 'https://aistudio.google.com/apikey',
    consoleLabel: 'Google AI Studio',
    // Flash, not Pro: the Pro models have no free quota at all, so a free key
    // pointed at one fails with a 429 that reads like a billing problem.
    model: 'gemini-flash-latest',
    models: ['gemini-flash-latest', 'gemini-flash-lite-latest', 'gemini-pro-latest'],
    free: true,
    note: 'Free tier on Flash. The Pro models are paid-only and will 429.',
  },
  openrouter: {
    id: 'openrouter',
    label: 'OpenRouter',
    storage: 'catan.openrouter-key',
    placeholder: 'sk-or-…',
    console: 'https://openrouter.ai/settings/keys',
    consoleLabel: 'OpenRouter dashboard',
    model: 'qwen/qwen3.8-27b:free',
    // Free vision models, read off OpenRouter's public catalogue.
    models: [
      'qwen/qwen3.8-27b:free',
      'google/gemma-4-31b-it:free',
      'google/gemma-4-26b-a4b-it:free',
      'thinkingmachines/inkling:free',
      'dots-studio/dots-3-note-preview:free',
    ],
    free: true,
    note: 'One key, many free vision models. Anything tagged :free costs nothing.',
    openai: { baseUrl: 'https://openrouter.ai/api/v1', jsonMode: false, referer: true },
  },
  groq: {
    id: 'groq',
    label: 'Groq',
    storage: 'catan.groq-key',
    placeholder: 'gsk_…',
    console: 'https://console.groq.com/keys',
    consoleLabel: 'Groq console',
    model: 'qwen/qwen3.8-27b',
    models: ['qwen/qwen3.8-27b'],
    free: true,
    note: 'Free tier with daily limits, and by far the fastest of these.',
    openai: { baseUrl: 'https://api.groq.com/openai/v1', jsonMode: true },
  },
  mistral: {
    id: 'mistral',
    label: 'Mistral',
    storage: 'catan.mistral-key',
    placeholder: '…',
    console: 'https://console.mistral.ai/api-keys',
    consoleLabel: 'Mistral console',
    model: 'mistral-small-latest',
    models: ['mistral-small-latest', 'ministral-14b-latest', 'mistral-medium-2508'],
    free: true,
    note: 'Free experiment tier once you verify a phone number.',
    openai: { baseUrl: 'https://api.mistral.ai/v1', jsonMode: true },
  },
}

/** Where a per-provider model override is kept. */
export const modelStorage = (provider: AiProvider) => `catan.model.${provider}`

/** The model a read will actually use: the user's override, else the default. */
export const effectiveModel = (provider: AiProvider, override?: string) =>
  override?.trim() || PROVIDERS[provider].model

/** Which provider the user last used. */
export const PROVIDER_STORAGE = 'catan.ai-provider'

export function isProvider(value: string | null): value is AiProvider {
  return value !== null && (AI_PROVIDERS as readonly string[]).includes(value)
}

/* ------------------------------------------------------------------ *
 * What we ask for
 * ------------------------------------------------------------------ */

export interface AiBoard {
  tiles: Tile[]
  ports: PortType[]
  /** Tiles, in board order, the model said it could not read confidently. */
  unsure: boolean[]
  /** Anything worth telling the user — a blocked token, a disagreement with the box. */
  notes: string[]
}

/**
 * The reply we want back, as plain JSON Schema.
 *
 * Deliberately kept to the intersection both providers accept: no nullable
 * types and no `type: [...]` unions, which Gemini's schema subset rejects. A
 * number the model could not read comes back as 0 — the same "not known yet"
 * sentinel the editor already uses — rather than as null.
 *
 * Tiles are keyed by the cell they name rather than by array position, so one
 * misread cannot silently shift the whole board along by one.
 */
export const BOARD_SCHEMA = {
  type: 'object',
  properties: {
    orientation: {
      type: 'string',
      description: 'One sentence on how you decided which way up the board is.',
    },
    tiles: {
      type: 'array',
      description: 'All 19 tiles, one entry per cell.',
      items: {
        type: 'object',
        properties: {
          cell: { type: 'string', description: 'A1-A3, B1-B4, C1-C5, D1-D4 or E1-E3.' },
          terrain: {
            type: 'string',
            enum: ['brick', 'lumber', 'ore', 'wheat', 'sheep', 'desert'],
          },
          number: {
            type: 'integer',
            description:
              'The number token, 2-12 and never 7. Use 0 for the desert, or if the token is hidden.',
          },
          unsure: { type: 'boolean', description: 'True if you are not confident about this tile.' },
        },
        required: ['cell', 'terrain', 'number', 'unsure'],
        additionalProperties: false,
      },
    },
    ports: {
      type: 'array',
      description: 'All 9 ports, one entry per berth.',
      items: {
        type: 'object',
        properties: {
          berth: { type: 'string', description: 'One of the nine berth names given to you.' },
          trade: {
            type: 'string',
            enum: ['any', 'brick', 'lumber', 'ore', 'wheat', 'sheep'],
            description: '"any" is a 3:1 port; a resource means a 2:1 port for it.',
          },
        },
        required: ['berth', 'trade'],
        additionalProperties: false,
      },
    },
  },
  required: ['orientation', 'tiles', 'ports'],
  additionalProperties: false,
} as const

const PROMPT = `You are reading a photograph of a standard base-game Settlers of Catan board.

THE LAYOUT
The island is 19 hexagons in five rows of 3, 4, 5, 4 and 3. Work out which way
up the board is in this photo, then read it in that orientation:
  row A (3 tiles) at the top, then B (4), C (5), D (4), E (3) at the bottom,
  numbering left to right within each row: A1 A2 A3 / B1..B4 / C1..C5 / D1..D4 / E1..E3.
The photo may be rotated or taken from an angle. Choose the rotation that makes
the rows read 3, 4, 5, 4, 3 from top to bottom, and say which you chose.

THE TERRAIN
  hills, red-brown clay       -> brick
  forest, dark green trees    -> lumber
  mountains, grey rock        -> ore
  fields, golden corn         -> wheat
  pasture, light green grass  -> sheep
  desert, pale sand           -> desert

WHAT IS IN THE BOX
Use this to check yourself — a correct reading spends it exactly:
  1 desert, 3 brick, 4 lumber, 3 ore, 4 wheat, 4 sheep.
  Number tokens: one 2, one 12, and two each of 3, 4, 5, 6, 8, 9, 10, 11.
  There is never a 7. The desert has no token at all.
  The 6s and 8s are printed in red; every other number is black.

THE PORTS
Nine ports sit on the surrounding water, each on one edge of one land tile.
Read each of these berths, named by the tile and the compass edge it sits on:
  BERTHS
A port shows either "3:1" (any) or a 2:1 picture of a single resource.

BEING HONEST IS MORE USEFUL THAN GUESSING
Set "unsure": true for any tile you cannot read cleanly, and use 0 for a number
token that is hidden by the robber, a piece, a hand or glare. A blank we can ask
about is worth far more than a confident mistake.`

/** Fill in the berth names from the geometry so the prompt cannot drift. */
export const buildPrompt = () =>
  PROMPT.replace('  BERTHS', PORT_SLOT_LABELS.map((b) => `  ${b}`).join('\n'))

/* ------------------------------------------------------------------ *
 * The call
 * ------------------------------------------------------------------ */

export interface ReadOptions {
  provider: AiProvider
  apiKey: string
  /** Overrides the provider's default model when set. */
  model?: string
  /** Base64 of the photo, without the data-URL prefix. */
  imageBase64: string
  mediaType: MediaType
  signal?: AbortSignal
}

/** What a provider module receives; the provider and model are already resolved. */
export type ProviderRequest = Omit<ReadOptions, 'provider' | 'model'> & {
  provider: AiProvider
  model: string
}

/**
 * Read a board photo with whichever provider the user picked.
 *
 * Each SDK is imported lazily — they are a few hundred kilobytes apiece, and
 * nobody who sticks to the colour classifier should have to download either.
 */
export async function readBoard(options: ReadOptions): Promise<AiBoard> {
  const { provider, model, ...rest } = options
  const request: ProviderRequest = {
    ...rest,
    provider,
    model: effectiveModel(provider, model),
  }

  if (PROVIDERS[provider].openai) {
    return toBoard(await (await import('./ai-openai')).callOpenAiCompatible(request))
  }
  if (provider === 'gemini') {
    return toBoard(await (await import('./ai-gemini')).callGemini(request))
  }
  return toBoard(await (await import('./ai-claude')).callClaude(request))
}

/**
 * Pull a JSON object out of a reply that may not be pure JSON.
 *
 * The providers with their own SDKs constrain the response to our schema, but
 * the open models reached through an OpenAI-compatible endpoint vary: some
 * honour JSON mode, some wrap the answer in a ```json fence, some add a
 * sentence of preamble. Rather than trust any of that, take the outermost
 * braces and let `toBoard` judge what is inside.
 */
export function extractJson(text: string): RawBoard {
  const fenced = /```(?:json)?\s*([\s\S]*?)```/.exec(text)
  const body = fenced ? fenced[1] : text
  const start = body.indexOf('{')
  const end = body.lastIndexOf('}')
  if (start < 0 || end <= start) throw new Error('The model did not return any JSON.')
  try {
    return JSON.parse(body.slice(start, end + 1)) as RawBoard
  } catch {
    throw new Error('The model returned something that was not valid JSON.')
  }
}

/* ------------------------------------------------------------------ *
 * Folding the answer onto the board
 * ------------------------------------------------------------------ */

/** Shape of a successful reply, kept loose so a stray field cannot throw. */
export interface RawBoard {
  tiles?: ReadonlyArray<{
    cell?: string
    terrain?: string
    number?: number | null
    unsure?: boolean
  }>
  ports?: ReadonlyArray<{ berth?: string; trade?: string }>
}

const PORT_BY_TRADE: Record<string, PortType> = {
  any: '31', brick: 'brick', lumber: 'lumber', ore: 'ore', wheat: 'wheat', sheep: 'sheep',
}

/**
 * Fold a model's answer onto our board, keeping every disagreement.
 *
 * Nothing here trusts the reply: an unknown cell, a duplicate, a 7, a terrain
 * we do not have — each is recorded as a note and left for the user to fix in
 * the editor, rather than throwing away an otherwise good read.
 */
export function toBoard(raw: RawBoard): AiBoard {
  const tiles: Tile[] = blankBoard().map(() => ({ type: 'desert' as TileType, number: NO_NUMBER }))
  const unsure = tiles.map(() => true)
  const notes: string[] = []
  const seen = new Set<number>()

  for (const entry of raw.tiles ?? []) {
    const at = hexIndex(String(entry.cell ?? '').trim().toUpperCase())
    if (at < 0) {
      notes.push(`Ignored a tile for "${entry.cell}", which is not a square on the board.`)
      continue
    }
    if (seen.has(at)) {
      notes.push(`${HEX_LABELS[at]} was read twice; kept the first.`)
      continue
    }
    if (!TILE_TYPES.includes(entry.terrain as TileType)) {
      notes.push(`${HEX_LABELS[at]} came back as "${entry.terrain}", which is not a terrain.`)
      continue
    }
    seen.add(at)

    const type = entry.terrain as TileType
    const number = entry.number
    const usable = typeof number === 'number' && number >= 2 && number <= 12 && number !== 7

    tiles[at] = { type, number: type === 'desert' ? 7 : usable ? number : NO_NUMBER }
    unsure[at] = Boolean(entry.unsure) || (type !== 'desert' && !usable)

    // 0 and null both mean "could not read it", which is expected and fine.
    // Any other unusable value is the model contradicting the rules.
    if (type !== 'desert' && !usable && number !== null && number !== 0 && number !== undefined) {
      notes.push(`${HEX_LABELS[at]} came back with a ${number}, which is not a token.`)
    }
  }

  for (let i = 0; i < tiles.length; i++) {
    if (!seen.has(i)) notes.push(`${HEX_LABELS[i]} was not reported at all.`)
  }

  const ports = readPorts(raw.ports ?? [], notes)
  const blind = unsure.filter(Boolean).length
  if (blind > 0) {
    notes.push(`${blind} ${blind === 1 ? 'tile is' : 'tiles are'} marked unsure — ringed in amber below.`)
  }

  return { tiles, ports, unsure, notes }
}

function readPorts(
  raw: ReadonlyArray<{ berth?: string; trade?: string }>,
  notes: string[],
): PortType[] {
  const ports: PortType[] = PORT_SLOT_LABELS.map(() => '31')
  for (const entry of raw) {
    const at = PORT_SLOT_LABELS.indexOf(String(entry.berth ?? '').trim())
    if (at < 0) {
      notes.push(`Ignored a port at "${entry.berth}", which is not a berth.`)
      continue
    }
    const type = PORT_BY_TRADE[String(entry.trade ?? '').trim().toLowerCase()]
    if (!type || !PORT_TYPES.includes(type)) {
      notes.push(`${entry.berth} came back as "${entry.trade}", which is not a port.`)
      continue
    }
    ports[at] = type
  }
  return ports
}

/* ------------------------------------------------------------------ *
 * Images
 * ------------------------------------------------------------------ */

/** The media types both providers accept, so we can refuse the rest up front. */
export const SUPPORTED_MEDIA = ['image/jpeg', 'image/png', 'image/gif', 'image/webp'] as const
export type MediaType = (typeof SUPPORTED_MEDIA)[number]

export function mediaTypeOf(file: File): MediaType | null {
  const type = file.type.toLowerCase()
  return (SUPPORTED_MEDIA as readonly string[]).includes(type) ? (type as MediaType) : null
}

/** Read a file as base64, with the data-URL prefix stripped off. */
export function toBase64(file: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result).split(',')[1] ?? '')
    reader.onerror = () => reject(new Error('That image could not be read.'))
    reader.readAsDataURL(file)
  })
}
