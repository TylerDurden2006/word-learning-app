const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const ROOT_DIR = path.resolve(__dirname);
const DATA_DIR = process.env.WORD_FORGE_DATA_DIR
  ? path.resolve(process.env.WORD_FORGE_DATA_DIR)
  : path.join(ROOT_DIR, 'data');
const DB_PATH = process.env.WORD_FORGE_DB_PATH
  ? path.resolve(process.env.WORD_FORGE_DB_PATH)
  : path.join(DATA_DIR, 'db.json');

const DEFAULT_PROFILE = {
  learner_name: 'Learner',
  accent: 'American English',
  daily_goal: 12
};

const DEFAULT_REVIEW_PREFERENCES = {
  new_cards_per_day: 10,
  review_prompt_mix: 'balanced'
};

const WORD_CARD_FIELDS = [
  'term',
  'definition',
  'nuances',
  'phonetics_us',
  'part_of_speech',
  'synonyms',
  'antonyms',
  'examples',
  'visual_cue'
];

function createAppError(code, message, status = 400, details = null) {
  const error = new Error(message);
  error.code = code;
  error.status = status;
  error.details = details;
  return error;
}

function nowIso(now = new Date()) {
  return now.toISOString();
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function uid(prefix = 'id') {
  return `${prefix}_${crypto.randomUUID()}`;
}

function normalizeText(value) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s'-]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function uniqueStrings(values, limit = 50) {
  const seen = new Set();
  const items = [];

  for (const value of values || []) {
    const text = String(value || '').trim();
    if (!text) continue;
    const key = normalizeText(text);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    items.push(text);
    if (items.length >= limit) break;
  }

  return items;
}

function normalizeReviewPreferences(value) {
  const source = value && typeof value === 'object' && !Array.isArray(value) ? value : {};
  const rawNewCards = Number(source.new_cards_per_day);
  const promptMix = ['balanced', 'meaning-first', 'context-first'].includes(source.review_prompt_mix)
    ? source.review_prompt_mix
    : DEFAULT_REVIEW_PREFERENCES.review_prompt_mix;

  return {
    new_cards_per_day: Number.isInteger(rawNewCards) ? clamp(rawNewCards, 0, 50) : DEFAULT_REVIEW_PREFERENCES.new_cards_per_day,
    review_prompt_mix: promptMix
  };
}

function normalizeProfile(value) {
  const source = value && typeof value === 'object' && !Array.isArray(value) ? value : {};
  const rawGoal = Number(source.daily_goal);
  return {
    learner_name: String(source.learner_name || DEFAULT_PROFILE.learner_name).trim() || DEFAULT_PROFILE.learner_name,
    accent: 'American English',
    daily_goal: Number.isInteger(rawGoal) ? clamp(rawGoal, 1, 50) : DEFAULT_PROFILE.daily_goal
  };
}

function createEmptyDb() {
  return {
    profile: { ...DEFAULT_PROFILE },
    review_preferences: { ...DEFAULT_REVIEW_PREFERENCES },
    words: [],
    review_events: []
  };
}

function ensureDataFiles() {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  if (!fs.existsSync(DB_PATH)) {
    fs.writeFileSync(DB_PATH, JSON.stringify(createEmptyDb(), null, 2));
  }
}

function readDb() {
  ensureDataFiles();
  const parsed = JSON.parse(fs.readFileSync(DB_PATH, 'utf8'));
  return {
    profile: normalizeProfile(parsed.profile),
    review_preferences: normalizeReviewPreferences(parsed.review_preferences),
    words: Array.isArray(parsed.words) ? parsed.words : [],
    review_events: Array.isArray(parsed.review_events) ? parsed.review_events : []
  };
}

function writeDb(db) {
  ensureDataFiles();
  const payload = {
    profile: normalizeProfile(db.profile),
    review_preferences: normalizeReviewPreferences(db.review_preferences),
    words: Array.isArray(db.words) ? db.words : [],
    review_events: Array.isArray(db.review_events) ? db.review_events : []
  };
  const tempPath = `${DB_PATH}.tmp`;
  fs.writeFileSync(tempPath, JSON.stringify(payload, null, 2));
  fs.renameSync(tempPath, DB_PATH);
}

function normalizeImageAsset(value) {
  const asset = String(value || '').trim();
  if (!asset) return '';
  if (asset.includes('<script')) {
    throw createAppError('BAD_REQUEST', 'Image assets cannot include script tags.', 400);
  }
  return asset;
}

function validateWordCard(candidate) {
  if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) {
    return { ok: false, error: 'Card must be a JSON object.' };
  }

  const visualCue = candidate.visual_cue === undefined ? candidate.image_prompt : candidate.visual_cue;
  let imageAsset;
  try {
    imageAsset = normalizeImageAsset(candidate.image_asset === undefined ? candidate.image_svg : candidate.image_asset);
  } catch (error) {
    return { ok: false, error: error.message };
  }

  const sanitized = {
    term: String(candidate.term || '').trim(),
    definition: String(candidate.definition || '').trim(),
    nuances: String(candidate.nuances || '').trim(),
    phonetics_us: String(candidate.phonetics_us || '').trim(),
    part_of_speech: String(candidate.part_of_speech || '').trim(),
    synonyms: uniqueStrings(candidate.synonyms, 8),
    antonyms: uniqueStrings(candidate.antonyms, 8),
    examples: Array.isArray(candidate.examples)
      ? candidate.examples.map((item) => String(item || '').trim()).filter(Boolean)
      : [],
    visual_cue: String(visualCue || '').trim(),
    image_asset: imageAsset
  };

  for (const field of ['term', 'definition', 'nuances', 'phonetics_us', 'part_of_speech', 'visual_cue']) {
    if (!sanitized[field]) {
      return { ok: false, error: `Field "${field}" must be a non-empty string.` };
    }
  }

  if (sanitized.examples.length !== 10) {
    return { ok: false, error: 'examples must contain exactly 10 sentences.' };
  }

  if (!sanitized.synonyms.length) {
    return { ok: false, error: 'synonyms must contain at least one entry.' };
  }

  if (!sanitized.antonyms.length) {
    return { ok: false, error: 'antonyms must contain at least one entry.' };
  }

  return {
    ok: true,
    value: sanitized
  };
}

function isSvg(value) {
  return typeof value === 'string' && value.includes('<svg') && value.includes('</svg');
}

function encodeImageAsset(asset) {
  const value = String(asset || '').trim();
  if (!value) return '';
  if (isSvg(value)) {
    return `data:image/svg+xml;base64,${Buffer.from(value, 'utf8').toString('base64')}`;
  }
  return value;
}

module.exports = {
  ROOT_DIR,
  DATA_DIR,
  DB_PATH,
  DEFAULT_PROFILE,
  DEFAULT_REVIEW_PREFERENCES,
  WORD_CARD_FIELDS,
  createAppError,
  nowIso,
  clamp,
  uid,
  normalizeText,
  uniqueStrings,
  normalizeProfile,
  normalizeReviewPreferences,
  createEmptyDb,
  ensureDataFiles,
  readDb,
  writeDb,
  validateWordCard,
  encodeImageAsset
};
