# WordForge / LexiMind App Overview

## Scope of this document

This document is based on:

- the full codebase in this repository
- the current thread context available to me
- the test suite and current repository files

I could not inspect any older conversation history outside the current thread, so this write-up reflects the codebase itself rather than inaccessible prior chats.

## Executive summary

This app is a local-first AI-assisted vocabulary learning system. Its core job is to help a learner build a personal word library, generate rich vocabulary cards with AI, review them using spaced repetition, and optionally import batches of terms from Google Docs.

At the code level, the app is:

- a Node.js server with no external web framework
- a single-page frontend served from static files
- a JSON-file-backed local datastore
- an AI-provider abstraction layer supporting `custom`, `openai`, and `anthropic`
- a spaced-repetition trainer using an SM-2 style scheduling model

Conceptually, the product is trying to be more than a dictionary. It is a study workflow:

1. Choose or configure an AI provider.
2. Generate a structured vocabulary card for a word or phrase.
3. Edit the draft before saving.
4. Store the card locally.
5. Review due cards using active recall and difficulty ratings.
6. Let the scheduler decide when the word appears again.

## Naming and branding

There are two active product names in the repository:

- `WordForge`
- `LexiMind`

`package.json`, the backend bootstrap payload, tests, and README treat the app as **WordForge**.

The frontend UI copy, HTML title, and visual branding mostly call it **LexiMind**.

Practical meaning:

- the app appears to have been renamed or partially rebranded
- the backend and frontend are not fully aligned
- any future documentation, marketing, or product cleanup should standardize the name

## Primary purpose of the app

The app is designed to help a learner build advanced English vocabulary through:

- AI-generated word cards
- manual editing and curation
- repeated exposure through spaced repetition
- queue-based review sessions
- lightweight learning analytics
- optional batch import from Google Docs

The product emphasis is not on flashcard minimalism. It aims for richer word understanding:

- definition
- nuance
- American pronunciation
- part of speech
- synonyms
- antonyms
- ten example sentences
- a visual prompt and SVG illustration

## Target learning model

The learning model is:

- local and personal
- structured around American English
- card-based
- recall-driven
- schedule-adaptive

The app enforces American English consistently:

- AI prompts explicitly ask for American pronunciation and usage
- profile accent is forced to `American English`
- settings carry an `american_accent_only` flag

## High-level architecture

## 1. Backend

The backend is a plain Node HTTP server in `server.js`.

Responsibilities:

- serve the SPA from `public/`
- expose JSON API endpoints
- validate requests
- save and read local data
- encrypt provider API keys
- call AI providers
- import terms from Google Docs
- compute review scheduling and due queues

There is no Express, database ORM, or external server framework.

## 2. Frontend

The frontend is a vanilla JavaScript SPA:

- `public/index.html`
- `public/app.js`
- `public/view-model.mjs`
- `public/styles.css`

Responsibilities:

- fetch bootstrap data and render screens
- manage in-memory UI state
- edit drafts and saved cards
- run review sessions
- manage provider settings forms
- handle Google OAuth token acquisition in the browser

## 3. Storage layer

The storage layer lives in `store.js` and `shared.js`.

Data is persisted in local JSON files:

- `data/db.json`
- `data/server.key`

This makes the app simple to run locally, but also means:

- it is not multi-user in any serious sense
- it has no concurrent-write protections beyond atomic rename on db writes
- long-term scale is intentionally modest

## 4. AI provider layer

`providers.js` abstracts three provider modes:

- `custom`
- `openai`
- `anthropic`

The active provider is used for:

- single-word generation
- SVG generation
- Google Docs batch import generation

## 5. Review engine

`review.js` provides:

- queue building
- review prompt selection
- SM-2 style scheduling updates

## Main user-facing functionality

## 1. Dashboard / Home

The dashboard is a summary screen that shows:

- a featured word
- additional recent or due words
- total words
- due queue count
- mastered count
- reviews completed today
- a mastery distribution donut
- a learning activity bar chart

Important implementation note:

- the dashboard charts are partly real and partly illustrative
- metrics such as total words and mastery rate come from real app state
- the weekly activity bars are hard-coded visual values, not true historical analytics

