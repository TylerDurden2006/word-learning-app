const {
  DEFAULT_PROFILE,
  DEFAULT_REVIEW_PREFERENCES,
  createAppError,
  nowIso,
  readDb,
  writeDb,
  uid,
  normalizeText,
  normalizeProfile,
  normalizeReviewPreferences,
  validateWordCard
} = require('./shared');
const { getDueQueue } = require('./review');

function getProfile() {
  return normalizeProfile(readDb().profile);
}

function getReviewPreferences() {
  return normalizeReviewPreferences(readDb().review_preferences);
}

function saveProfile(payload) {
  const db = readDb();
  const rawGoal = Number(payload.daily_goal);
  if (!Number.isInteger(rawGoal) || rawGoal < 1 || rawGoal > 50) {
    throw createAppError('BAD_REQUEST', 'Daily review goal must be a whole number between 1 and 50.', 400);
  }

  const rawNewCards = payload.new_cards_per_day === undefined
    ? getReviewPreferences().new_cards_per_day
    : Number(payload.new_cards_per_day);
  if (!Number.isInteger(rawNewCards) || rawNewCards < 0 || rawNewCards > 50) {
    throw createAppError('BAD_REQUEST', 'New cards per day must be a whole number between 0 and 50.', 400);
  }

  db.profile = {
    ...DEFAULT_PROFILE,
    learner_name: String(payload.learner_name || db.profile?.learner_name || DEFAULT_PROFILE.learner_name).trim() || DEFAULT_PROFILE.learner_name,
    daily_goal: rawGoal,
    accent: 'American English'
  };
  db.review_preferences = {
    ...DEFAULT_REVIEW_PREFERENCES,
    ...getReviewPreferences(),
    new_cards_per_day: rawNewCards,
    review_prompt_mix: ['balanced', 'meaning-first', 'context-first'].includes(payload.review_prompt_mix)
      ? payload.review_prompt_mix
      : getReviewPreferences().review_prompt_mix
  };
  writeDb(db);
  return { profile: db.profile, review_preferences: db.review_preferences };
}

function getWords() {
  const db = readDb();
  return [...db.words].sort((left, right) => new Date(right.updated_at) - new Date(left.updated_at));
}

function getWordById(wordId) {
  return getWords().find((word) => word.id === wordId) || null;
}

function buildStoredWord(card, source = {}) {
  const now = new Date();
  return {
    id: uid('word'),
    term_normalized: normalizeText(card.term),
    source_type: source.type || 'manual',
    source_label: source.label || 'Manual entry',
    created_at: nowIso(now),
    updated_at: nowIso(now),
    next_review_at: nowIso(now),
    last_reviewed_at: null,
    review_count: 0,
    repetitions: 0,
    interval_days: 0,
    previous_interval_days: 0,
    ease_factor: 2.5,
    learning_step: 0,
    last_quality: null,
    last_rating: null,
    last_prompt_type: null,
    lapses: 0,
    leech_score: 0,
    progress_state: 'new',
    archived: false,
    ...card
  };
}

function saveWordCard(card, source = {}) {
  const validation = validateWordCard(card);
  if (!validation.ok) {
    throw createAppError('INVALID_WORD_CARD', validation.error, 422);
  }

  const db = readDb();
  const existing = db.words.find((word) => normalizeText(word.term) === normalizeText(validation.value.term));
  if (existing) {
    return existing;
  }

  const record = buildStoredWord(validation.value, source);
  db.words.unshift(record);
  writeDb(db);
  return record;
}

function updateWord(wordId, patch) {
  const db = readDb();
  const index = db.words.findIndex((word) => word.id === wordId);
  if (index === -1) {
    throw createAppError('NOT_FOUND', 'Word not found.', 404);
  }

  const existing = db.words[index];
  const validation = validateWordCard({ ...existing, ...patch });
  if (!validation.ok) {
    throw createAppError('INVALID_WORD_CARD', validation.error, 422);
  }

  const nextNormalized = normalizeText(validation.value.term);
  const duplicate = db.words.find((word) => word.id !== wordId && normalizeText(word.term) === nextNormalized);
  if (duplicate) {
    throw createAppError('BAD_REQUEST', 'Another saved card already uses this term.', 409);
  }

  const next = {
    ...existing,
    ...validation.value,
    term_normalized: nextNormalized,
    updated_at: nowIso()
  };

  db.words[index] = next;
  writeDb(db);
  return next;
}

function deleteWord(wordId) {
  const db = readDb();
  const index = db.words.findIndex((word) => word.id === wordId);
  if (index === -1) {
    throw createAppError('NOT_FOUND', 'Word not found.', 404);
  }

  const [removed] = db.words.splice(index, 1);
  writeDb(db);
  return removed;
}

function addReviewEvent(event) {
  const db = readDb();
  db.review_events.unshift(event);
  db.review_events = db.review_events.slice(0, 500);
  writeDb(db);
  return event;
}

function buildStats() {
  const db = readDb();
  const words = [...db.words];
  const now = new Date();
  const dueQueue = getDueQueue(words, now);
  const mastered = words.filter((word) => word.progress_state === 'mastered').length;
  const learning = words.length - mastered;
  const reviewsToday = db.review_events.filter((event) => event.occurred_at && event.occurred_at.startsWith(nowIso(now).slice(0, 10))).length;
  const recentlyAdded = words
    .slice()
    .sort((left, right) => new Date(right.created_at) - new Date(left.created_at))
    .slice(0, 4);

  return {
    total_words: words.length,
    due_words: dueQueue.count,
    mastered_words: mastered,
    learning_words: learning,
    reviews_today: reviewsToday,
    mastery_rate: words.length ? Math.round((mastered / words.length) * 100) : 0,
    recent_words: recentlyAdded,
    due_preview: dueQueue.items.slice(0, 5)
  };
}

function getBootstrap() {
  const profile = getProfile();
  const reviewPreferences = getReviewPreferences();
  const stats = buildStats();
  const words = getWords();
  return {
    app_name: 'WordForge',
    accent_mode: 'American English',
    profile,
    review_preferences: reviewPreferences,
    stats,
    words,
    due_queue: getDueQueue(words)
  };
}

module.exports = {
  getProfile,
  getReviewPreferences,
  saveProfile,
  getWords,
  getWordById,
  saveWordCard,
  updateWord,
  deleteWord,
  addReviewEvent,
  buildStats,
  getBootstrap
};
