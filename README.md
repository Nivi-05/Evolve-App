# RESET/66 — working PWA build

## Run it locally
Service workers and some storage APIs require a real HTTP origin (not
`file://`). From this folder, run any static server, e.g.:

```
npx serve .
```
or
```
python3 -m http.server 8080
```

Then open the printed URL on your phone (same Wi-Fi) or in a desktop
browser's mobile device emulation. On an iPhone/Android, open it in the
browser, then "Add to Home Screen" to install it as a standalone app.

## Deploying with Google Drive backup working
Google Drive backup needs serverless functions (`netlify/functions/`), and
**Netlify Drop (drag-and-drop) does not run functions** — it only publishes
static files. Use the Netlify CLI instead:

```
npm install -g netlify-cli
cd reset66-app
npm install                # installs @netlify/blobs for the functions
netlify login
netlify link                # connect to your existing gleaming-semolina-... site
netlify deploy --prod
```

Before deploying, set these two environment variables in your Netlify
site (Project configuration → Environment variables) — not in any file in
this folder:
- `GOOGLE_CLIENT_ID`
- `GOOGLE_CLIENT_SECRET`

And in Google Cloud Console, the OAuth client's Authorized redirect URI
must be exactly:
```
https://<your-site>.netlify.app/.netlify/functions/auth-callback
```

Once deployed, Settings → Backup will show a real "Connect Google Drive"
button. It creates a private "RESET66 Backup" folder (via the narrow
`drive.file` scope — RESET/66 can only see files it creates, nothing else
in your Drive) and backs up your structured data (habits, journal text,
mood, XP, rewards) as JSON on demand via "Back up now."

**Not included in this pass:** photo/voice media backup to Drive (only
structured data is backed up right now — media stays local-only). Adding
it means a second endpoint that streams blobs instead of JSON; the
`ensureBackupFolder` helper in `netlify/functions/lib/drive.js` already
does the folder logic that endpoint would reuse.

## What's real vs. what's an intentional integration boundary
- **Habits, categories, completion, XP, streaks, rewards, journal text,
  mood, photos, Journey, Stats** — fully working, persisted to IndexedDB,
  survives closing the app/browser/device restart.
- **Voice recording** — real, uses MediaRecorder + getUserMedia with a live
  waveform from the Web Audio API. If the browser doesn't support it, the
  app says so honestly instead of faking it.
- **Voice-to-text transcription** and **AI daily summary** — the complete
  UI/state machine is real and wired up (Transcribing.../Reading back
  through today... states, editable results, separate storage from the
  original audio), but no AI provider is connected. Both honestly report
  "not connected yet" rather than faking a result. Wire a real endpoint by
  setting `transcriptionProviderConfigured` / `aiProviderConfigured` to
  `true` in Settings' stored config and filling in the actual API call at
  the two marked "Integration boundary" comments in `app.js`.
- **Google Drive backup** — real, working end to end: OAuth via serverless
  Netlify Functions (`netlify/functions/`), narrow `drive.file` scope,
  tokens stored server-side in Netlify Blobs (never exposed to the
  browser), automatic token refresh, idempotent backup (updates the same
  file rather than creating duplicates). Verified with 25 automated checks
  against the real function code (mocking only Google's network endpoints,
  which aren't reachable from this build environment) — see "Automated
  tests" below. Requires deploying via Netlify CLI, not Netlify Drop; see
  "Deploying with Google Drive backup working" above.

## Testing the Day 66 → Chapter 2 transition without waiting 66 days
Settings (gear icon, top right) → **Developer / QA tools** → "Jump to Day
66" / "Jump to Day 67" / "+1 day" / "Reset to real date". This shifts a
local clock offset only — the day-number math itself is never
special-cased, which is exactly what the automated tests below verify.

## Automated tests run before delivery
Two Node-based test suites actually executed the real `db.js`/`app.js`
files (via `fake-indexeddb` and `jsdom`, simulating a browser) rather than
just being eyeballed:
- Core logic: day/chapter math, XP award/undo idempotency, streaks,
  soft-delete history preservation, reward redemption + overspend blocking.
- Full-app smoke test: clicking through Add Habit, completion, category
  expand/collapse, all 5 nav tabs, mood slider, journal autosave, the
  honest AI-unavailable state, and a full Day 66 → 67 walkthrough
  confirming XP/habits/history are unchanged across the milestone.
- A separate persistence test closes the simulated app entirely and
  reopens it in a fresh window to confirm data survives (not just
  in-memory state).

All of the above passed. What automated testing in this environment
*can't* cover: real device camera/mic permission prompts, actual Add-to-
Home-Screen install flow, and real network sync — those need a real phone
browser to verify, which the run instructions above set you up for.
