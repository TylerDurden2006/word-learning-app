const {
  PROVIDER_IDS,
  DEFAULT_SETTINGS,
  DEFAULT_PROFILE,
  createAppError,
  nowIso,
  readDb,
  writeDb,
  uid,
  normalizeText,
  encryptSecret,
  decryptSecret,
  validateWordCard,
  withGeneratedIllustration
} = require('./shared');
const { getDueQueue } = require('./review');

function getSettings() {
  const db = readDb();
  return { ...DEFAULT_SETTINGS, ...db.settings, providers: { ...db.settings.providers } };
}

function getPublicSettings(settings = getSettings()) {
  return {
    active_provider: settings.active_provider,
    providers: Object.fromEntries(
      PROVIDER_IDS.map((providerId) => {
        const provider = settings.providers[providerId];
        return [providerId, {
          base_url: provider.base_url,
          model: provider.model,
          has_key: Boolean(provider.encrypted_api_key),
          connection_status: provider.connection_status,
          last_tested_at: provider.last_tested_at
        }];
      })
    )
  };
}

function getProfile() {
  const db = readDb();
  return { ...DEFAULT_PROFILE, ...(db.profile || {}) };
}

function assertProviderId(providerId) {
  if (!PROVIDER_IDS.includes(providerId)) {
    throw createAppError('BAD_REQUEST', 'Unknown provider selected.', 400);
  }
}

function saveSettings(payload) {
  const db = readDb();
  const current = getSettings();
  const providerId = String(payload.provider || payload.active_provider || current.active_provider || 'custom').trim();
  assertProviderId(providerId);

  const activeProvider = payload.active_provider === undefined ? current.active_provider : String(payload.active_provider || '').trim();
  assertProviderId(activeProvider);

  const next = {
    ...current,
    active_provider: activeProvider,
    providers: { ...current.providers },
    american_accent_only: true
  };

  const existingProvider = current.providers[providerId] || {};
  const provider = {
    ...existingProvider,
    base_url: payload.base_url === undefined ? existingProvider.base_url : String(payload.base_url || '').trim(),
    model: payload.model === undefined ? existingProvider.model : String(payload.model || '').trim(),
    connection_status: payload.connection_status === undefined
      ? existingProvider.connection_status || 'saved'
      : String(payload.connection_status || '').trim() || 'saved',
    last_tested_at: payload.last_tested_at === undefined
      ? existingProvider.last_tested_at || null
      : payload.last_tested_at
  };

  if (typeof payload.api_key === 'string' && payload.api_key.trim()) {
    provider.encrypted_api_key = encryptSecret(payload.api_key.trim());
  }

  next.providers[providerId] = provider;
  db.settings = next;
  writeDb(db);
  return getSettings();
}

function saveProfile(payload) {
  const db = readDb();
  const rawGoal = Number(payload.daily_goal);
  if (!Number.isFinite(rawGoal) || !Number.isInteger(rawGoal) || rawGoal < 1 || rawGoal > 50) {
    throw createAppError('BAD_REQUEST', 'Daily review goal must be a whole number between 1 and 50.', 400);
  }

  db.profile = {
    ...DEFAULT_PROFILE,
    ...db.profile,
    learner_name: String(payload.learner_name || db.profile?.learner_name || DEFAULT_PROFILE.learner_name).trim() || DEFAULT_PROFILE.learner_name,
    daily_goal: rawGoal,
    accent: 'American English'
  };
  writeDb(db);
  return db.profile;
}

function getCredentials(providerId = null) {
  const settings = getSettings();
  const resolvedProviderId = providerId || settings.active_provider;
  assertProviderId(resolvedProviderId);

  const provider = settings.providers[resolvedProviderId];
  if (!provider.model || !provider.encrypted_api_key) {
    throw createAppError(
      'INVALID_API_KEY',
      `Add the ${resolvedProviderId} model and API key in Settings first.`,
      400
    );
  }

  return {
    provider: resolvedProviderId,
    baseUrl: provider.base_url,
    model: provider.model,
    apiKey: decryptSecret(provider.encrypted_api_key)
  };
}

function getWords() {
  const db = readDb();
  return [...db.words].sort((left, right) => new Date(right.updated_at) - new Date(left.updated_at));
}

