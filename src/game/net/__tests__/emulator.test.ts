/**
 * Online play against the Firebase emulator suite: two players and a bot
 * play a real game through the same code the browser uses, the security
 * rules are poked at directly, and a server-refereed game runs through the
 * Cloud Functions.
 *
 * Skipped unless FIREBASE_EMULATORS=1. Run it with:
 *
 *   npm run test:emulators
 */
import { beforeAll, describe, expect, it, vi } from 'vitest'
import { botAction } from '../../engine/bot'
import { configFor } from '../../engine/config'
import { waitingOn } from '../../engine/rules'
import type { GameState } from '../../engine/types'
import type { GameView } from '../../engine/view'

const enabled = process.env.FIREBASE_EMULATORS === '1'

type Client = {
  online: typeof import('../online')
  firebase: typeof import('../firebase')
  fs: typeof import('firebase/firestore')
}

/** A fresh browser: its own Firebase app, its own anonymous user. */
async function client(): Promise<Client> {
  vi.resetModules()
  const [online, firebase, fs] = await Promise.all([import('../online'), import('../firebase'), import('firebase/firestore')])
  await firebase.ensureUser()
  return { online, firebase, fs }
}

async function readGame(c: Client, code: string) {
  const { db } = await c.firebase.getFirebase()
  const snap = await c.fs.getDoc(c.fs.doc(db, 'games', code))
  return snap.data() as import('../protocol').GameDoc
}

async function denied(work: () => Promise<unknown>) {
  try {
    await work()
  } catch (error) {
    const { code, message } = error as { code?: string; message?: string }
    return code === 'permission-denied' || /permission|insufficient/i.test(String(message ?? error))
  }
  return false
}

