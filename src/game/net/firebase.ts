/**
 * Firebase, loaded on demand so the rest of the site doesn't pay for it.
 *
 * Configuration comes from `VITE_FIREBASE_*` variables at build time (see
 * FIREBASE_SETUP.md). For trying things out without a rebuild, the same
 * settings can be pasted into the Play page, which keeps them in this
 * browser's localStorage.
 */
import type { FirebaseApp } from 'firebase/app'
import type { Auth, User } from 'firebase/auth'
import type { Firestore } from 'firebase/firestore'
import type { Functions } from 'firebase/functions'

export type Authority = 'client' | 'server'

export interface FirebaseSettings {
  apiKey: string
  authDomain: string
  projectId: string
  appId: string
  storageBucket?: string
  messagingSenderId?: string
  /** Region the Cloud Functions are deployed to. */
  functionsRegion?: string
  /**
   * `client`: browsers referee the game in Firestore transactions (free Spark
   * plan). `server`: a Cloud Function referees and hides cards (Blaze plan).
   */
  authority?: Authority
  /** Talk to the local emulator suite instead of the real project. */
  emulators?: boolean
}

const STORAGE_KEY = 'catan.firebase'

/** Keep in step with "emulators" in firebase.json. */
export const EMULATOR_PORTS = { auth: 9199, firestore: 8180, functions: 5101 } as const

const env = import.meta.env

function fromEnv(): FirebaseSettings | null {
  if (!env.VITE_FIREBASE_API_KEY || !env.VITE_FIREBASE_PROJECT_ID) return null
  return {
    apiKey: env.VITE_FIREBASE_API_KEY,
    authDomain: env.VITE_FIREBASE_AUTH_DOMAIN || `${env.VITE_FIREBASE_PROJECT_ID}.firebaseapp.com`,
    projectId: env.VITE_FIREBASE_PROJECT_ID,
    appId: env.VITE_FIREBASE_APP_ID ?? '',
    storageBucket: env.VITE_FIREBASE_STORAGE_BUCKET || undefined,
    messagingSenderId: env.VITE_FIREBASE_MESSAGING_SENDER_ID || undefined,
    functionsRegion: env.VITE_FIREBASE_FUNCTIONS_REGION || undefined,
    authority: env.VITE_FIREBASE_AUTHORITY === 'server' ? 'server' : 'client',
    emulators: env.VITE_FIREBASE_EMULATORS === 'true',
  }
}

function fromStorage(): FirebaseSettings | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw) as FirebaseSettings
    return parsed.apiKey && parsed.projectId ? parsed : null
  } catch {
    return null
  }
}

/** Where the settings came from, for the setup panel. */
export function settingsSource(): 'env' | 'browser' | null {
  if (fromEnv()) return 'env'
  if (fromStorage()) return 'browser'
  return null
}

export const firebaseSettings = (): FirebaseSettings | null => fromEnv() ?? fromStorage()

export const isConfigured = () => firebaseSettings() !== null

/**
 * Accept the `firebaseConfig` object Firebase shows in the console, either as
 * JSON or as the JavaScript snippet (`const firebaseConfig = { apiKey: "…" }`).
 */
export function parseSettings(text: string): FirebaseSettings | null {
  const body = text.slice(text.indexOf('{'), text.lastIndexOf('}') + 1)
  if (!body) return null
  let parsed: Record<string, unknown> | null = null
  try {
    parsed = JSON.parse(body)
  } catch {
    // A JS object literal: quote the keys and swap single quotes.
    try {
      const json = body
        .replace(/\/\/.*$/gm, '')
        .replace(/([{,]\s*)([A-Za-z_$][\w$]*)\s*:/g, '$1"$2":')
        .replace(/'([^']*)'/g, '"$1"')
        .replace(/,\s*}/g, '}')
      parsed = JSON.parse(json)
    } catch {
      return null
    }
  }
  if (!parsed || typeof parsed.apiKey !== 'string' || typeof parsed.projectId !== 'string') return null
  return {
    apiKey: parsed.apiKey,
    authDomain: (parsed.authDomain as string) || `${parsed.projectId}.firebaseapp.com`,
    projectId: parsed.projectId,
    appId: (parsed.appId as string) ?? '',
    storageBucket: parsed.storageBucket as string | undefined,
    messagingSenderId: parsed.messagingSenderId as string | undefined,
    functionsRegion: parsed.functionsRegion as string | undefined,
    authority: parsed.authority === 'server' ? 'server' : 'client',
    emulators: parsed.emulators === true,
  }
}

