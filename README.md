# WordForge

WordForge is a manual personal dictionary for saving rich vocabulary cards and reviewing them with active recall plus spaced repetition.

## What It Includes

- Manual rich-card entry for definitions, nuances, American phonetics, part of speech, synonyms, antonyms, examples, visual cues, and optional image assets
- Personal dictionary search and inline editing
- Active-recall review prompts that rotate across definitions, terms, synonyms, antonyms, example context, and pronunciation
- Enhanced SM-2 style scheduling with learning/relearning states, leech risk, priority scoring, and daily progress tracking
- Learner profile settings for daily review goal and new-card budget
- Convex-backed storage with a local Node static server and API proxy

## Run

```bash
npm start
```

Open [http://localhost:3000](http://localhost:3000).

## Vercel Deployment

This app deploys to Vercel as a static site. The build command copies `public/` to `dist/` and injects the Convex HTTP Actions URL into `index.html`.

Use these Vercel project settings:

- Framework preset: `Other`
- Build command: `npm run build`
- Output directory: `dist`
- Install command: `npm install`

Import the root `.env` file into Vercel Environment Variables. The required runtime value is:

```bash
CONVEX_HTTP_URL=https://small-scorpion-772.eu-west-1.convex.site
```

The `.env` file also includes Convex CLI metadata for convenience. It does not include the Convex deploy key.

## Convex Backend

WordForge uses Convex under `convex/` for the app database and REST-style HTTP routes.

```bash
npm run convex:dev
```

After linking or logging in, deploy the current backend source:

```bash
npm run convex:deploy
```

If the deployment previously ran an older WordForge schema, normalize old word documents after deploying:

```bash
npm run convex:migrate-legacy
```

To run the browser app against Convex through the Node server, set the Convex HTTP Actions site URL:

```bash
CONVEX_HTTP_URL=https://your-deployment.convex.site npm start
```

If you serve `public/` without `server.js`, set `window.WORDFORGE_CONFIG.apiBaseUrl` before `/app.js` loads or fill the `wordforge-api-base` meta tag in `public/index.html` with the same Convex site URL.

To migrate a local JSON database into Convex:

```bash
CONVEX_URL=https://your-deployment.convex.cloud npm run migrate:convex
```

Use the `.convex.cloud` URL for the migration script because it calls Convex functions through `ConvexHttpClient`; use the `.convex.site` URL for browser REST traffic.

## Tests

```bash
npm test
```

The test suite covers:

- Manual word-card validation and legacy visual-field migration
- Enhanced spaced-repetition scheduling and due-queue ordering
- Active-recall prompt rotation
- Convex profile, word, review, and HTTP route behavior
- Frontend helper functions

To run the opt-in live Convex smoke test:

```bash
WORDFORGE_LIVE_CONVEX_TESTS=1 \
CONVEX_URL=https://your-deployment.convex.cloud \
CONVEX_HTTP_URL=https://your-deployment.convex.site \
npm run test:convex
```

The live test creates a uniquely named test word, reviews it, checks the HTTP bootstrap payload, and deletes the test word before finishing.