## 2. Add Word flow

This is the app's core creation workflow.

User flow:

1. Enter a word or phrase.
2. Click generate.
3. Backend calls the active AI provider.
4. Provider returns structured JSON for the word card.
5. The app optionally asks the provider for an SVG illustration.
6. The draft opens in an editor.
7. The learner can edit every field.
8. The learner saves the card to the vault.

Generated fields:

- `term`
- `definition`
- `nuances`
- `phonetics_us`
- `part_of_speech`
- `synonyms`
- `antonyms`
- `examples` with exactly 10 items
- `image_prompt`
- `image_svg` if available, otherwise fallback SVG

The edit step is important: the app is intentionally designed so AI output is draft material, not automatically final truth.

## 3. Word Library / Vault

The library lets the user:

- browse saved word cards
- search by word content
- select a card
- inspect its full detail view
- edit a saved card
- delete a saved card

The detail panel shows:

- word
- phonetics
- part of speech
- progress state
- definition
- nuance/context
- example sentence
- synonyms
- antonyms
- illustration
- review metrics

Important behavior:

- editing a saved card does **not** reset spaced-repetition history
- review counters and scheduling metadata are preserved during content edits

## 4. Review / Quiz flow

The review system is built around due cards.

Flow:

1. User opens the review screen.
2. App loads the due queue.
3. User starts a review session.
4. A card is shown.
5. User reveals the answer.
6. User rates recall difficulty:
   - `Again`
   - `Hard`
   - `Good`
   - `Easy`
7. The backend applies the SM-2 scheduling update.
8. The due queue is re-ranked.

The review session also tracks a small summary:

- how many cards were completed
- how many times each rating was chosen

## 5. Settings and profile

The settings screen supports:

- choosing active provider
- storing provider-specific model settings
- storing encrypted API keys
- testing provider connection without persistence
- saving provider settings with verification
- setting learner name
- setting daily review goal
- checking whether Google Docs OAuth is configured

Provider-specific behavior:

- `custom` requires base URL, model, and API key
- `openai` uses official OpenAI-style routing, with optional base URL override
- `anthropic` uses Messages API routing, with optional base URL override

## 6. Google Docs import

The Add Word screen includes a batch import workflow using a Google Docs URL.

Flow:

1. User pastes a Google Docs link.
2. Browser requests a short-lived OAuth token through Google Identity Services.
3. Backend exports the Google Doc as plain text through Google Drive API.
4. Importer extracts likely term candidates from the text.
5. Each new term is generated via the active AI provider.
6. Cards are saved if generation succeeds.
7. Existing terms are skipped.

Import result categories:

- imported
- skipped
- failed
- import error

## Functional details by subsystem

## Word card schema

The app enforces a strict schema for saved or AI-generated cards.

Required fields:

- `term`
- `definition`
- `nuances`
- `phonetics_us`
- `part_of_speech`
- `synonyms`
- `antonyms`
- `examples`
- `image_prompt`

Validation rules:

- required text fields must be non-empty
- `examples` must contain exactly 10 sentences
- `synonyms` must contain at least one item
- `antonyms` must contain at least one item
- duplicates are normalized away in list fields

This is a strong design choice: the app wants consistent, premium-looking cards rather than uneven sparse entries.

## AI generation behavior

The AI prompt is designed to generate:

- concise but useful definitions
- nuance and register guidance
- American IPA pronunciation
- advanced, natural examples
- a visual scene prompt

The illustration pipeline:

- first asks the provider to generate compact SVG markup
- if SVG generation fails or returns invalid content, the app falls back to a deterministic local SVG illustration generator

That fallback generator creates a visually themed SVG from:

- the term
- part of speech
- image prompt
- synonyms or antonyms

This means the app can still present a complete card even when illustration generation fails.

## Review scheduling logic

The review logic is an SM-2-inspired system rather than a pure original SM-2 implementation.

Ratings map to qualities:

- `Again` -> 0
- `Hard` -> 3
- `Good` -> 4
- `Easy` -> 5

Behavior summary:

- `Again` resets repetitions and sets the next interval to 1 day
- `Good` grows intervals normally
- `Hard` reduces growth somewhat
- `Easy` boosts interval growth
- ease factor is clamped between `1.3` and `3.2`
- a card becomes `mastered` only when repetitions are at least 5 and interval is at least 21 days

