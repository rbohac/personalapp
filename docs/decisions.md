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

- Trackers: blood pressure, medications, workouts, walks — a generic
  `trackers` + `entries` model, with a one-tap quick-log screen.
- Schedules and adherence ("did I do it when I meant to?"), derived from
  entries and never stored.
- An offline outbox for writes made without signal.
- Apple Health: write BP readings, read workouts and walks.
- Integrations: inbound webhooks, Home Assistant over Tailscale.
