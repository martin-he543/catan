import { useCallback, useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { AiKeyPanel } from '../components/AiKeyPanel'
import { BoardEditor } from '../components/BoardEditor'
import { ImageCalibrator } from '../components/ImageCalibrator'
import { NotationGuide } from '../components/NotationGuide'
import { encodeGame } from '../lib/codec'
import { boardToCsn, parseCsn } from '../lib/notation'
import {
  blankBoard,
  boardProblems,
  defaultAnchors,
  detectTiles,
  type Point,
  type TileGuess,
} from '../lib/vision'
import {
  AI_PROVIDERS,
  PROVIDERS,
  PROVIDER_STORAGE,
  isProvider,
  mediaTypeOf,
  modelStorage,
  readBoard,
  toBase64,
  type AiProvider,
} from '../lib/ai'
import type { Game, PortType, Tile } from '../lib/types'

/** The nine ports in the order the board lays them out, as a starting point. */
const DEFAULT_PORTS: PortType[] = ['31', 'wheat', '31', 'brick', 'ore', '31', 'sheep', '31', 'lumber']

interface Photo {
  url: string
  element: HTMLImageElement
  width: number
  height: number
  /** Kept so the AI path can send the original bytes rather than a re-encode. */
  file: File
}

function Step({ n, title, children }: { n: number; title: string; children: React.ReactNode }) {
  return (
    <section className="flex flex-col gap-4">
      <h2 className="flex items-center gap-3 font-display text-2xl font-bold">
        <span
          className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full
                     bg-sea-400 text-base text-sea-950"
          aria-hidden
        >
          {n}
        </span>
        {title}
      </h2>
      {children}
    </section>
  )
}

export function Import() {
  const [photo, setPhoto] = useState<Photo | null>(null)
  const [anchors, setAnchors] = useState<[Point, Point] | null>(null)
  const [tiles, setTiles] = useState<Tile[]>(blankBoard)
  const [ports, setPorts] = useState<PortType[]>(DEFAULT_PORTS)
  const [portShifts, setPortShifts] = useState<number[] | undefined>(undefined)
  const [guesses, setGuesses] = useState<TileGuess[] | null>(null)
  const [selected, setSelected] = useState<number | null>(null)
  const [status, setStatus] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [pasted, setPasted] = useState('')
  const [copied, setCopied] = useState(false)
  const [provider, setProvider] = useState<AiProvider>(() => {
    const stored = localStorage.getItem(PROVIDER_STORAGE)
    return isProvider(stored) ? stored : 'claude'
  })
  const [keys, setKeys] = useState<Record<AiProvider, string>>(() =>
    Object.fromEntries(
      AI_PROVIDERS.map((id) => [id, localStorage.getItem(PROVIDERS[id].storage) ?? '']),
    ) as Record<AiProvider, string>,
  )
  const [models, setModels] = useState<Record<AiProvider, string>>(() =>
    Object.fromEntries(
      AI_PROVIDERS.map((id) => [id, localStorage.getItem(modelStorage(id)) ?? '']),
    ) as Record<AiProvider, string>,
  )
  const [notes, setNotes] = useState<string[]>([])

  const apiKey = keys[provider]

  const chooseProvider = useCallback((next: AiProvider) => {
    setProvider(next)
    localStorage.setItem(PROVIDER_STORAGE, next)
  }, [])

  const saveKey = useCallback((which: AiProvider, key: string) => {
    setKeys((current) => ({ ...current, [which]: key }))
    if (key) localStorage.setItem(PROVIDERS[which].storage, key)
    else localStorage.removeItem(PROVIDERS[which].storage)
  }, [])

  const saveModel = useCallback((which: AiProvider, model: string) => {
    setModels((current) => ({ ...current, [which]: model }))
    if (model.trim()) localStorage.setItem(modelStorage(which), model.trim())
    else localStorage.removeItem(modelStorage(which))
  }, [])

  // Object URLs outlive the component unless we hand them back.
  const revoke = useRef<string | null>(null)
  useEffect(() => () => {
    if (revoke.current) URL.revokeObjectURL(revoke.current)
  }, [])

  const openFile = useCallback((file: File) => {
    if (!file.type.startsWith('image/')) {
      setStatus('That file is not an image.')
      return
    }
    const url = URL.createObjectURL(file)
    const element = new Image()
    element.onload = () => {
      if (revoke.current) URL.revokeObjectURL(revoke.current)
      revoke.current = url
      setPhoto({ url, element, width: element.naturalWidth, height: element.naturalHeight, file })
      setAnchors(defaultAnchors(element.naturalWidth, element.naturalHeight))
      setGuesses(null)
      setStatus(null)
      setNotes([])
    }
    element.onerror = () => {
      URL.revokeObjectURL(url)
      setStatus('That image could not be opened.')
    }
    element.src = url
  }, [])

  // Photos usually arrive from a phone, so accept a paste as readily as a drop.
  useEffect(() => {
    const onPaste = (event: ClipboardEvent) => {
      const file = [...(event.clipboardData?.files ?? [])][0]
      if (file) openFile(file)
    }
    window.addEventListener('paste', onPaste)
    return () => window.removeEventListener('paste', onPaste)
  }, [openFile])

  const detect = useCallback(async () => {
    if (!photo || !anchors) return
    setBusy(true)
    setStatus(null)
    try {
      const found = await detectTiles(photo.element, anchors[0], anchors[1])
      if (!found) {
        setStatus('The photo could not be read as pixels. Try saving it as a JPEG or PNG first.')
        return
      }
      setGuesses(found)
      // Detection only knows terrain; the numbers stay as the user left them.
      setTiles((current) => found.map((guess, i) => ({
        type: guess.type,
        number: guess.type === 'desert' ? 7 : current[i].number,
      })))
      const unsure = found.filter((g) => g.confidence < 0.35).length
      setStatus(
        unsure === 0
          ? 'Read all 19 tiles confidently. Check them over, then add the numbers.'
          : `Read the board, but ${unsure} ${unsure === 1 ? 'tile is' : 'tiles are'} a guess — they are ringed in amber below.`,
      )
    } finally {
      setBusy(false)
    }
  }, [photo, anchors])

  const readWithAi = useCallback(async () => {
    if (!photo || !apiKey) return
    const label = PROVIDERS[provider].label
    const mediaType = mediaTypeOf(photo.file)
    if (!mediaType) {
      setStatus('JPEG, PNG, GIF and WebP only. Save the photo as one of those first.')
      return
    }

    setBusy(true)
    setStatus(`Reading the board with ${label}…`)
    setNotes([])
    try {
      const board = await readBoard({
        provider,
        model: models[provider],
        apiKey,
        imageBase64: await toBase64(photo.file),
        mediaType,
      })
      setTiles(board.tiles)
      setPorts(board.ports)
      // Reuse the amber ring the colour detector lights up, so "unsure" looks
      // the same however the board was read.
      setGuesses(board.tiles.map((tile: Tile, i: number) => ({
        type: tile.type,
        confidence: board.unsure[i] ? 0 : 1,
      })))
      setNotes(board.notes)
      const blank = board.tiles.filter((t: Tile) => t.type !== 'desert' && t.number === 0).length
      setStatus(
        blank === 0
          ? `${label} read the whole board, numbers and all. Worth a glance before you use it.`
          : `${label} read the board but left ${blank} number${blank === 1 ? '' : 's'} blank.`,
      )
    } catch (error) {
      setStatus(error instanceof Error ? error.message : 'That read failed.')
    } finally {
      setBusy(false)
    }
  }, [photo, apiKey, provider, models])

  const loadNotation = useCallback(() => {
    const parsed = parseCsn(pasted)
    if (parsed.tiles) {
      setTiles(parsed.tiles)
      setGuesses(null)
    }
    if (parsed.ports) {
      setPorts(parsed.ports)
      setPortShifts(parsed.portShifts ?? undefined)
    }
    setStatus(
      parsed.tiles
        ? 'Loaded the board from that notation.'
        : parsed.issues[0]?.message ?? 'No [Board] tag in that notation.',
    )
  }, [pasted])

  const problems = boardProblems(tiles)
  const game: Game | null = problems.length === 0 ? { tiles, ports, portShifts, locs: [] } : null
  const csn = game ? boardToCsn(game, { Event: 'Imported board' }) : ''

  const copy = useCallback(async () => {
    await navigator.clipboard.writeText(csn)
    setCopied(true)
    setTimeout(() => setCopied(false), 1500)
  }, [csn])

  return (
    <div className="mx-auto flex max-w-5xl flex-col gap-14 px-4 py-10 lg:px-8">
      <header>
        <p className="font-display text-sm tracking-[0.2em] text-sea-200 uppercase">Import</p>
        <h1 className="mt-2 font-display text-4xl font-bold sm:text-5xl">
          Turn a photo into a board
        </h1>
        <p className="mt-4 max-w-2xl text-lg leading-relaxed text-sea-100/80">
          Photograph the board from above and the terrain reads itself — line the grid up and
          it is matched against the tile art, free and offline. Add a key for any of five
          vision models — four with free tiers — and the number tokens come back too. Either
          way you end up with a board you can analyse, share or write down in{' '}
          <a href="#notation" className="underline underline-offset-2 hover:text-white">
            Catan notation
          </a>
          .
        </p>
      </header>

      <Step n={1} title="Your photo">
        <label
          onDragOver={(e) => e.preventDefault()}
          onDrop={(e) => {
            e.preventDefault()
            const file = e.dataTransfer.files[0]
            if (file) openFile(file)
          }}
          className="flex cursor-pointer flex-col items-center gap-2 rounded-2xl border border-dashed
                     border-white/20 bg-white/5 px-6 py-10 text-center transition hover:bg-white/10"
        >
          <span className="font-display font-semibold">
            {photo ? 'Choose a different photo' : 'Drop a photo here, or click to choose one'}
          </span>
          <span className="text-sm text-sea-200">
            You can also just paste one. Straight down and well lit reads best.
          </span>
          <input
            type="file"
            accept="image/*"
            className="sr-only"
            onChange={(e) => {
              const file = e.target.files?.[0]
              if (file) openFile(file)
            }}
          />
        </label>

        {photo && anchors && (
          <>
            <p className="text-sm text-sea-100/70">
              Drag the two yellow handles onto the middle of the tiles they name. The rest of
              the grid follows, because the board is rigid. Arrow keys nudge a selected handle.
            </p>
            <ImageCalibrator
              src={photo.url}
              width={photo.width}
              height={photo.height}
              anchors={anchors}
              onChange={setAnchors}
            />
            <div className="flex flex-wrap items-center gap-3">
              <button
                type="button"
                onClick={detect}
                disabled={busy}
                className="rounded-xl bg-sea-400 px-5 py-3 font-display font-semibold text-sea-950
                           transition hover:brightness-110 disabled:opacity-60"
              >
                {busy ? 'Reading…' : 'Read the board'}
              </button>
              <button
                type="button"
                onClick={() => setAnchors(defaultAnchors(photo.width, photo.height))}
                className="rounded-xl border border-white/15 px-5 py-3 font-display font-semibold
                           transition hover:bg-white/10"
              >
                Reset the grid
              </button>
              {apiKey && (
                <button
                  type="button"
                  onClick={readWithAi}
                  disabled={busy}
                  className="rounded-xl border border-sea-400/50 bg-sea-400/15 px-5 py-3
                             font-display font-semibold transition hover:bg-sea-400/25
                             disabled:opacity-60"
                >
                  Read with {PROVIDERS[provider].label}, numbers and all
                </button>
              )}
            </div>
          </>
        )}

        {status && (
          <p role="status" className="rounded-xl bg-white/10 px-4 py-3 text-sm text-sea-100">
            {status}
          </p>
        )}

        {notes.length > 0 && (
          <ul className="list-inside list-disc rounded-xl bg-white/5 px-4 py-3 text-sm text-sea-100/75">
            {notes.map((note) => (
              <li key={note}>{note}</li>
            ))}
          </ul>
        )}

        <AiKeyPanel
          provider={provider}
          onProvider={chooseProvider}
          keys={keys}
          onKey={saveKey}
          models={models}
          onModel={saveModel}
        />
      </Step>

      <Step n={2} title="Check it over">
        <p className="text-sm text-sea-100/70">
          Whatever read the board, it is worth a look: anything it was unsure of is ringed in
          amber. Select a tile and type to fix it — 2 to 9 land straight away, and 1 waits for
          the 0, 1 or 2 that follows. Click a port to change it, and use the arrows beside it if
          your board's harbour faces the next edge along.
        </p>
        <BoardEditor
          tiles={tiles}
          ports={ports}
          portShifts={portShifts}
          guesses={guesses}
          selected={selected}
          onSelect={setSelected}
          onTile={(i, tile) => setTiles((current) => current.map((t, at) => (at === i ? tile : t)))}
          onPort={(i, port) => setPorts((current) => current.map((p, at) => (at === i ? port : p)))}
          onShiftPorts={setPortShifts}
        />
      </Step>

      <Step n={3} title="Take it away">
        {problems.length > 0 ? (
          <div className="rounded-2xl border border-amber-400/30 bg-amber-400/10 px-4 py-3">
            <p className="font-display font-semibold text-amber-100">Not a legal board yet</p>
            <ul className="mt-2 list-inside list-disc text-sm text-amber-100/80">
              {problems.map((problem) => (
                <li key={problem}>{problem}</li>
              ))}
            </ul>
          </div>
        ) : (
          <div className="flex flex-col gap-4">
            <div className="flex flex-wrap gap-3">
              <Link
                to={`/board?gameType=random&game=${encodeURIComponent(encodeGame({ tiles, ports, portShifts, locs: [] }))}`}
                className="rounded-xl bg-sea-400 px-5 py-3 font-display font-semibold text-sea-950
                           transition hover:brightness-110"
              >
                Open in the board generator
              </Link>
              <button
                type="button"
                onClick={copy}
                className="rounded-xl border border-white/15 px-5 py-3 font-display font-semibold
                           transition hover:bg-white/10"
              >
                {copied ? 'Copied' : 'Copy the notation'}
              </button>
            </div>
            <pre className="overflow-x-auto rounded-2xl border border-white/10 bg-black/40 p-4
                            font-mono text-xs leading-relaxed text-sea-100">
              {csn}
            </pre>
          </div>
        )}

        <details className="panel px-4 py-3">
          <summary className="cursor-pointer font-display font-semibold">
            Or start from notation you already have
          </summary>
          <textarea
            value={pasted}
            onChange={(e) => setPasted(e.target.value)}
            rows={4}
            spellCheck={false}
            placeholder={'[Board "O6 B3 G11 / …"]\n[Ports "* G * B O * W * L"]'}
            className="mt-3 w-full rounded-xl border border-white/10 bg-black/40 p-3
                       font-mono text-xs text-sea-100 placeholder:text-sea-200/40"
          />
          <button
            type="button"
            onClick={loadNotation}
            className="mt-2 rounded-xl border border-white/15 px-4 py-2 text-sm font-semibold
                       transition hover:bg-white/10"
          >
            Load it
          </button>
        </details>
      </Step>

      <section id="notation" className="flex flex-col gap-4 scroll-mt-20">
        <h2 className="font-display text-2xl font-bold">Catan notation</h2>
        <p className="max-w-2xl text-sea-100/80">
          Chess has a way to write down a position and every move that follows it, so games can
          be shared, studied and argued over. This is the same idea for Catan: a short header
          for the board, then one line per turn.
        </p>
        <NotationGuide />
      </section>
    </div>
  )
}
