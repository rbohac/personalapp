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

## 2026-11-02 — Home first, mic in the middle

- **Home is the first tab** (it replaces Today): date and greeting, a
  *Needs you* line (schedules due or late plus overdue task reminders), then
  **Now** (today's schedules), **Coming up** (later schedules and tasks with
  a reminder or due date in the next three days), **This week** (goals) and
  **Recent** (the last few entries). Modeled on the Spearfish OS home: what
  to pay attention to, glanceable, detail a tap away.
- **A daily list is one line until opened:** a bar and "8 of 8 taken · 1
  skipped"; tapping opens the item buttons. Ticking a list made Recent show
  eight medication rows, so a run of medications logged within 30 minutes
  reads as one: "Medications · 8 taken".
- **The mic is the middle of the tab bar,** not a tab: it opens the capture
  sheet already listening (hold it to open without listening, to type).
  The capture sheet no longer carries a history list, and saving closes it.
- **Goals can be per day** (`goals.period`, migration 0010): "at least 15
  minutes a day of household work at Brock Road". Home shows today's minutes,
  the last 7 days as small bars, and days met this week; zero days just show
  as zero. The weekly pushes count a per-day goal by days met.
- **Two new areas:** `household` (minutes, what, where — Brock Road by
  default) and `health-events` (one-off procedures and the like: what, body
  part, amount, who). Areas are files, so these needed no code.

## 2026-11-02 — New things to track, and nothing dropped

- **Unsorted** catches anything no area fits, with the words as said and a
  two-word "about", instead of the capture saying "nothing to log". When
  something keeps landing there, the owner asks and it gets an area — the
  owner chose that over the app drafting areas itself.
- **New areas:** vitals (SpO2, temperature, heart rate), weight (lb), and
  nutrition (protein in grams plus the food in the owner's words, estimated
  and marked when no grams are said). The food words are kept on purpose,
  to ask questions of later.
- **Courses** (`schedules.intervals`): a schedule whose gaps change and then
  stops — the Wolverine patch is every other day for three, then weekly, six
  in all. The gap after dose n is `intervals[n-1]`; past the last, it's
  finished. Doses are counted (`doses_done`).
- **Heads-ups** (`heads_up_days`): a push that many days before a dose is
  due, once per due date — Leqvio, 14 days ahead, every 182 days from the
  last one (to confirm with the doctor).
- **Past doses start a schedule:** a schedule with no date yet counts any
  past dose, so logging old Leqvio injections with their dates sets the next
  one. A new schedule with a date counts doses from a day before it was made.
- **A goal's target can come from another reading** (`goals.target_from`):
  protein is 1 g per pound of the latest weight as of each day, falling back
  to 200 g until a weight is logged.
- Migration 0011 adds the columns and the owner's Sermorelin, Wolverine
  patch and Leqvio schedules and protein goal.

## 2026-11-02 — Weekday schedules, doses that follow you, paired sites

- **A daily schedule can be limited to weekdays** (`schedules.weekdays`,
  0 = Sunday): sermorelin is Monday–Friday. On a day off it reads "Off today ·
  next Monday" and nothing nudges.
- **The dose shown and logged is the newest of the last logged dose and the
  one set on the schedule** (`dose`, `dose_set_at`). Tirzepatide is
  self-titrated in units; saying "tirzepatide 35 units" is all it takes for
  the next reminder to say 35. Done logs the dose with the side.
- **Paired sites** (`opposite_of`): sermorelin alternates belly sides, but on
  a day tirzepatide is given (logged today, or due today) it takes the side
  opposite tirzepatide's. That makes the week R-L-R-L-R or L-R-L-R-L, as the
  owner described, with no separate pattern to keep.
- Migration 0012 turns the owner's Sermorelin schedule into Mon–Fri, 15
  units (0.15 ml), belly rotation, paired with tirzepatide; tirzepatide gets
  a 30-unit dose.

## 2026-11-03 — Last night, Ask Bo, Trends

- **Sleep is an area** (`areas/sleep`), one entry per night dated the morning
  after: bed and up times, time up in the night (periods and total minutes),
  overnight snack (none / yes / carbs), CPAP hours and score, yesterday's nap.
  Home shows a **Last night** card from 4 am until the night is logged — one
  line until opened, all taps and two number boxes, no 1–10 scale. Voice works
  too. No morning push yet; the card is the prompt.
