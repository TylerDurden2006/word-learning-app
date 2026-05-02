# WordForge

WordForge is a local-first vocabulary learning app that helps you generate rich word cards with AI, edit every card asset before or after saving, review them with an SM-2 spaced-repetition flow, and batch-import word lists from Google Docs.

## What It Includes

- Five screens: Dashboard, Add Word, Word Library, Review / Quiz, Settings
- AI-generated assets for each word:
  - Definition
  - Nuances
  - American phonetics
  - Part of speech
  - Synonyms and antonyms
  - Ten advanced example sentences
  - A generated SVG illustration prompt/image
- Full inline editing for generated drafts and saved word cards
- SM-2 spaced repetition with difficulty rating buttons
- Due-word priority queue for review order
- Progress tracking for mastered vs learning cards
- Google Docs import for batch card generation
- Dedicated Settings screen for provider selection and profile management
- Local encrypted storage for provider API keys
- Private Google Docs import via Google OAuth when `GOOGLE_OAUTH_CLIENT_ID` is configured

## Run

```bash
npm start
```

Open [http://localhost:3000](http://localhost:3000).

## Convex Backend

WordForge now includes a Convex backend under `convex/` with HTTP actions that mirror the existing `/api/...` contract.

```bash
npm run convex:dev
```

Set Convex environment variables before using provider settings in Convex:

```bash
npx convex env set APP_MASTER_KEY "your-long-random-secret"
npx convex env set GOOGLE_OAUTH_CLIENT_ID "your_google_oauth_web_client_id"
```

To run the app against Convex only, point the Node server at the Convex HTTP Actions site URL:

```bash
CONVEX_HTTP_URL=https://your-deployment.convex.site npm start
```

`server.js` proxies every `/api/...` request to Convex and does not fall back to the local JSON datastore. If you serve `public/` without `server.js`, set `window.WORDFORGE_CONFIG.apiBaseUrl` before `/app.js` loads or fill the `wordforge-api-base` meta tag in `public/index.html` with the same Convex site URL.

To migrate the current JSON database into Convex:

```bash
CONVEX_URL=https://your-deployment.convex.cloud npm run migrate:convex
```

Use the `.convex.cloud` URL for the migration script because it calls Convex functions through `ConvexHttpClient`; use the `.convex.site` URL for browser REST traffic because the app talks to HTTP actions.

## AI Provider Setup

In the Settings screen, you can choose among:

- `Custom`: base URL, model, and API key for an OpenAI-compatible endpoint
- `OpenAI`: official preset with model + API key
- `Anthropic`: official preset with model + API key

The active provider is used for:

- single word generation
- SVG illustration generation
- Google Docs batch imports

API keys are encrypted server-side and never returned to the browser after saving.

## Google Docs Import

To enable private Google Docs import, set:

```bash
GOOGLE_OAUTH_CLIENT_ID=your_google_oauth_web_client_id
```

The app then uses Google Identity Services in the browser to request a short-lived `drive.readonly` access token only when the user starts a Google Docs import.

## Storage

The app stores local data in:

- `data/db.json`
- `data/server.key`

If you set `APP_MASTER_KEY`, that key is used instead of the generated local key file.

## Tests

```bash
npm test
```

The tests cover:

- Provider-settings migration and encrypted persistence
- Custom, OpenAI, and Anthropic routing, model discovery, auth headers, and rejected-key handling
- Editable word-card updates
- Word-card schema validation
- Secret encryption/decryption
- SM-2 scheduling behavior
- Due-queue ordering
- Google Docs import parsing

To run live API-key smoke tests against real providers, opt in explicitly:

```powershell
$env:WORDFORGE_LIVE_PROVIDER_TESTS='1'; $env:OPENAI_API_KEY='sk-...'; npm test
$env:WORDFORGE_LIVE_PROVIDER_TESTS='1'; $env:ANTHROPIC_API_KEY='sk-ant-...'; npm test
$env:WORDFORGE_LIVE_PROVIDER_TESTS='1'; $env:CUSTOM_BASE_URL='https://provider.example/v1'; $env:CUSTOM_API_KEY='sk-...'; npm test
```

```bash
WORDFORGE_LIVE_PROVIDER_TESTS=1 OPENAI_API_KEY=sk-... npm test
WORDFORGE_LIVE_PROVIDER_TESTS=1 ANTHROPIC_API_KEY=sk-ant-... npm test
WORDFORGE_LIVE_PROVIDER_TESTS=1 CUSTOM_BASE_URL=https://provider.example/v1 CUSTOM_API_KEY=sk-... npm test
```

Optional `OPENAI_MODEL`, `ANTHROPIC_MODEL`, or `CUSTOM_MODEL` values assert that the key exposes that exact model.
