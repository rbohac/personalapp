# First-time setup

Everything here is a one-time step that needs one of your accounts, so it
can't be done from the repo. Do them in order — later steps need values from
earlier ones. Expect about an hour, most of it waiting on the first iOS build.

Values you'll collect along the way:

| Value | From | Goes to |
| --- | --- | --- |
| Neon connection string | step 1 | Fly secret `ConnectionStrings__Bo` |
| Google iOS client id | step 4 | `mobile/app.config.ts` **and** Fly secret `Auth__GoogleClientIds__0` |
| EAS project id | step 5 | `mobile/app.config.ts` |
| Anthropic API key | step 4b | Fly secret `ANTHROPIC_API_KEY` |
| Fly deploy token | step 8 | GitHub secret `FLY_API_TOKEN` |

---

## 1. Database — Neon

1. Sign up at neon.tech with your personal Gmail.
2. Create a project named **bo**. Pick the AWS region closest to the Fly region
   in `api/fly.toml` (Fly `ord` / Chicago → Neon `us-east-2` / Ohio).
3. Copy the connection string (the **direct** one, not "pooled" — the API pools
   its own connections). It looks like
   `postgresql://user:pass@ep-xxx.us-east-2.aws.neon.tech/bo?sslmode=require`.
   Either that URL form or `Host=…;Username=…` works.

## 2. API hosting — Fly.io

```bash
brew install flyctl
```

```bash
fly auth signup
```

Fly app names are global, so `bo-api` may be taken. Run every `fly` command
from the **repository root** — the image needs both `api/` and `areas/`:

```bash
fly apps create bo-api-bohac
```

Put the name you got into `app = "…"` in `fly.toml` (and change
`primary_region` if Chicago isn't near you). Then set the secrets — the
signing key is random and you never need to see it again:

```bash
fly secrets set ConnectionStrings__Bo='<neon connection string>' Auth__JwtSigningKey="$(openssl rand -base64 48)"
```

(`Auth__GoogleClientIds__0` comes in step 4.) Deploy and check it's up:

```bash
fly deploy
```

```bash
curl https://bo-api-bohac.fly.dev/healthz
```

`{"ok":true}` means the container is running and the migrations applied.
`fly logs` shows what happened if not.

## 3. Domain — api.bohac.dev

```bash
fly certs add api.bohac.dev
```

Fly prints the DNS records to add. At your registrar, add them for
`bohac.dev` — usually a `CNAME` from `api` to `bo-api-bohac.fly.dev`, plus an
`_acme-challenge` record if Fly asks for one. Then:

```bash
fly certs show api.bohac.dev
```

…until it says the certificate is issued, and
`curl https://api.bohac.dev/healthz` answers. `.dev` domains are HTTPS-only,
which Fly's certificate covers.

## 4. Google sign-in — Google Cloud

1. console.cloud.google.com → new project **Bo**.
2. **APIs & Services → OAuth consent screen**: External, app name "Bo", your
   Gmail as support and developer contact. Leave it in **Testing** and add
   `rbohac@gmail.com` as a test user — no Google review needed for that.
3. **Credentials → Create credentials → OAuth client ID → iOS**, bundle ID
   `dev.bohac.bo`. Copy the client id
   (`123…-abc….apps.googleusercontent.com`).
4. Paste it into `GOOGLE_IOS_CLIENT_ID` in `mobile/app.config.ts` (it's not a
   secret — it ships inside the app) and tell the API to accept it:

```bash
fly secrets set Auth__GoogleClientIds__0='<ios client id>'
```

## 4b. Reading captures — Anthropic API key

The Log screen sends what you type or say to Claude, which reads it using the
guides in `areas/` and answers in a fixed JSON shape. Without a key, Bo still
reads plain readings like "120/80 pulse 72", using the patterns in `area.json`,
but nothing in words ("remind me to…", "took my shot").

1. console.anthropic.com → sign up with your personal Gmail (separate from
   any Spearfish organization) → add a payment method → **API keys** →
   create one named `bo-api`.
2. Give it to the API:

```bash
fly secrets set ANTHROPIC_API_KEY='<key>'
```

Each capture is one short request to Claude Haiku 5.5: about a twentieth of
a cent. To change the model or how hard it thinks, set `Capture__Model` or
`Capture__Effort` (`low`, `medium`, `high`) the same way. The defaults are
`claude-haiku-5-5` and `medium`.

## 5. Expo — new personal account

1. Sign up at expo.dev (separate from the Spearfish account).
2. Then:

```bash
npm install -g eas-cli
```

```bash
eas login
```

```bash
cd mobile && eas init
```

Because the config is `app.config.ts`, `eas init` prints the project id rather
than writing it. Paste it into `EAS_PROJECT_ID` in `mobile/app.config.ts`. If
it asks, also add `owner: "<your expo username>"` to the config.

## 6. First build on your phone (Apple + EAS)

Register your iPhone, then build a development client:

```bash
eas device:create
```

```bash
eas build -p ios --profile development
```

Sign in with your Apple Developer account when asked; EAS creates the
`dev.bohac.bo` bundle id, certificates and provisioning for you.

**Push key:** EAS will offer to set up push notifications. Apple push keys
belong to the Apple *team*, not the app, and a team can only hold a couple.
If you still have the `.p8` file (and its key id) that Spearfish's Expo project
uses, choose to upload that existing key. Otherwise let EAS create one.

Install the build from the link EAS gives you, then on your laptop:

```bash
cd mobile && npm start
```

Open Bo on the phone, it connects to the dev server, and **Continue with
Google** should land you on your task list. Settings → **Send a test
reminder** proves notifications work.

## 7. TestFlight

```bash
eas build -p ios --profile production --auto-submit
```

The first submit creates the App Store Connect app record. **App Store names
are unique across all of Apple**, so "Bo" alone is almost certainly taken —
give App Store Connect something like "Bo — Bohac". The name under the icon on
your home screen is still "Bo" (it comes from `app.config.ts`, not App Store
Connect).

Once processing finishes, add yourself as an internal tester in App Store
Connect → TestFlight. Internal builds need no Apple review.

After that, JavaScript-only changes ship without a new build:

```bash
eas update --channel production --message "what changed"
```

## 8. Deploys from GitHub

```bash
fly tokens create deploy -a bo-api-bohac
```

Add the output as a repository secret named `FLY_API_TOKEN` (GitHub → Settings
→ Secrets and variables → Actions). From then on a merge to `main` that
touches `api/` builds and deploys it.

Also make `main` the repository's default branch (Settings → General) if it
isn't already.