- **Nights without snacking** is a weekly goal (days with a sleep entry whose
  snack isn't yes or carbs, target 7), using the existing exclude rule —
  migration 0013 adds it for the owner.
- **Ask Bo** (`POST /ask`): a question in plain words, answered by the same
  Haiku model from the last 90 days of entries (one compact line each, at
  most 2,500), the schedules and the goals, plus the last few turns for
  follow-ups. Fixed JSON out: a short answer and an optional chart. It answers
  from the data only, says what's missing, and isn't medical advice beyond
  suggesting the doctor for readings well out of range. Recorded like a
  capture (feature "ask"), so it shows in AI usage and counts against the
  budget. The conversation isn't stored.
- **Trends** (`GET /trends?days=7|30|90`): worked out from entries on every
  read — blood pressure readings and averages (and the window before),
  weight change, protein and Brock Road per day, days with meds logged and
  items skipped, shots by medication, and sleep (clean nights, carb nights,
  CPAP, time up). Plain-view bar charts, so it ships over the air.
- Ask and Trends open from two icons at the top of Home.

## 2026-11-03 — A schedule is something you look at; editing is rare

- Tapping a schedule opens its page — status, next due, next dose and side,
  last taken, a Done button, and its **history** (`GET
  /schedules/{id}/history`: the area's entries naming it; for a daily list,
  one row per day with what was taken). **Edit** is in the corner and opens
  the editor, which, like the entry screen, shows Close until something
  changes, then Cancel and Save. The goal editor works the same way.
- **An area can name related areas** (`related` in area.json). Medications
  names Shots, so its screen lists everything taken in one place: first
  "Your medications" (every schedule in either area, each opening its page),
  then the history of both. Pills and injections stay separate areas because
  their fields differ.

## 2026-11-03 — Offline first: a local copy and an outbox

- **The offline layer sits under the API client** (`lib/offline.ts` is
  openapi-fetch's `fetch`), so screens don't know about it. A read that
  succeeds is saved in SQLite (`lib/local.ts`); a read that can't reach the
  server (no signal, or slower than 8 s, or a 5xx) is answered from the saved
  copy. Home also paints its last snapshot before the network answers, so it
  never opens empty.
- **Changes made often wait for the connection:** logging, editing and
  deleting entries, tasks (create, edit, done, delete), and ticking, Done and
  snooze on schedules. Offline they go into an outbox, are applied to the
  saved copies at once (so the screen shows them, with labels like "Done ·
  waiting to sync"), and are sent in order when the connection returns — on
  launch, on returning to the app, and on a retry timer. Something made
  offline gets a temporary id; once its create reaches the server, later
  queued changes are pointed at the real one. Anything else (editing a
  schedule or goal, settings, Ask) needs a connection and says so.
- **Each change carries an Idempotency-Key** (the outbox row's id). The
  server stores the first answer per key for a week (`idempotency_keys`,
  migration 0014) and replays it for a repeat, so a retry after a lost answer
  never applies twice. 5xx answers aren't stored.
- **A change the server refuses** (4xx) is dropped and named on Home, so one
  bad change can't hold up the rest.
- **Captures said offline** are kept with their words, read by the model
  when the connection is back, and wait on Home ("Said while offline · 2 to
  review") for the usual check before saving — owner's choice over filing
  them straight to Unsorted.
- One phone, so the last change wins; 90 days of entries are kept locally.
- **Lock-screen actions without opening Bo were dropped:** expo-notifications
  runs JS for a notification button in the background only on Android; on
  iOS it needs a native extension this repo doesn't have. Done still opens
  Bo, which now works offline.
- **This build also carries the native parts of Apple Health
  (@kingstinct/react-native-healthkit, read-only, NSHealthShareUsageDescription)
  and Whisper (whisper.rn, expo-file-system for the model download)**, so the
  features that use them can ship over the air.

## 2026-11-04 — A daily list is a checklist, in sections

- The schedule page for a daily list (morning meds and vitamins) shows a
  **checklist**: one item per row, grouped under its sections, tap to tick or
  untick, hold for skip today or remind me later, with Took all and Remind me
  later underneath. Home keeps its one-line summary.
- **Sections are headings in the same list:** a line starting "# " ("#
  Medicines", "# Vitamins") groups the lines after it. Headings are never
  ticked, counted or put in a reminder (`ScheduleRow.ItemNames`). The editor
  shows one box per section, with a name and its items one per line.
- "Last taken" on a daily list is the newest entry naming any of its items
  (it had only looked for entries naming the list, so it read "Not logged
  yet" after a morning of ticks).

## 2026-11-06 — Nose sprays: two daily schedules on one medicine

Morning and night nose sprays are two daily schedules ("Morning nose
sprays" 10:00, "Night nose sprays" 22:00), both matching "nose spray",
rather than a new twice-a-day cadence — the nudge, follow-up, Done and
history all work unchanged.

- **Which one a dose counts for.** Done (in the app or on the push) stamps
  the entry with its schedule (`entries.schedule_id`), so a late morning
  dose pressed at 5 PM is still the morning one. A dose said in words counts
  for the schedule whose part of the day it falls in: the day splits halfway
  between the times (before 4 PM is morning, after is night). This applies
  whenever two or more daily schedules share a medicine; one alone is
  unchanged.
- **10 PM is inside quiet hours (22:00–07:30).** A schedule's own nudge now
  gets through when its time was set inside quiet hours on purpose. Its
  follow-up and everything else still wait for morning.

## 2026-11-06 — Home doesn't jump on a refresh

The "How was last night?" card hid itself while Home was loading, so every
refresh (coming back to the app, a tick, a pull) removed it and put it back,
moving everything below it under your finger. It now waits only for the
first answer (a snapshot or a finished load) and stays put through
refreshes. Tapping Home while on Home scrolls to the top.

## 2026-11-07 — Offline that heals itself

At home on good Wi-Fi, Bo said "Offline" and showed yesterday's ticks as
today's. Three causes, three fixes (all in `mobile/lib/offline.ts` and
`lib/rollover.ts`):

- **One blip stuck.** A single failed read (a TLS error as the phone wakes,
  or a read slower than 8 s) flipped Bo offline, and nothing checked again
  until something else happened to succeed — a capture said meanwhile sat
  waiting. Now a network failure is retried once before it counts; slow
  isn't offline (with a saved copy, show it after 4 s and refresh when the
  answer lands); and once offline, Bo checks `/healthz` on its own (2 s,
  doubling to a minute, and straight away when the app comes to the front).
  When it answers: queued changes go, offline captures are read, every
  screen reloads.
- **Yesterday read as today.** Statuses are worked out by the server, so a
  saved copy keeps the day it was saved. A copy from an earlier day is now
  brought forward before it's shown: daily schedules start over (items open,
  due at their time, off-days off), every-N-days ones that came due read as
  due, daily goals start at zero.
- **"Offline" said nothing useful.** The strip now says which: "No internet"
  or "Can't reach Bo's server" (checked against captive.apple.com), with
  when it last synced; tap to retry, hold for the last error.

## 2026-11-07 — Connection debugging

Settings → Connection (also: hold the offline strip on Home) runs three
checks — internet (captive.apple.com), Bo's server (`/healthz`), signed in
(`/me`) — and says which one is the problem in words. It lists what's
waiting to send (hold one to drop it if it's stuck and blocking the rest)
and the last 60 requests with status, time and the system's own error text;
Share report sends it all as text. `.github/workflows/health.yml` checks the
API every 30 minutes from GitHub, so an outage emails the owner instead of
showing up as a laggy app; when it fails it asks Fly for status, machines,
certificates and recent logs.

Also: going back online reloads every screen at most every 20 s (a flaky
connection was reloading Home on each flip), and a successful read no longer
re-renders Home each time.

## 2026-11-09 — Testosterone twice a week: 4 days, then 3, and a full shot for a week away

Half dose twice a week instead of a full one weekly. A schedule can now
carry repeating gaps (`cycle`, here {4,3}), amounts to pick from when
logging (`dose_options`: 0.4 ml, 0.5 ml, or a custom amount) and a full
dose (`full_dose`: 0.8 ml).

- **Logging asks how much.** Done on Home opens the schedule with a picker;
  it shows the next date each choice leads to before you log.
- **A normal dose waits the next gap and moves the cycle on; a full shot
  waits `every_days` (a week) and doesn't.** So Mon/Fri stays Mon/Fri after
  a week away. Counted from the dose, so a late one resets, like the weekly
  shots always have; there's no "moved to Tuesdays" question for a cycle.
- **The usual amount skips a full shot**, so the default after a trip is the
  half dose again, not 0.8.
- A push's Done (no amount) logs the usual dose.
- Migration 0016 sets the owner's testosterone up: due today (or in 4 days
  if today's was already logged), 0.4 ml by default.

## 2026-11-10 — A crash on launch: new code reading an old saved copy

The testosterone update (0.1.x OTA after #38) crashed at startup. Home
draws from the snapshot saved on the phone before the server answers, and
that snapshot predated the new `doseOptions` field, so
`sch.doseOptions.length` threw while drawing Home; expo-updates treats a
crash at launch as a broken update (`ErrorRecovery.crash`).

- New fields are read through a helper with a fallback (`hasDoseChoices`,
  `?? []`). **Rule: anything the app reads from the API may be missing in a
  saved copy — default it.**
- The root layout exports an `ErrorBoundary`: a screen that throws while
  drawing shows "Something went wrong" with Try again and Clear saved
  copies, instead of taking the app down.

## 2026-11-10 — Skipping a dose is a confirmed, recorded act

A Skip button on medication and shot schedules (Home and the schedule page),
and "Skip today" on a list item, each confirm first ("Skip Vyvanse?") with
an optional reason ("flying today"). A skip is an **entry** with event
"skipped" (and the reason in notes), linked to its schedule — the same table
as a dose, so history, Ask Bo ("how often did I skip Vyvanse?") and any
later report count it with no new store. Medications gained an `event`
field (taken | skipped, default taken); shots gained "skipped".

- A daily dose skipped today reads "Skipped today" and isn't nudged.
- An every-N dose (testosterone) can be skipped once it's due, never ahead;
  the next one is the next gap from today (a cycle moves on). Undo, the same
  day, puts it back.
- A list item's skip writes its entry too, so unticking removes it, as with
  taken. Saying "skipped my Vyvanse" marks the item skipped the same way.
- The schedule page shows skips in its history (with the reason) and how
  many in the last 30 days.