describe.skipIf(!enabled)('online play on the emulators', () => {
  beforeAll(() => {
    vi.stubEnv('VITE_FIREBASE_API_KEY', 'demo-key')
    vi.stubEnv('VITE_FIREBASE_PROJECT_ID', 'demo-catan')
    vi.stubEnv('VITE_FIREBASE_APP_ID', 'demo-app')
    vi.stubEnv('VITE_FIREBASE_EMULATORS', 'true')
    vi.stubEnv('VITE_FIREBASE_AUTHORITY', 'client')
  })

  it('plays a browser-refereed game between two people and a bot', async () => {
    const host = await client()
    const guest = await client()
    const stranger = await client()

    const code = await host.online.createOnlineGame({
      mode: 'classic',
      config: configFor('classic', 3),
      visibility: 'public',
      hostName: 'Ana',
      seats: [{ bot: false, name: 'Ana' }, { bot: false, name: '' }, { bot: true, name: 'Bot 3' }],
    })
    expect(code).toMatch(/^[A-Z2-9]{6}$/)

    await guest.online.joinGame(code, 'Ben')
    let game = await readGame(host, code)
    expect(game.seats.map((s) => s.name)).toEqual(['Ana', 'Ben', 'Bot 3'])

    // Only the host deals.
    await expect(guest.online.startGame(code)).rejects.toThrow(/host/)
    await host.online.startGame(code)
    game = await readGame(host, code)
    expect(game.status).toBe('playing')

    // Play 150 actions, each player acting from their own browser.
    const clients = [host, guest]
    for (let i = 0; i < 150; i++) {
      game = await readGame(host, code)
      const state = JSON.parse(game.state!) as GameState
      if (state.phase === 'ended') break
      const order = [...new Set([...waitingOn(state), 0, 1, 2])]
      const seat = order.find((s) => botAction(state, s))!
      const action = botAction(state, seat)!
      const who = seat === 2 ? host : clients[seat]
      await who.online.submitAction(code, 'client', action, seat === 2 ? { seat, expectedSeq: state.seq } : { expectedSeq: state.seq })
    }
    game = await readGame(host, code)
    expect(game.seq).toBeGreaterThan(40)

    // Every action is in the log, with its dice.
    const log = await host.online.loadLog(code)
    expect(log.length).toBe(game.seq + 1)
    expect(log[log.length - 1].seq).toBe(game.seq)

    // The rules hold up against a browser that goes around the client code.
    const { db: guestDb } = await guest.firebase.getFirebase()
    const { db: strangerDb } = await stranger.firebase.getFirebase()
    const ref = (db: typeof guestDb) => guest.fs.doc(db, 'games', code)
    expect(await denied(() => guest.fs.updateDoc(ref(guestDb), { seq: game.seq + 2, state: game.state }))).toBe(true)
    expect(await denied(() => guest.fs.updateDoc(ref(guestDb), { hostUid: 'someone-else' }))).toBe(true)
    expect(await denied(() => stranger.fs.updateDoc(ref(strangerDb), { seq: game.seq + 1, state: game.state }))).toBe(true)
    expect(await denied(() => stranger.fs.setDoc(stranger.fs.doc(strangerDb, 'games', code, 'log', '9999'), { seq: 9999, uid: 'x' }))).toBe(true)
    // Watchers can read, but not talk.
    expect((await readGame(stranger, code)).code).toBe(code)
    expect(await denied(() => stranger.online.sendChat(code, 'Eve', null, 'hi'))).toBe(true)
    await guest.online.sendChat(code, 'Ben', 1, 'good game')

    // A stale submission is dropped rather than applied twice.
    const fresh = await readGame(host, code)
    const state = JSON.parse(fresh.state!) as GameState
    if (state.phase !== 'ended') {
      await expect(host.online.submitAction(code, 'client', { type: 'endTurn' }, { expectedSeq: state.seq - 1 })).rejects.toThrow(/moved on/)
    }
  }, 120_000)

  it('keeps hands secret when the Cloud Functions referee', async () => {
    const host = await client()
    const guest = await client()
    const code = await host.online.createOnlineGame({
      mode: 'cities-knights',
      config: configFor('cities-knights', 3),
      visibility: 'private',
      hostName: 'Ana',
      seats: [{ bot: false, name: 'Ana' }, { bot: false, name: '' }, { bot: true, name: 'Bot 3' }],
      authority: 'server',
    })
    await guest.online.joinGame(code, 'Ben')
    await host.online.startGame(code)

    const hostUser = await host.firebase.ensureUser()
    const guestUser = await guest.firebase.ensureUser()
    const { db: hostDb } = await host.firebase.getFirebase()
    const { db: guestDb } = await guest.firebase.getFirebase()
    const view = async (c: Client, db: typeof hostDb, uid: string) =>
      JSON.parse(((await c.fs.getDoc(c.fs.doc(db, 'games', code, 'views', uid))).data() as { state: string }).state) as GameView

    // Nobody reads the full state, or someone else's view.
    expect(await denied(() => host.fs.getDoc(host.fs.doc(hostDb, 'games', code, 'secret', 'state')))).toBe(true)
    expect(await denied(() => guest.fs.getDoc(guest.fs.doc(guestDb, 'games', code, 'views', hostUser.uid)))).toBe(true)
    // Nor can a player write to a server-refereed game.
    const game = await readGame(host, code)
    expect(await denied(() => host.fs.updateDoc(host.fs.doc(hostDb, 'games', code), { seq: game.seq + 1, state: '{}' }))).toBe(true)

    // Play through setup from the views alone; the server plays the bot.
    for (let i = 0; i < 40; i++) {
      const g = await readGame(host, code)
      if (g.status !== 'playing') break
      const seat = g.waiting[0]
      if (seat === undefined || seat > 1) break
      const [c, db, uid] = seat === 0 ? [host, hostDb, hostUser.uid] : [guest, guestDb, guestUser.uid]
      const v = await view(c, db, uid)
      const action = botAction(v as unknown as GameState, seat)
      if (!action) break
      await c.online.submitAction(code, 'server', action)
    }
    const after = await readGame(host, code)
    expect(after.seq).toBeGreaterThan(10)

    // Each view hides the others' cards.
    const mine = await view(host, hostDb, hostUser.uid)
    expect(mine.viewer).toBe(0)
    expect(mine.players[1].hidden).toBeDefined()
    expect(Object.values(mine.players[1].hand).every((n) => n === 0)).toBe(true)
    expect(mine.progressDecks.science).toEqual([])
  }, 120_000)
})
