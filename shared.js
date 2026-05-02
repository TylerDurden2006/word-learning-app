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
const MASTER_KEY_PATH = process.env.WORD_FORGE_MASTER_KEY_PATH
  ? path.resolve(process.env.WORD_FORGE_MASTER_KEY_PATH)
  : path.join(DATA_DIR, 'server.key');

const PROVIDER_IDS = ['custom', 'openai', 'anthropic'];
const PROVIDER_LABELS = {
  custom: 'Custom',
  openai: 'OpenAI',
  anthropic: 'Anthropic'
};

const PROVIDER_DEFAULTS = Object.freeze({
  custom: {
    base_url: '',
    model: '',
    encrypted_api_key: '',
    connection_status: 'missing',
    last_tested_at: null
  },
  openai: {
    base_url: '',
    model: '',
    encrypted_api_key: '',
    connection_status: 'missing',
    last_tested_at: null
  },
  anthropic: {
    base_url: '',
    model: '',
    encrypted_api_key: '',
    connection_status: 'missing',
    last_tested_at: null
  }
});

const DEFAULT_SETTINGS = {
  active_provider: 'custom',
  providers: cloneProviderDefaults(),
  american_accent_only: true
};

const DEFAULT_PROFILE = {
  learner_name: 'Learner',
  accent: 'American English',
  daily_goal: 12
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
  'image_prompt'
];

function cloneProviderDefaults() {
  return Object.fromEntries(
    PROVIDER_IDS.map((providerId) => [providerId, { ...PROVIDER_DEFAULTS[providerId] }])
  );
}

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

function slugify(value) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function ensureDataFiles() {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  if (!fs.existsSync(DB_PATH)) {
    fs.writeFileSync(DB_PATH, JSON.stringify(createEmptyDb(), null, 2));
  }
}

function createEmptyDb() {
  return {
    settings: normalizeSettings(DEFAULT_SETTINGS),
    profile: { ...DEFAULT_PROFILE },
    words: [],
    review_events: [],
    imports: []
  };
}

function normalizeProviderEntry(value, providerId) {
  const source = value && typeof value === 'object' ? value : {};
  return {
    ...PROVIDER_DEFAULTS[providerId],
    base_url: String(source.base_url || '').trim(),
    model: String(source.model || '').trim(),
    encrypted_api_key: String(source.encrypted_api_key || '').trim(),
    connection_status: String(source.connection_status || PROVIDER_DEFAULTS[providerId].connection_status || 'missing'),
    last_tested_at: source.last_tested_at || null
  };
}

function looksLikeLegacySettings(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value) && 'model' in value && !('providers' in value);
}

function normalizeSettings(value) {
  const defaults = {
    active_provider: DEFAULT_SETTINGS.active_provider,
    providers: cloneProviderDefaults(),
    american_accent_only: true
  };

  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return defaults;
  }

  if (looksLikeLegacySettings(value)) {
    return {
      active_provider: 'custom',
      providers: {
        ...cloneProviderDefaults(),
        custom: normalizeProviderEntry({
          base_url: value.base_url,
          model: value.model,
          encrypted_api_key: value.encrypted_api_key,
          connection_status: value.connection_status,
          last_tested_at: value.last_tested_at
        }, 'custom')
      },
      american_accent_only: true
    };
  }

  const next = {
    active_provider: PROVIDER_IDS.includes(value.active_provider) ? value.active_provider : 'custom',
    providers: cloneProviderDefaults(),
    american_accent_only: true
  };

  const rawProviders = value.providers && typeof value.providers === 'object' ? value.providers : {};
  for (const providerId of PROVIDER_IDS) {
    next.providers[providerId] = normalizeProviderEntry(rawProviders[providerId], providerId);
  }

  return next;
}

function readDb() {
  ensureDataFiles();
  const parsed = JSON.parse(fs.readFileSync(DB_PATH, 'utf8'));
  return {
    settings: normalizeSettings(parsed.settings),
    profile: { ...DEFAULT_PROFILE, ...(parsed.profile || {}) },
    words: Array.isArray(parsed.words) ? parsed.words : [],
    review_events: Array.isArray(parsed.review_events) ? parsed.review_events : [],
    imports: Array.isArray(parsed.imports) ? parsed.imports : []
  };
}

function writeDb(db) {
  ensureDataFiles();
  const payload = {
    ...db,
    settings: normalizeSettings(db.settings)
  };
  const tempPath = `${DB_PATH}.tmp`;
  fs.writeFileSync(tempPath, JSON.stringify(payload, null, 2));
  fs.renameSync(tempPath, DB_PATH);
}

function getMasterKey() {
  if (process.env.APP_MASTER_KEY) {
    return crypto.createHash('sha256').update(process.env.APP_MASTER_KEY).digest();
  }

  ensureDataFiles();
  if (!fs.existsSync(MASTER_KEY_PATH)) {
    fs.writeFileSync(MASTER_KEY_PATH, crypto.randomBytes(32).toString('base64'));
  }

  return Buffer.from(fs.readFileSync(MASTER_KEY_PATH, 'utf8').trim(), 'base64');
}

