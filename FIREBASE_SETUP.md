# Online play: Firebase setup

The **Play online** tab runs full games of Catan — base game from 1v1 to eight
players, Seafarers scenarios, Cities & Knights, Fishermen and the custom modes —
between browsers, using a Firebase project that you own. This guide takes you
from nothing to a working deployment, then covers local development, the
optional server referee, costs and troubleshooting.

Local games (you against bots, or pass-and-play on one device) work without any
of this.

**Contents**

1. [How it works](#1-how-it-works)
2. [What you need](#2-what-you-need)
3. [Create the Firebase project](#3-create-the-firebase-project)
4. [Turn on sign-in](#4-turn-on-sign-in)
5. [Create the Firestore database](#5-create-the-firestore-database)
6. [Deploy the security rules and indexes](#6-deploy-the-security-rules-and-indexes)
7. [Point the site at your project](#7-point-the-site-at-your-project)
8. [Publish on GitHub Pages](#8-publish-on-github-pages)
9. [Optional: the server referee (Cloud Functions)](#9-optional-the-server-referee-cloud-functions)
10. [Optional: Firebase Hosting instead of GitHub Pages](#10-optional-firebase-hosting-instead-of-github-pages)
11. [Local development with the emulators](#11-local-development-with-the-emulators)
12. [Data model and security](#12-data-model-and-security)
13. [Costs and limits](#13-costs-and-limits)
14. [Troubleshooting](#14-troubleshooting)
15. [Maintenance](#15-maintenance)

---

## 1. How it works

All the rules live in one pure TypeScript engine, [`src/game/engine/`](src/game/engine/).
Given a game state and an action, it returns the next state or refuses with a
reason. The browser, the Cloud Function and the test suite all run the same
engine, so they always agree on the rules.

Firebase provides three things:

| Service | Used for |
| --- | --- |
| **Authentication** | Anonymous sign-in (no accounts needed), plus optional Google sign-in so your games follow you across devices. |
| **Cloud Firestore** | The lobby, each game's state, the move log (for replays) and table chat, all synced live to every player. |
| **Cloud Functions** *(optional)* | A server referee that hides every player's cards from the others. |

There are two ways to referee a game. You choose one for the whole site with
`VITE_FIREBASE_AUTHORITY`, and each game records which one it uses.

| | **Client authority** (default) | **Server authority** |
| --- | --- | --- |
| Firebase plan | Spark (free) | Blaze (pay-as-you-go; typically still free in practice) |
| Who applies the rules | The acting player's browser, inside a Firestore transaction | The `act` Cloud Function |
| Dice and shuffles | Rolled by the acting browser | Rolled on the server |
| Can players see each other's hands? | Only by poking at Firestore with dev tools; the UI never shows them | No: each seat receives only its own redacted view |
| Bots | Played by the browsers at the table (the host's first) | Played on the server, instantly |
| Best for | Friends, family, casual tables | Strangers, public tables, anything competitive |

Under client authority, the security rules still make sure only seated players
can move a game on, only one version at a time, so two players acting at once
can't overwrite each other. What they can't stop is a player who deliberately
tampers with their own browser. That's the trade-off for needing no server.

## 2. What you need

- A Google account.
- **Node.js 22 or newer** and npm (`node --version`).
- The **Firebase CLI**: `npm install -g firebase-tools`, then `firebase login`.
- **Java 21 or newer**, only for the local emulators in step 11 (`java -version`).
- This repository, with `npm install` run at the root.

## 3. Create the Firebase project

1. Go to <https://console.firebase.google.com> and choose **Create a project**.
   Any name works, for example `catan-online`. Note the **project ID** it gives
   you (`catan-online-1a2b3`); you'll need it below.
2. Google Analytics isn't needed. You can switch it off.
3. Once the project exists, open **Project settings** (the gear icon) →
   **General** → **Your apps** and click the **Web** icon (`</>`).
4. Give the app a nickname (for example `catan-web`). Leave *Firebase Hosting*
   unticked unless you plan to follow step 10. Click **Register app**.
5. Firebase shows a `firebaseConfig` object like this. Keep this page open; you'll
   copy these values in step 7.

   ```js
   const firebaseConfig = {
     apiKey: "AIza…",
     authDomain: "catan-online-1a2b3.firebaseapp.com",
     projectId: "catan-online-1a2b3",
     storageBucket: "catan-online-1a2b3.firebasestorage.app",
     messagingSenderId: "1234567890",
     appId: "1:1234567890:web:abc123"
   };
   ```

   These values aren't secrets. They identify the project, and the security
   rules are what protect it. It's fine for them to end up in the built site.

6. Link the repository to the project, from the repository root:

   ```bash
   firebase use --add        # pick the project, give it the alias "default"
   ```

   This writes `.firebaserc`. Commit it if you like.

## 4. Turn on sign-in

In the console, open **Build → Authentication → Get started**.

1. **Sign-in method → Add new provider → Anonymous → Enable → Save.**
   This is required: every player is signed in anonymously the first time they
   open the Play tab.
2. *(Optional)* **Add new provider → Google → Enable**, choose a support email,
   and **Save**. This adds "Sign in with Google to play across devices" to the
   lobby, which links a player's anonymous account to their Google account so
   their games carry over.
3. **Settings → Authorized domains → Add domain**, and add every domain the site
   is served from:
   - `localhost` is there by default (for `npm run dev`);
   - for GitHub Pages, add `<your-github-username>.github.io`, for example
     `martin-he543.github.io`;
   - add any custom domain you use.

   Anonymous sign-in works on any domain. Google sign-in only works on these.

## 5. Create the Firestore database

1. Open **Build → Firestore Database → Create database**.
2. Choose the **Standard edition**. Pick a **location** near your players
   (`eur3` or `europe-west2` for the UK, `nam5` for North America); it can't be
   changed later.
3. Choose **Start in production mode**. The next step replaces those rules with
   the game's own.

## 6. Deploy the security rules and indexes

From the repository root:

```bash
npm run deploy:rules
```

This runs `firebase deploy --only firestore`, which uploads:

- [`firestore.rules`](firestore.rules): who may create, join, play and read
  games (explained in section 12);
- [`firestore.indexes.json`](firestore.indexes.json): the composite indexes
  behind "Your games", "Open tables" and the server's timeout sweep. It also
  turns off indexing on the large JSON fields, which keeps every move's write
  cheap.

Indexes take a few minutes to build the first time. Until then, the lobby lists
may show *"The query requires an index"*. That goes away once they're ready,
which you can check under **Firestore → Indexes**.

Run `npm run deploy:rules` again whenever you change either file.

## 7. Point the site at your project

### For local development

Copy the template and fill it in from the `firebaseConfig` in step 3:

```bash
cp .env.example .env.local
```

```ini
VITE_FIREBASE_API_KEY=AIza…
VITE_FIREBASE_AUTH_DOMAIN=catan-online-1a2b3.firebaseapp.com
VITE_FIREBASE_PROJECT_ID=catan-online-1a2b3
VITE_FIREBASE_APP_ID=1:1234567890:web:abc123
VITE_FIREBASE_STORAGE_BUCKET=catan-online-1a2b3.firebasestorage.app
VITE_FIREBASE_MESSAGING_SENDER_ID=1234567890
VITE_FIREBASE_AUTHORITY=client
```

`.env.local` is git-ignored. Then:

```bash
npm run dev
```

Open <http://localhost:9121/play>. The lobby should say *Connected to
catan-online-1a2b3*. Create a table, copy the invite link, and open it in a
private window to join as a second player.

### Without rebuilding: paste the config into the page

If the site was built without Firebase settings, the Play tab shows a **Set up
online play** box. Paste the whole `firebaseConfig` snippet there (JSON or the
JavaScript as shown), choose the referee and press **Connect**. The settings are
saved in that browser's localStorage. This is handy for a quick test, but every
player's browser would need the same paste, so use build settings for real use.

## 8. Publish on GitHub Pages

The existing workflow, [`.github/workflows/deploy.yml`](.github/workflows/deploy.yml),
already builds and publishes the site on every push to `main`. It reads the
Firebase settings from the repository's **Actions variables**:

1. On GitHub, open the repository → **Settings → Secrets and variables → Actions
   → Variables** tab → **New repository variable**.
2. Add each of these, with the values from step 3:

   | Variable | Example |
   | --- | --- |
   | `VITE_FIREBASE_API_KEY` | `AIza…` |
   | `VITE_FIREBASE_AUTH_DOMAIN` | `catan-online-1a2b3.firebaseapp.com` |
   | `VITE_FIREBASE_PROJECT_ID` | `catan-online-1a2b3` |
   | `VITE_FIREBASE_APP_ID` | `1:1234567890:web:abc123` |
   | `VITE_FIREBASE_STORAGE_BUCKET` | `catan-online-1a2b3.firebasestorage.app` |
   | `VITE_FIREBASE_MESSAGING_SENDER_ID` | `1234567890` |
   | `VITE_FIREBASE_AUTHORITY` | `client` (or `server`, after step 9) |
   | `VITE_FIREBASE_FUNCTIONS_REGION` | only if your functions aren't in `us-central1` |

   Variables rather than secrets is deliberate: the values are public in the
   built JavaScript anyway, and variables are easier to check and edit.
3. If Pages isn't on yet: **Settings → Pages → Build and deployment → Source:
   GitHub Actions**.
4. Push to `main`, or re-run the workflow from the **Actions** tab.
5. Make sure your Pages domain is in **Authorized domains** (step 4.3).

Invite links look like `https://martin-he543.github.io/catan/play/g/K7QX2M`.
The site's `404.html` bounces deep links back through the app, so they work
even though GitHub Pages has no rewrite rules.

## 9. Optional: the server referee (Cloud Functions)

With server authority, every action goes to a Cloud Function. The function
checks it with the engine, rolls the dice itself, plays the bots, and writes
each player a view with everyone else's cards removed. Nobody can see another
hand, peek under the fog or choose their own dice.

### 9.1 Upgrade to Blaze

Cloud Functions need the **Blaze (pay-as-you-go)** plan: **Console → ⚙ → Usage
and billing → Details & settings → Modify plan**. Blaze keeps the same free
allowances as Spark (2 million function calls a month, and so on). A few
friends' games stay well inside them; see section 13.

Set a budget alert while you're there, under **Usage and billing → Budgets &
alerts** in the Google Cloud console. £5 is plenty to catch surprises.

### 9.2 Deploy the functions

```bash
npm --prefix functions install      # once
npm run deploy:firebase             # builds functions/ and deploys rules, indexes and functions
```

[`functions/src/index.ts`](functions/src/index.ts) is bundled with esbuild,
engine included, into `functions/lib/index.js`, and deploys three functions:

| Function | What it does |
| --- | --- |
| `startGame` (callable) | The host starts a game: the board and decks are dealt on the server and kept in `games/{code}/secret`. |
| `act` (callable) | A player's action: checked, applied, bots played, views written. |
| `sweepTimeouts` (every 5 minutes) | Plays on autopilot for anyone whose turn timer ran out while nobody at the table was looking. Uses Cloud Scheduler, which the first deploy may ask you to allow. |

They run in `us-central1` by default. To change that, create `functions/.env`
containing `CATAN_REGION=europe-west1`, redeploy, and set
`VITE_FIREBASE_FUNCTIONS_REGION=europe-west1` for the site.

The first deploy may ask you to enable several Google Cloud APIs (Cloud
Functions, Cloud Build, Artifact Registry, Cloud Run, Eventarc, Cloud
Scheduler). Say yes.

### 9.3 Switch the site over

Set `VITE_FIREBASE_AUTHORITY=server` in `.env.local` and in the GitHub Actions
variables, then rebuild or redeploy. New tables use the server referee. Games
already in progress keep the referee they started with.

## 10. Optional: Firebase Hosting instead of GitHub Pages

[`firebase.json`](firebase.json) already has a Hosting configuration that
serves `dist/` with a single-page-app rewrite. Build with the site at the
domain root, then deploy:

```bash
VITE_BASE=/ npm run build
firebase deploy --only hosting
```

The site is then at `https://<project-id>.web.app`. That domain is authorized
for sign-in automatically.

## 11. Local development with the emulators

The Firebase emulator suite runs Auth, Firestore and Functions on your machine,
with no project and no bill. It needs **Java 21+**.

```bash
npm --prefix functions install     # once, for the Functions emulator
npm run emulators                  # starts them under the demo project "demo-catan"
```

In another terminal, make a `.env.local` that points at them:

```ini
VITE_FIREBASE_API_KEY=demo-key
VITE_FIREBASE_PROJECT_ID=demo-catan
VITE_FIREBASE_APP_ID=demo-app
VITE_FIREBASE_EMULATORS=true
VITE_FIREBASE_AUTHORITY=client     # or server, to exercise the functions
```

Then run `npm run dev`. The emulator UI at <http://127.0.0.1:4100> shows the
games, users and function logs as you play.

This project uses its own emulator ports, so it won't collide with other
Firebase projects on the same machine:

| Emulator | Port |
| --- | --- |
| Auth | 9199 |
| Firestore | 8180 |
| Functions | 5101 |
| Hosting | 5100 |
| Emulator UI | 4100 |

They're set in `firebase.json` and mirrored in `EMULATOR_PORTS` in
[`src/game/net/firebase.ts`](src/game/net/firebase.ts). Change both together.

### The test suites

```bash
npm test                 # the rules engine: every mode played to a finish by bots, and rule-by-rule tests
npm run test:emulators   # starts the emulators, then plays real online games through them
```

`test:emulators` covers the whole online stack: two players and a bot play 150
moves of a browser-refereed game; the security rules are probed directly
(skipping versions, taking over the host, strangers writing, strangers
chatting); and a Cities & Knights game runs through the Cloud Functions,
checking that nobody can read the secret state or another player's view.

## 12. Data model and security

```
games/{code}                  lobby + game (code is 6 characters, no 0/O/1/I)
  code, hostUid, status (lobby | playing | ended), visibility (public | private)
  authority (client | server), mode, title, config
  seats[]     { uid | null, name, color, bot }
  seatUids[]  uid per seat, '' for open seats and bots
  seq         version number, +1 per action
  setup       JSON of a fixed board / starting position, if brought from another page
  state       client authority: the full game state as JSON
  view        server authority: the spectator's view as JSON
  turnSeat, waiting[], winner, deadline, createdAt, updatedAt

games/{code}/log/{seq}        every action with the random numbers it used (replays)
games/{code}/log/0            the starting state
games/{code}/chat/{id}        table talk
games/{code}/views/{uid}      server authority: that player's redacted view
games/{code}/secret/state     server authority: the full state (no client access)
games/{code}/secret/initial   server authority: the dealt start (published to log/0 at the end)
```

Game states are stored as JSON strings: Firestore can't hold nested arrays, and
a single string keeps the rules simple and the writes cheap. A typical state is
20–80 KB; the rules cap it at 900 KB, under Firestore's 1 MiB document limit.

What [`firestore.rules`](firestore.rules) enforces:

- You must be signed in (anonymously is fine) to read or write anything.
- **Creating** a game: you must be its host and sit in seat 1; it must start in
  the lobby at version 0, with 2–8 seats, and carry no state.
- **In the lobby**, the host can change anything. Anyone can take an open seat
  or leave their own, but can't add or remove seats.
- **Client authority, while playing**: only seated players may write; only the
  game fields may change; `seq` must go up by exactly one; the state must be a
  string under the size cap. The code, host and referee can never change.
- **Server authority, while playing**: clients can't write the game at all.
  Only the Cloud Functions (which bypass the rules) can.
- **Log**: entries are written in the same transaction as the move they record,
  numbered by the new version. Server-refereed logs stay closed until the game
  ends, because actions like discards reveal hidden cards.
- **Chat**: seated players only, 300 characters at most, and messages can't be
  edited.
- **Views** are readable only by their own player. **Secret** is closed to
  everyone.

## 13. Costs and limits

Every action is one Firestore transaction. Here is what it costs:

| | Client authority | Server authority |
| --- | --- | --- |
| Writes per action | 2 (game + log) | 3 + one per human seat (secret, public, log, views) |
| Reads per action | 1, plus 1 per player watching | 2 in the function, plus 1 per player watching |
| Function calls | none | 1 per human action (bots are free) |

A four-player game runs to roughly 500–1,000 actions. That makes about
2,000 writes and 4,000 reads under client authority, so the **free Spark
allowance (20,000 writes and 50,000 reads a day)** covers around ten full games
a day. Under server authority on Blaze, the same game is about 6,000 writes,
roughly two cents beyond the free tier.

Storage is tiny: a finished game with its full log is well under 1 MB.

## 14. Troubleshooting

| Symptom | Fix |
| --- | --- |
| *Firebase: Error (auth/operation-not-allowed)* | Anonymous sign-in isn't enabled: step 4.1. |
| *Firebase: Error (auth/unauthorized-domain)* when signing in with Google | Add the site's domain under Authentication → Settings → Authorized domains. |
| *Missing or insufficient permissions* | The rules aren't deployed, or are out of date: `npm run deploy:rules`. Or you're acting in a game you aren't seated in. |
| *The query requires an index* in the lobby | Indexes are still building (a few minutes after step 6), or weren't deployed. |
| Lobby says Firebase is not configured, on GitHub Pages | The Actions variables weren't set when the site was built. Set them (step 8), then re-run the workflow. |
| Starting a server-refereed game fails with *not-found* or *internal* | The functions aren't deployed, or are in a different region from `VITE_FIREBASE_FUNCTIONS_REGION`. |
| Bots don't move (client authority) | Bots are played by the browsers of the seated humans, so at least one person at the table must have the game open. |
| Turn timer ran out and nothing happened | Under client authority, time is called by a seated player's open browser. Under server authority, the sweep runs every five minutes. |
| A *Firebase Hosting Setup Complete* page instead of the app | `firebase init hosting` was run over the project and wrote a placeholder `index.html`. Don't re-run it — `firebase.json` is already set up. `git checkout firebase.json`, delete the placeholder (`public/index.html` or `dist/index.html`), and `npm run build`. The dev server and build refuse to start while it's there. |
| `firebase-tools no longer supports Java version before 21` | Install JDK 21+ and point `JAVA_HOME` at it (emulators only). |
| *Port … is not open* when starting emulators | Something else is using that port. Change it in `firebase.json` and `EMULATOR_PORTS` together. |
| Pasted a new `firebaseConfig` but the page still uses the old project | Build variables take precedence over a pasted config. Change the variables and rebuild, or build without them. **Disconnect this browser** in the lobby clears a pasted config. |

## 15. Maintenance

- **Old games.** Finished and abandoned tables stay in Firestore until deleted.
  The host can close a lobby or finished table from the game page. To tidy up
  in bulk, delete old `games` documents in the console. Or add a `expireAt`
  timestamp field and a Firestore TTL policy on it, under **Firestore → TTL**.
- **Changing the rules engine.** Games store their state, not the code that
  made it. Engine changes apply to games in progress from their next move, and
  replays of older games stop wherever a recorded move no longer fits the new
  rules.
- **Rotating the web API key** is never necessary for security. It isn't a
  secret, and the rules are what protect the data.
