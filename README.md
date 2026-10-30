# Bo

A personal app: tasks and reminders today; health tracking (blood pressure,
medications, workouts, walks), schedules and adherence next; home automation
eventually. One user for now, built to grow.

| Part | What | Where it runs |
| --- | --- | --- |
| `mobile/` | Expo (SDK 58) + expo-router, TypeScript | iPhone, via TestFlight and EAS Update |
| `api/` | .NET 10 minimal API, Dapper, plain-SQL migrations | Docker container on Fly.io at `api.bohac.dev` |
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

Ship: merge to `main`. The API deploys to Fly from GitHub Actions. App
JavaScript ships over the air with `eas update --channel production`; a new
native module or permission needs a new build (`eas build -p ios --profile production --auto-submit`).

## Adding a database change

Add `api/Bo.Api/Data/Migrations/NNNN_name.sql` with the next number. Never
edit one that has shipped — it has already run and won't run again. Keep
changes additive so the previous build keeps working during a deploy.
