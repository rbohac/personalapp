# Working on Bo

Bo is the owner's personal app (Ray Bohac). README.md says what it is and how
the pieces fit; docs/decisions.md says why; docs/SETUP.md is the one-time setup.

## How changes ship — standing instruction from the owner (2026-10-31)

**Merge your own pull requests. Never leave one for the owner to merge.**

1. Branch from the latest `main`.
2. Make the change, run the checks below, push, open a PR.
3. Wait for CI. When it's green, **merge the PR yourself** with a merge
   commit, and tell the owner it's merged (and whether they need to
   `git pull` or redeploy anything).
4. If CI is red, fix it first. Never merge red, and never skip or disable a
   check to get green.

A PR whose files no workflow covers (docs only, say) runs no CI; merge it
once your own checks pass.

Merging to `main` ships automatically: API changes deploy to Fly
(`.github/workflows/api.yml`), and app changes go to the phone
(`.github/workflows/app-release.yml`) as an over-the-air update, or as a new
TestFlight build when the native fingerprint changed (new library,
permission, icon, app.config.ts). Prefer JS-only changes where they do the
job; a native change costs a ~20-minute build and an Apple review pass. If a
change needs something the owner must do — a new secret, a migration they
should know about, a new app build — say so plainly in the PR and in your
reply.

## Checks before pushing

- API: `dotnet build api/Bo.Api/Bo.Api.csproj -c Release` (no warnings)
- App: `cd mobile && npx tsc --noEmit`
- After changing an endpoint: run the API and `npm run api:types` in
  `mobile/`, and commit the regenerated `lib/api-schema.d.ts`
- Docker (in a Claude cloud session): `docker-build-sandbox -f api/Dockerfile -t bo-api .`

## Conventions

- An area is a folder in `areas/` (area.json + README.md); see areas/README.md.
- Database changes are new numbered files in
  `api/Bo.Api/Data/Migrations/`; never edit one that has shipped.
- Record decisions in docs/decisions.md, appended, never rewritten.
- Frontend: React Native/Expo with TypeScript, typed from the API's OpenAPI.
  Backend: .NET, latest version.
