# Bo

A personal app: say or type what happened ("took my BP, 120/80, pulse 72"),
and Bo logs it — blood pressure, medications, shots, workouts, walks, and
tasks on separate lists. Schedules and adherence next; home automation
eventually. One user for now, built to grow.

| Part | What | Where it runs |
| --- | --- | --- |
| `mobile/` | Expo (SDK 58) + expo-router, TypeScript | iPhone, via TestFlight and EAS Update |
| `api/` | .NET 10 minimal API, Dapper, plain-SQL migrations | Docker container on Fly.io at `api.bohac.dev` |
| `areas/` | One folder per thing tracked: `area.json` (fields) + `README.md` (guidance) | Shipped inside the API image |
| database | Postgres | Neon |

Recreating the Claude cloud environment that works on this repo is
[`docs/cloud-environment/`](docs/cloud-environment/README.md).

First-time setup — accounts, keys, DNS, the first build — is
[`docs/SETUP.md`](docs/SETUP.md). Why it is shaped this way is
[`docs/decisions.md`](docs/decisions.md).

## How the pieces talk

```
iPhone (Bo) ──HTTPS + bearer token──▶ api.bohac.dev (Fly, .NET) ──▶ Neon Postgres
     │
     └─ local notifications: reminders ring from the phone, no server needed
```

- **Sign-in:** native Google Sign-In on the phone → the API verifies the
  Google ID token and the one-address allowlist → returns Bo's own token,
  kept in the iOS keychain.
- **The API is the contract.** It serves its OpenAPI document at
  `/openapi/v1.json`; `npm run api:types` in `mobile/` regenerates the app's
  types from it, so a server change shows up as a type error in the app.
- **Reminders** are stored on the task (`remindAt`) and scheduled on the phone
  as local notifications with Done / Snooze buttons.
- **Areas are folders, not code.** [`areas/`](areas/README.md) defines what
  each area records. The API validates against it, renders each entry's
  one-line summary from it, and the app builds its forms from it. Adding an
  area is two files and a deploy: no migration, no app release.
- **Capture** (`POST /capture`) turns what was typed or said into proposals.
  Claude Haiku 5.5 reads `areas/_capture.md` (rules and worked examples) plus
  every area's README and answers in a fixed JSON schema, and every value goes through the same validation as a
  hand-entered one. The app shows the proposals and saves only what you keep.
  Voice is on-device speech recognition; the server only ever sees text.

## Day to day

API, locally:

```bash
cd api && docker compose up -d
```

```bash
cd api && dotnet run --project Bo.Api
```

It listens on `http://0.0.0.0:5080` and applies migrations at startup.

App, on your phone (needs a development build installed once, see SETUP):

```bash
cd mobile && npm start
```

After changing an endpoint, regenerate the app's types:

```bash
cd mobile && BO_API_URL=http://localhost:5080 npm run api:types
```

Ship: merge to `main`. GitHub Actions deploys the API to Fly
(`api.yml`) and releases the app (`app-release.yml`): an over-the-air update
when only JavaScript changed, or a new build submitted to TestFlight when the
native fingerprint changed. Both need repository secrets (`FLY_API_TOKEN`,
`EXPO_TOKEN`). By hand, `fly deploy` from the root, and from `mobile/`
`eas update --channel production` or
`eas build -p ios --profile production --auto-submit`.

## Adding a database change

Add `api/Bo.Api/Data/Migrations/NNNN_name.sql` with the next number. Never
edit one that has shipped — it has already run and won't run again. Keep
changes additive so the previous build keeps working during a deploy.