## Due queue prioritization

The due queue is not simply chronological.

Priority score is influenced by:

- overdue age
- whether the word is still in `learning`
- lower ease factor
- number of lapses

This means the app prioritizes cards that are:

- overdue
- still fragile
- historically difficult

## Prompt style rotation during review

The backend supports rotating prompt styles across review cycles:

- `term_to_definition`
- `definition_to_term`
- `synonym_ladder`
- `example_focus`

However, the current frontend quiz view primarily surfaces the term-first flow and reveal experience. The richer review prompt metadata exists in the backend queue objects, but the UI does not fully exploit every prompt variation yet.

## Security and secret handling

Provider API keys are encrypted server-side using AES-256-GCM.

Key management behavior:

- if `APP_MASTER_KEY` is set, it is hashed and used as the master key
- otherwise a local random key is generated and stored in `data/server.key`

Important security properties:

- encrypted API keys are stored in the JSON database
- the browser never receives saved keys back after persistence
- settings responses expose only `has_key`, not the raw key

This is good for a local app, though still not equivalent to a production secret-management system.

## Google Docs import parsing rules

Imported text is processed line by line.

The importer can handle:

- bullet-like prefixes
- numbered lists
- comma-separated short items
- semicolon-separated short items

Candidate filtering rules include:

- ignore empty lines
- ignore overly long phrase candidates
- ignore very short normalized entries
- deduplicate terms
- default import limit is 25 terms

This is meant to support study lists pasted into a Google Doc rather than arbitrary prose documents.

## Data model and persistence

## Expected runtime database structure

The current code expects `data/db.json` to look like:

```json
{
  "settings": {},
  "profile": {},
  "words": [],
  "review_events": [],
  "imports": []
}
```

Each saved word also contains scheduling and metadata fields such as:

- `id`
- `term_normalized`
- `source_type`
- `source_label`
- `created_at`
- `updated_at`
- `next_review_at`
- `last_reviewed_at`
- `review_count`
- `repetitions`
- `interval_days`
- `previous_interval_days`
- `ease_factor`
- `last_quality`
- `last_rating`
- `lapses`
- `progress_state`
- `archived`

## Current repository data observation

The checked-in `data/db.json` in this repository currently contains an older and incompatible schema:

```json
{
  "users": [],
  "wordCards": [],
  "reviewSessions": [],
  "reviewEvents": [],
  "aiGenerationLogs": [],
  "userApiKeys": [],
  "userUsage": []
}
```

That means:

- the current runtime code and the currently stored repository data are not aligned
- because `readDb()` safely falls back for missing sections, the app can still boot
- but existing old-format data will not be surfaced as active words unless a migration is added

This is one of the most important maintenance details in the repo.

## API surface

Main backend endpoints:

- `GET /api/bootstrap`
- `GET /api/words`
- `GET /api/review-queue`
- `POST /api/settings`
- `POST /api/settings/test`
- `POST /api/profile`
- `POST /api/words/generate`
- `POST /api/words`
- `POST /api/review`
- `POST /api/import-google-doc`
- `PUT /api/words/:id`
- `DELETE /api/words/:id`

What each does:

- `/api/bootstrap`: initial app payload including settings, profile, stats, imports, words, due queue
- `/api/words/generate`: create AI draft card
- `/api/words`: save a validated card
- `/api/review`: record a review rating and reschedule the card
- `/api/settings`: persist provider settings and attempt verification
- `/api/settings/test`: test provider connectivity without persisting
- `/api/import-google-doc`: batch-generate cards from a Google Doc

## Stats and analytics

`buildStats()` currently computes:

- total words
- due words
- mastered words
- learning words
- reviews today
- mastery rate
- recent words
- due queue preview

Notably, `reviews_today` is derived from `review_events` entries that match today's ISO date prefix.

## Tests and what is verified

The project includes a Node test suite in `core.test.js`.

At the time of this review, all tests pass.

Tested areas include:

- word card validation
- secret encryption/decryption
- fallback illustration generation
- legacy settings migration
- SM-2 scheduling behavior
- due queue sorting
- Google Docs ID parsing and term extraction
- Google auth error mapping
- provider test endpoint behavior
- encrypted settings persistence
- multi-provider memory
- word generation through custom provider
- word generation through Anthropic
- word edit persistence without losing review metadata
- profile validation
- frontend helper utilities

This gives decent confidence in the backend core logic.

## Operational behavior and environment variables

Important environment variables:

- `PORT`
- `GOOGLE_OAUTH_CLIENT_ID`
- `WORD_FORGE_DATA_DIR`
- `WORD_FORGE_DB_PATH`
- `WORD_FORGE_MASTER_KEY_PATH`
- `APP_MASTER_KEY`

Use cases:

- override storage location
- override db file path
- override master key location
- provide a fixed master secret
- enable Google Docs private import

## User experience design direction

The UI is visually styled as an editorial, premium study environment:

- serif headline typography
- sage and earth-tone palette
- dashboard cards and “vault” metaphors
- strong emphasis on curated learning

The UX tone is not utilitarian flashcards. It is designed to feel more like a refined personal learning studio.

## Important implementation quirks and ins-and-outs

## 1. Brand mismatch

The frontend mostly says `LexiMind`, while the backend and README say `WordForge`.

## 2. Encoding artifacts

Some frontend strings show mojibake-like characters such as:

- `â€¦`
- `â€”`
- `Â·`
- `â€“`

This likely comes from encoding issues in copied text content. It does not break the app logic, but it affects polish.

## 3. Old data schema in repository

The current checked-in `data/db.json` appears to come from an older version of the app.

## 4. Dashboard analytics are partly decorative

The home screen bar chart uses fixed values rather than true historical review data.

## 5. Review prompt richness exceeds current UI usage

The backend builds richer review prompt variants than the current frontend fully displays.

## 6. Save settings verifies but does not hard-fail persistence on verification failure

When saving provider settings:

- settings are saved first
- then verification is attempted
- if verification fails, the settings may still remain saved, with a failed verification message

This is a deliberate product choice and useful for imperfect environments.

## 7. Duplicate term protection exists

The app prevents saving two cards with the same normalized term.

This applies to:

- manual saves
- edits that would collide with another saved term
- Google Docs import skips existing terms

## 8. Edit safety for learning progress

Saved card edits preserve review state, which is a thoughtful learning-product choice.

## 9. The app is effectively single-user

There are traces of broader schema ideas in the old db format, but the current implementation is clearly local and single-user.

## 10. Static-file routing supports SPA fallback

Unknown non-API routes fall back to `public/index.html`, allowing client-side navigation patterns if expanded later.

## What the app is not

This app is not currently:

- a multi-user SaaS product
- a cloud-synced learning system
- a collaborative classroom tool
- a pronunciation audio trainer
- a full dictionary replacement
- a production-hardened hosted platform

It is best understood as a local AI-powered personal vocabulary trainer.

## Best concise description of the app

If someone asked, "What is this app?", the best short answer would be:

> A local-first AI vocabulary trainer that generates rich word cards, lets you edit and save them, imports study lists from Google Docs, and schedules reviews with an SM-2 spaced-repetition system.

## Suggested future cleanup areas

Based on the current codebase, the most valuable cleanup tasks would be:

- unify `WordForge` and `LexiMind` branding
- add migration from old checked-in `data/db.json` schema to current runtime schema
- fix text encoding artifacts in frontend strings
- replace decorative dashboard analytics with real review history
- expose richer review prompt types in the quiz UI
- document the storage schema and environment variables in the main README more explicitly

## Final assessment

This is a thoughtfully scoped learning app with a clear product identity:

- AI-assisted vocabulary enrichment
- editable premium card generation
- local private storage
- provider flexibility
- practical spaced repetition

Its strongest qualities are:

- strong structured schema for vocabulary cards
- editable AI output instead of blind automation
- clean provider abstraction
- local encrypted secret storage
- meaningful review scheduling

Its biggest gaps are mostly around polish and consistency, not concept:

- naming inconsistency
- data schema drift
- some frontend text/encoding cleanup
- partially decorative analytics

Underneath that, the core app idea is coherent and well implemented.