export function saveSettings(settings: FirebaseSettings | null) {
  if (settings) localStorage.setItem(STORAGE_KEY, JSON.stringify(settings))
  else localStorage.removeItem(STORAGE_KEY)
  // A different project means a different app; start clean.
  cached = null
  userPromise = null
}

export interface FirebaseHandles {
  app: FirebaseApp
  auth: Auth
  db: Firestore
  functions: Functions
  settings: FirebaseSettings
}

let cached: Promise<FirebaseHandles> | null = null
let connections = 0

export function getFirebase(): Promise<FirebaseHandles> {
  if (cached) return cached
  const settings = firebaseSettings()
  if (!settings) return Promise.reject(new Error('Firebase is not configured yet'))
  cached = (async () => {
    const [{ initializeApp }, authMod, fsMod, fnMod] = await Promise.all([
      import('firebase/app'),
      import('firebase/auth'),
      import('firebase/firestore'),
      import('firebase/functions'),
    ])
    // A named app per connection, so switching projects (or a test running
    // two players side by side) never trips over an older one.
    const app = initializeApp(
      {
        apiKey: settings.apiKey,
        authDomain: settings.authDomain,
        projectId: settings.projectId,
        appId: settings.appId,
        storageBucket: settings.storageBucket,
        messagingSenderId: settings.messagingSenderId,
      },
      `catan-${++connections}-${Math.random().toString(36).slice(2, 8)}`,
    )
    const auth = authMod.getAuth(app)
    const db = fsMod.initializeFirestore(app, { ignoreUndefinedProperties: true })
    const functions = fnMod.getFunctions(app, settings.functionsRegion || 'us-central1')
    if (settings.emulators) {
      const host = typeof location === 'undefined' ? '127.0.0.1' : location.hostname
      authMod.connectAuthEmulator(auth, `http://${host}:${EMULATOR_PORTS.auth}`, { disableWarnings: true })
      fsMod.connectFirestoreEmulator(db, host, EMULATOR_PORTS.firestore)
      fnMod.connectFunctionsEmulator(functions, host, EMULATOR_PORTS.functions)
    }
    return { app, auth, db, functions, settings }
  })()
  cached.catch(() => {
    cached = null
  })
  return cached
}

let userPromise: Promise<User> | null = null

/**
 * The signed-in user, signing in anonymously the first time. Every caller
 * shares one sign-in: two components asking at once must not create two
 * anonymous accounts, or a player would take a seat as one and watch as the
 * other.
 */
export function ensureUser(): Promise<User> {
  if (userPromise) return userPromise
  userPromise = (async () => {
    const { auth } = await getFirebase()
    const { onAuthStateChanged, signInAnonymously } = await import('firebase/auth')
    // Wait for any saved session to load before deciding to sign in afresh.
    await auth.authStateReady()
    const existing = auth.currentUser ?? (await new Promise<User | null>((resolve) => {
      const stop = onAuthStateChanged(auth, (user) => {
        stop()
        resolve(user)
      })
    }))
    if (existing) return existing
    return (await signInAnonymously(auth)).user
  })()
  userPromise.catch(() => {
    userPromise = null
  })
  return userPromise
}

/** Link or switch to a Google account, so games follow you across devices. */
export async function signInWithGoogle(): Promise<User> {
  const { auth } = await getFirebase()
  const { GoogleAuthProvider, linkWithPopup, signInWithPopup } = await import('firebase/auth')
  const provider = new GoogleAuthProvider()
  const current = auth.currentUser
  let user: User | null = null
  if (current?.isAnonymous) {
    try {
      user = (await linkWithPopup(current, provider)).user
    } catch (error) {
      // Already linked elsewhere: sign in to that account instead.
      if ((error as { code?: string }).code !== 'auth/credential-already-in-use') throw error
    }
  }
  user ??= (await signInWithPopup(auth, provider)).user
  userPromise = Promise.resolve(user)
  return user
}

export async function signOut() {
  const { auth } = await getFirebase()
  const { signOut: out } = await import('firebase/auth')
  await out(auth)
  userPromise = null
}
