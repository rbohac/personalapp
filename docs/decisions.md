# Decisions

Why Bo is shaped the way it is. Add to the end; don't rewrite an entry —
supersede it with a new one that says what changed and why.

## 2026-10-30 — Phase 1 foundations

- **A backend from day one.** Server push, backups of health data and future
  integrations (webhooks, Home Assistant) all need one. Reminders alone would
  not.
- **.NET 10 minimal API in a Docker container on Fly.io**, not Next.js on
  Vercel. Later phases hold long-lived connections (Home Assistant's
  WebSocket API, MQTT) that serverless functions can't keep open. One
  always-on 512 MB machine; scale-to-zero would drop those connections.
- **Neon for Postgres**, separate from the host, so moving the container
  later doesn't move the data.
- **Dapper + plain-SQL migrations (DbUp)** rather than EF Core. The schema is
  readable SQL, migrations can be written and reviewed without tooling, and
  they apply at startup. Files are append-only; never edit a shipped one.
- **Google Sign-In → Bo's own token.** The phone gets a Google ID token
  natively; the API checks it against the iOS client id and a one-address
  allowlist (`Auth:AllowedEmails`) and issues a 60-day JWT stored in the iOS
  keychain. Every table carries `user_id`, so more users later is a sign-in
  change, not a data migration.
- **The API is the contract.** It publishes OpenAPI; the app's types are
  generated from it (`npm run api:types`) and called through `openapi-fetch`.
- **Reminders ring from the phone.** A task stores `remindAt`; the app keeps
  one local notification per task (`task-<id>`) and re-derives the whole set
  on every list refresh. Snooze times ("this evening", "tomorrow morning") are
  decided in the phone's own time zone.
- **Server push is registered, not yet sent.** Devices register their Expo
  push token at sign-in; the first server feature that needs to ring the
  phone adds the sender.
- **Names:** app **Bo**, bundle id `dev.bohac.bo`, scheme `bo://`, API at
  `api.bohac.dev`. The bundle id is the one name that can't change later.
- **Separate Expo account; same Apple Developer team as Spearfish.**

## Next up (not built)

- Schedules and adherence ("did I do it when I meant to?"), derived from
  entries and never stored.
- An offline outbox for writes made without signal.
- Apple Health: write BP readings, read workouts and walks.
- Integrations: inbound webhooks, Home Assistant over Tailscale.

## 2026-10-30 — First run

- **The API was compiled and run end to end** against a local Postgres:
  migrations applied, every endpoint exercised, and `lib/api-schema.d.ts`
  regenerated from the live `/openapi/v1.json`. The regeneration immediately
  caught a contract mismatch (optional `TaskInput` fields were required),
  fixed in the API with parameter defaults — the reason the client is
  generated rather than written.
- **TypeScript is pinned to 5.9 in `mobile/`.** `openapi-typescript` calls the
  TypeScript compiler API, which TypeScript 7 (the native compiler) doesn't
  expose. Revisit when openapi-typescript supports 7.
- **Packages moved to current versions** (Npgsql 10, DbUp 7, ASP.NET 10.0.14)
  — the first pins pulled a `Microsoft.OpenApi` with a known vulnerability.

## 2026-10-30 — Areas and capture

- **An area is a folder** (`areas/<id>/area.json` + `README.md`), not a table
  or a class. The folder is the one definition: the API validates and
  summarizes from it, the app builds forms from it, the parser reads it. A new
  area is two files and a deploy.
- **Entries are JSON documents in Postgres** (`entries.data`, one row each),
  not JSON files on disk. Files on a Fly volume would need their own backups
  and would tie the API to one machine; a jsonb column keeps the "JSON
  document" shape with Neon's backups and point-in-time restore. Small data
  sets, so no per-area tables. If an area outgrows that, it gets a table.
- **Tasks stay tasks**, with a `list` column (personal, home, cranberry). The
  tasks area declares the lists. A task needs reminders, completion and
  editing that entries don't, so it isn't an entry.
- **Capture proposes, the person saves.** `POST /capture` writes nothing;
  saving goes through the ordinary entry and task endpoints. A misheard number
  never lands without being seen.
- **The model reads the area READMEs.** Claude (`claude-opus-5-5` at low
  effort, structured output) returns `{area, at, fields[], task}` per thing
  mentioned. Values come back as strings and are validated like hand-entered
  ones, so the schema stays the same for every area. The newest entry in each
  area goes along too, so "took my shot" can reuse the last medication. A
  refusal falls back server-side to `claude-opus-4-8`.
- **Patterns are the fallback, not the first pass.** A regex reads "131/85"
  but loses "this morning" and "left arm", so `area.json` patterns run only
  when the model isn't configured or can't be reached.
- **Voice is on-device** (`expo-speech-recognition`). The API only ever sees
  text, and the same capture path serves typed and spoken input.
- **Shots record supply too** (`event`: taken, ran-out, refilled). That reads
  "when I took them, when I'm out" as running out of supply.