function encryptSecret(plainText) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', getMasterKey(), iv);
  const encrypted = Buffer.concat([cipher.update(String(plainText), 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${iv.toString('base64')}.${tag.toString('base64')}.${encrypted.toString('base64')}`;
}

function decryptSecret(payload) {
  const [ivBase64, tagBase64, encryptedBase64] = String(payload || '').split('.');
  if (!ivBase64 || !tagBase64 || !encryptedBase64) {
    throw createAppError('INVALID_API_KEY', 'Stored API key could not be decrypted.', 500);
  }

  const decipher = crypto.createDecipheriv('aes-256-gcm', getMasterKey(), Buffer.from(ivBase64, 'base64'));
  decipher.setAuthTag(Buffer.from(tagBase64, 'base64'));
  return Buffer.concat([decipher.update(Buffer.from(encryptedBase64, 'base64')), decipher.final()]).toString('utf8');
}

function isSvg(value) {
  return typeof value === 'string' && value.includes('<svg') && value.includes('</svg>');
}

function buildFallbackIllustration(card) {
  const seed = crypto.createHash('sha256').update(`${card.term}|${card.part_of_speech}|${card.image_prompt || ''}`).digest('hex');
  const palette = [
    `#${seed.slice(0, 6)}`,
    `#${seed.slice(6, 12)}`,
    `#${seed.slice(12, 18)}`,
    `#${seed.slice(18, 24)}`
  ];
  const safeTerm = escapeXml(card.term);
  const safeCue = escapeXml((card.antonyms || [])[0] || (card.synonyms || [])[0] || card.part_of_speech);
  const safePrompt = escapeXml((card.image_prompt || '').slice(0, 110));

  return [
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 720 480" role="img" aria-label="Word illustration">',
    '<defs>',
    '<linearGradient id="bg" x1="0%" x2="100%" y1="0%" y2="100%">',
    `<stop offset="0%" stop-color="${palette[0]}"/>`,
    `<stop offset="100%" stop-color="${palette[1]}"/>`,
    '</linearGradient>',
    '<linearGradient id="glass" x1="0%" x2="100%" y1="0%" y2="100%">',
    `<stop offset="0%" stop-color="${palette[2]}" stop-opacity="0.95"/>`,
    `<stop offset="100%" stop-color="${palette[3]}" stop-opacity="0.65"/>`,
    '</linearGradient>',
    '</defs>',
    '<rect width="720" height="480" rx="36" fill="url(#bg)"/>',
    '<circle cx="130" cy="120" r="110" fill="#ffffff" fill-opacity="0.14"/>',
    '<circle cx="595" cy="96" r="84" fill="#ffffff" fill-opacity="0.16"/>',
    '<circle cx="578" cy="356" r="126" fill="#ffffff" fill-opacity="0.12"/>',
    '<rect x="72" y="74" width="576" height="332" rx="28" fill="url(#glass)" fill-opacity="0.88" stroke="#ffffff" stroke-opacity="0.24"/>',
    '<path d="M138 328c68-112 133-168 194-168 55 0 108 30 162 95 36 42 64 61 86 61 15 0 33-7 54-22v74H138z" fill="#ffffff" fill-opacity="0.2"/>',
    '<path d="M176 276c34-61 74-91 120-91 48 0 84 18 109 56 19 29 31 45 37 49 18 15 45 22 82 22 22 0 44-3 66-10" fill="none" stroke="#ffffff" stroke-opacity="0.58" stroke-width="12" stroke-linecap="round"/>',
    `<text x="112" y="170" fill="#ffffff" fill-opacity="0.92" font-family="Georgia, 'Times New Roman', serif" font-size="54" font-style="italic">${safeTerm}</text>`,
    `<text x="116" y="214" fill="#ffffff" fill-opacity="0.74" font-family="'Segoe UI', Arial, sans-serif" font-size="18" letter-spacing="3">${escapeXml(card.part_of_speech.toUpperCase())}</text>`,
    `<text x="114" y="362" fill="#ffffff" fill-opacity="0.88" font-family="'Segoe UI', Arial, sans-serif" font-size="15">${safePrompt}</text>`,
    `<text x="114" y="390" fill="#ffffff" fill-opacity="0.72" font-family="'Segoe UI', Arial, sans-serif" font-size="14">contrast cue: ${safeCue}</text>`,
    '</svg>'
  ].join('');
}

function escapeXml(value) {
  return String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function validateWordCard(candidate) {
  if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) {
    return { ok: false, error: 'Response must be a JSON object.' };
  }

  const missing = WORD_CARD_FIELDS.filter((field) => !(field in candidate));
  if (missing.length) {
    return { ok: false, error: `Missing required fields: ${missing.join(', ')}` };
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
    image_prompt: String(candidate.image_prompt || '').trim()
  };

  for (const field of ['term', 'definition', 'nuances', 'phonetics_us', 'part_of_speech', 'image_prompt']) {
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

function withGeneratedIllustration(card) {
  return {
    ...card,
    image_svg: isSvg(card.image_svg) ? card.image_svg : buildFallbackIllustration(card)
  };
}

function encodeSvgDataUri(svg) {
  return `data:image/svg+xml;base64,${Buffer.from(String(svg || ''), 'utf8').toString('base64')}`;
}

module.exports = {
  ROOT_DIR,
  DATA_DIR,
  DB_PATH,
  MASTER_KEY_PATH,
  PROVIDER_IDS,
  PROVIDER_LABELS,
  PROVIDER_DEFAULTS,
  DEFAULT_SETTINGS,
  DEFAULT_PROFILE,
  WORD_CARD_FIELDS,
  createAppError,
  nowIso,
  clamp,
  uid,
  normalizeText,
  uniqueStrings,
  slugify,
  cloneProviderDefaults,
  normalizeSettings,
  createEmptyDb,
  ensureDataFiles,
  readDb,
  writeDb,
  encryptSecret,
  decryptSecret,
  validateWordCard,
  withGeneratedIllustration,
  buildFallbackIllustration,
  encodeSvgDataUri
};
