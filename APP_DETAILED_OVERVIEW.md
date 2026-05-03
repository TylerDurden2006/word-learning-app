# WordForge Detailed Overview

WordForge is a manual vocabulary dictionary and study app. Users enter every word card themselves, including definitions, nuance notes, pronunciation, related words, examples, visual cues, and optional image assets.

## Current Product Shape

- Dashboard: shows due review load, daily progress, mastery split, and the highest-priority card.
- Dictionary: searches saved words and supports editing without resetting review history.
- Add Word: saves manually completed rich cards.
- Review: runs active-recall sessions from the backend-ranked due queue.
- Profile: stores learner name, daily review goal, new-card budget, and prompt-mix preference.

## Backend Model

Words are rich manual cards with scheduling metadata. The production database is Convex, exposed through HTTP routes consumed by the browser app.

Core tables:

- `profile`: learner profile and review preferences.
- `words`: card content plus scheduling state.
- `reviewEvents`: immutable review history used for progress and diagnostics.

## Learning System

The scheduler uses an enhanced SM-2 flow:

- Four review ratings: `Again`, `Hard`, `Good`, and `Easy`.
- New cards begin in `new`, move through `learning`, and graduate into `reviewing`.
- Missed cards can enter `relearning`; repeated misses increase `leech_score` and can mark a card as `leech`.
- Queue priority combines overdue time, progress state, ease factor, lapse count, and leech risk.
- Prompt generation rotates through term, definition, synonym, antonym, example-context, and pronunciation recall.

## API Surface

Kept endpoints:

- `GET /api/bootstrap`
- `GET /api/words`
- `POST /api/words`
- `PUT /api/words/:id`
- `DELETE /api/words/:id`
- `GET /api/review-queue`
- `POST /api/review`
- `POST /api/profile`

The app exposes only manual dictionary, profile, and review endpoints.