## 2026-10-31 — Capture runs on Haiku

Supersedes the model line of "Areas and capture" above.

- **`claude-haiku-5-5` at `medium` effort**, set by `Capture:Model` and
  `Capture:Effort`. A capture is short extraction against fixed rules, which
  is what the Haiku line is for, at about a twentieth of a cent each. Medium
  is Haiku's default and Anthropic's recommended level where instructions
  must be followed exactly; the guides' "never invent a number" is that kind
  of rule. Drop to `low` for speed only if captures stay accurate.
- **No server-side fallback.** Haiku 5.5 has none and rejects a fallback
  list, so the request is the plain (non-beta) Messages API. A decline, or
  running out of room, falls back to the area patterns and says so.
- **Consistency comes from examples and the schema**, not sampling settings
  (Haiku 5.5 rejects `temperature`). `_capture.md` ends with six worked
  examples — input and exact JSON — covering several things in one sentence,
  a time of day, a reused medication, a task with a list and reminder, a
  half reading, and nothing to log.
- **No prompt caching yet.** The area guides are a stable ~2k-token prefix
  that could be cached, but personal captures are minutes or hours apart, so
  a 5-minute cache would mostly miss and add the write cost. Revisit if
  captures come in bursts.

## 2026-11-01 — AI usage, cost and logs

- **Two tables, two lifetimes.** `ai_usage` is one row per model call (or
  skipped call) with tokens, cost, latency and outcome, kept forever so spend
  can be charted across months. `ai_logs` holds the words (what was said, the
  per-call message sent, the raw answer, the proposals) and is deleted after
  `Ai:LogRetentionDays` (30) by a background job in the API. The owner chose
  30 days for the words and to keep cost indefinitely.
- **Provider-neutral.** Every model call goes through `IModelClient`
  (`api/Bo.Api/Ai/`). Anthropic is the one implementation; OpenAI or a local
  model is another class plus an entry in `Ai:Prices`, keyed
  `provider/model`. The tables store provider and model as plain text.
- **Cost is computed, and unknown is not free.** Prices per million tokens
  live in `appsettings.json` (`Ai:Prices`). A model missing from the table
  records a null cost, shown as "unknown", so a missing price can't make spend
  look lower than it is. A call that never reached a model records $0.
- **Budget guardrail.** `Ai:MonthlyBudgetUsd` (default $5, overridable with
  the `Ai__MonthlyBudgetUsd` Fly secret). Past it, captures fall back to the
  area patterns and say why. The month is the user's calendar month. Pair it
  with a spend limit in the Anthropic Console, which holds even if Bo has a
  bug.
- **Kept vs discarded.** Entries and tasks saved from a capture carry
  `ai_usage_id`, so the usage screen shows how many proposals were kept.
- **Charts are plain React Native views,** so the feature ships over the
  air; no chart library (a native dependency) was added. The bar colour,
  `#E8553A`, is a deeper coral that passes the 3:1 contrast check on both
  themes, where the brand coral is too light on white.
- **Not built yet:** a "this was wrong" button that saves a capture as a new
  worked example. The owner will ask for it if misreads become common.

## 2026-11-02 — Expected words for speech

- **The recognizer is told which words to expect,** rather than fixing the
  text afterwards. `areas/_vocabulary.json` is served at `GET /vocabulary`,
  and the app passes the terms to iOS speech recognition as
  `contextualStrings`. The word appears correctly while you speak; nothing is
  replaced after the fact. JS-only, so it ships over the air.
- **One list, in the repo,** beside the areas, so later steps (sound-alike
  matching on the server, the parser's prompt) read the same words. Each term
  can carry `heard`: known mishearings, recorded now for that later matching.
- **On-phone vs Apple's servers is a setting** (Settings › Voice), default
  on-phone. Apple's server recognizer may honour the list more strongly; the
  switch lets the owner compare before we decide anything.

## 2026-11-02 — The word list is edited on the phone

- **Each person's list lives in Postgres** (`vocabulary_terms`, migration
  0004), with add/edit/delete at `/vocabulary`. `areas/_vocabulary.json`
  became the starter list: it's copied in once, the first time the list is
  read (`users.vocabulary_seeded`), so deleting a starter word on the phone
  sticks. Copying once beats merging the file with per-person overrides on
  every read, which would have needed "hidden" rows to delete a starter.
- **Capped at 100 words**, Apple's guidance for expected words. Mishearings
  (`heard`) are stored lowercased, up to 10 per word, for the sound-alike
  matching that comes next.

## 2026-11-02 — Schedules and nudges (step 1)

- **Done means an entry was logged.** A schedule names an area and, if it
  needs to, text the medication must contain ("tirzepatide"). Saying "took my
  tirzepatide shot" ticks it off; the Done button logs the same entry. No
  separate done flag that could disagree with the history.
- **Every-N-days schedules are counted from the last dose.** A Monday shot
  taken Tuesday makes the next one due Tuesday, and the app says so twice: a
  push ("Tirzepatide moved to Tuesdays") and a banner on Today with *Keep
  Mondays* or *Tuesdays are fine*. Keeping goes to the first planned day after
  the dose.