function getWordById(wordId) {
  return getWords().find((word) => word.id === wordId) || null;
}

function findWordByTerm(term) {
  const normalized = normalizeText(term);
  return getWords().find((word) => normalizeText(word.term) === normalized) || null;
}

function buildStoredWord(card, source = {}) {
  const now = new Date();
  const base = withGeneratedIllustration(card);
  return {
    id: uid('word'),
    term_normalized: normalizeText(base.term),
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
    last_quality: null,
    last_rating: null,
    lapses: 0,
    progress_state: 'learning',
    archived: false,
    ...base
  };
}

function saveWordCard(card, source = {}) {
  const validation = validateWordCard(card);
  if (!validation.ok) {
    throw createAppError('INVALID_AI_RESPONSE', validation.error, 422);
  }

  const db = readDb();
  const existing = db.words.find((word) => normalizeText(word.term) === normalizeText(validation.value.term));
  if (existing) {
    return existing;
  }

  const record = buildStoredWord({ ...validation.value, image_svg: card.image_svg }, source);
  db.words.unshift(record);
  writeDb(db);
  return record;
}

function buildEditableCard(existing, patch) {
  const candidate = {
    term: patch.term === undefined ? existing.term : patch.term,
    definition: patch.definition === undefined ? existing.definition : patch.definition,
    nuances: patch.nuances === undefined ? existing.nuances : patch.nuances,
    phonetics_us: patch.phonetics_us === undefined ? existing.phonetics_us : patch.phonetics_us,
    part_of_speech: patch.part_of_speech === undefined ? existing.part_of_speech : patch.part_of_speech,
    synonyms: patch.synonyms === undefined ? existing.synonyms : patch.synonyms,
    antonyms: patch.antonyms === undefined ? existing.antonyms : patch.antonyms,
    examples: patch.examples === undefined ? existing.examples : patch.examples,
    image_prompt: patch.image_prompt === undefined ? existing.image_prompt : patch.image_prompt,
    image_svg: patch.image_svg === undefined ? existing.image_svg : patch.image_svg
  };

  const validation = validateWordCard(candidate);
  if (!validation.ok) {
    throw createAppError('INVALID_AI_RESPONSE', validation.error, 422);
  }

  return withGeneratedIllustration({
    ...validation.value,
    image_svg: candidate.image_svg
  });
}

function updateWord(wordId, patch) {
  const db = readDb();
  const index = db.words.findIndex((word) => word.id === wordId);
  if (index === -1) {
    throw createAppError('NOT_FOUND', 'Word not found.', 404);
  }

  const existing = db.words[index];
  const baseCard = buildEditableCard(existing, patch);
  const nextNormalized = normalizeText(baseCard.term);
  const duplicate = db.words.find((word) => word.id !== wordId && normalizeText(word.term) === nextNormalized);
  if (duplicate) {
    throw createAppError('BAD_REQUEST', 'Another saved card already uses this term.', 409);
  }

  const next = {
    ...existing,
    ...patch,
    ...baseCard,
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

function addImportLog(payload) {
  const db = readDb();
  const entry = {
    id: uid('import'),
    created_at: nowIso(),
    ...payload
  };
  db.imports.unshift(entry);
  db.imports = db.imports.slice(0, 40);
  writeDb(db);
  return entry;
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
  const settings = getSettings();
  const profile = getProfile();
  const stats = buildStats();
  return {
    app_name: 'WordForge',
    accent_mode: 'American English',
    google_oauth: {
      client_id: String(process.env.GOOGLE_OAUTH_CLIENT_ID || '').trim(),
      scope: 'https://www.googleapis.com/auth/drive.readonly'
    },
    settings: getPublicSettings(settings),
    profile,
    stats,
    imports: readDb().imports.slice(0, 5)
  };
}

module.exports = {
  getSettings,
  getPublicSettings,
  saveSettings,
  saveProfile,
  getProfile,
  getCredentials,
  getWords,
  getWordById,
  findWordByTerm,
  saveWordCard,
  updateWord,
  deleteWord,
  addReviewEvent,
  addImportLog,
  buildStats,
  getBootstrap
};