- **Nudges are server pushes** (Expo), sent by a background job every five
  minutes: at the due time, one follow-up two hours later, the snoozed one
  when *In 1 hour* runs out (it replaces the follow-up), and the cadence note.
  Never in quiet hours (22:00–07:30 local, stored per person, not on a screen
  yet). `schedule_nudges` records each push before it's sent, so nothing goes
  twice. The phone reports its time zone; without one, no nudges.
- **Morning meds is one schedule with a list** of what to take, no
  checkboxes. It counts any medications entry that day, so "took my morning
  meds" and "took my Vyvanse and vitamins" both tick it off. Skipping Vyvanse
  is said in the entry, not tracked.
- **Kept simple on purpose:** no versioned history of schedule changes yet,
  no adherence screens, no weekly goals. Goals (walk days and miles, lifting
  days) are step 2.

## 2026-11-02 — Daily lists are ticked item by item

- **This reverses "no checkboxes"** from the morning, at the owner's ask:
  each item on a daily list is a button on Today. Tap = taken (logs a
  medications entry for that item, so the history is the same as saying
  it); tap again = untick (removes that entry). Hold = Skip today, or Remind
  me later.
- **Done when nothing is left open:** every item taken, skipped, or put off.
  "Took all" (the button, or the push's button) ticks whatever is open.
- **Saying it still counts.** An entry logged today that names an item
  ("vitamin D 2000 IU" for "Vitamin D") ticks it; one that names the whole
  list ("took my morning meds" — the schedule's match text) ticks all.
- **Putting one off** (the blood pressure pill before a flight): Remind me
  later asks when — in 1, 2 or 4 hours, 6 PM, or a picked time — and a push
  "Time to take …" rings then, with *Took it* / *In 1 hour*. Quiet hours don't
  apply to a time chosen on purpose.
- **Not taken yet is noticed:** the two-hour follow-up names what's left
  ("Not taken yet: Lisinopril-HCTZ") and opening it asks when to remind.
- Ticks live in `schedule_marks` (migration 0006), one row per item per day.

## 2026-11-02 — Weekly goals (step 2)

- **A goal is a rule over a week of entries,** worked out on every read and
  never stored as met: days with an entry, or the total of a number field,
  against a target. Weeks run Monday–Sunday in the person's time zone. A
  logged skip (`done: false`) doesn't count.
- **Starters** (`areas/_goals.json`, copied in once, targets are guesses to
  adjust): walk days ≥ 4, walking distance ≥ 10 mi, lifting days ≥ 3.
  "Lifting" is any workout whose type doesn't contain run or walk — an
  exclude list on the goal, editable, so it can evolve without code.
- **Two pushes a week,** once each (`goal_nudges`): Thursday 6 PM if anything
  is behind, Sunday 6 PM with how the week went. Fixed times for now.
- **Shown on Today** under the schedules: a bar per goal, the week so far,
  and last week's number. No history screens yet.

## 2026-11-02 — Shot sites alternate

- **A schedule can carry a rotation** of sites (testosterone: left thigh,
  right thigh; tirzepatide: left belly, right belly). The next site is the
  one after the newest dose that logged a site in the rotation, read from
  the entries — nothing to keep in step by hand. A dose logged with no side
  doesn't move it.
- **Saying a bare side is enough.** The shots guide tells the parser that
  "left"/"right" means that shot's usual spot, and to leave the site empty
  rather than guess when no side is said.
- **The reminder says the side** ("Right thigh this time"), Today shows
  "Next: …", and Done from the app or the push logs the side that was due.
- Migration 0008 adds `schedules.rotation` and sets it on the two starter
  shot schedules.

## 2026-11-02 — Push is visible from the phone

- The first 8 AM nudge didn't arrive and nothing could say why. Every server
  push now writes a `push_log` row (migration 0009) with what happened:
  no phone registered, Expo refused it, sent, then delivered or failed once
  Expo's receipt says what Apple did (bad credentials only show up there).
  The nudger checks receipts every run; rows are kept 30 days.
- Settings › Notifications shows the time zone the server uses, the phones
  registered (and whether this one is), the recent pushes with their
  outcome, and **Send a test push from the server**, which waits for the
  receipt and reports it.
- The nudger no longer skips people with no phone registered: it attempts,
  and the log says "No phone registered" instead of saying nothing.
- Today refetches when the app comes back to the front; a screen loaded at
  7:50 no longer reads "Due at 8:00" at 9:10.
- (later the same day) Settings › Notifications leads with a standing
  **Server push** line — ✓ Working with the last delivery time, ✗ Not set up
  on this phone, ✗ Last push failed, or not tested yet — computed from the
  server's view, so it's still true after the app restarts. Registering and
  testing are one button: it registers, then the server pushes 5 seconds
  later (time to lock the phone) and reports what Apple said.
