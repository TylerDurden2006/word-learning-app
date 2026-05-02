const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const { URL } = require('node:url');

const { PROVIDER_IDS, createAppError } = require('./shared');
const { getDueQueue, sm2 } = require('./review');
const { testProviderConnection, generateWordCardWithAI } = require('./providers');
const { extractWordsFromText, fetchGoogleDocText } = require('./importer');
const {
  getBootstrap,
  getSettings,
  getPublicSettings,
  saveSettings,
  saveProfile,
  getCredentials,
  getWords,
  getWordById,
  findWordByTerm,
  saveWordCard,
  updateWord,
  deleteWord,
  addReviewEvent,
  addImportLog,
  buildStats
} = require('./store');

const PORT = Number(process.env.PORT || 3000);
const PUBLIC_DIR = path.join(__dirname, 'public');
const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.mjs': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml'
};

function sendJson(res, statusCode, payload) {
  res.writeHead(statusCode, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store'
  });
  res.end(JSON.stringify(payload));
}

function sendError(res, error) {
  sendJson(res, error.status || 500, {
    error: {
      code: error.code || 'SERVER_ERROR',
      message: error.message || 'Unexpected server error.',
      details: error.details || null
    }
  });
}

function readRequestBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', (chunk) => chunks.push(chunk));
    req.on('end', () => {
      const raw = Buffer.concat(chunks).toString('utf8');
      if (!raw) {
        resolve({});
        return;
      }
      try {
        resolve(JSON.parse(raw));
      } catch {
        reject(createAppError('BAD_REQUEST', 'Request body must be valid JSON.', 400));
      }
    });
    req.on('error', reject);
  });
}

function resolveWordId(pathname) {
  const match = pathname.match(/^\/api\/words\/([^/]+)$/);
  return match ? match[1] : null;
}

function serveStaticFile(res, pathname) {
  const requestedPath = pathname === '/' ? '/index.html' : pathname;
  const filePath = path.join(PUBLIC_DIR, requestedPath);
  const normalized = path.normalize(filePath);

  if (!normalized.startsWith(PUBLIC_DIR)) {
    return false;
  }

  if (!fs.existsSync(normalized) || fs.statSync(normalized).isDirectory()) {
    const indexPath = path.join(PUBLIC_DIR, 'index.html');
    if (!fs.existsSync(indexPath)) return false;
    res.writeHead(200, { 'content-type': MIME_TYPES['.html'] });
    res.end(fs.readFileSync(indexPath));
    return true;
  }

  const ext = path.extname(normalized).toLowerCase();
  res.writeHead(200, { 'content-type': MIME_TYPES[ext] || 'application/octet-stream' });
  fs.createReadStream(normalized).pipe(res);
  return true;
}

function assertProviderId(providerId) {
  if (!PROVIDER_IDS.includes(providerId)) {
    throw createAppError('BAD_REQUEST', 'Unknown provider selected.', 400);
  }
}

function resolveProviderPayload(body, options = {}) {
  const currentSettings = getSettings();
  const provider = String(body.provider || body.active_provider || currentSettings.active_provider || 'custom').trim();
  assertProviderId(provider);

  const activeProvider = body.active_provider === undefined
    ? currentSettings.active_provider
    : String(body.active_provider || '').trim();
  assertProviderId(activeProvider);

  const savedProvider = currentSettings.providers[provider];
  const baseUrl = String(body.base_url === undefined ? savedProvider.base_url || '' : body.base_url || '').trim();
  const model = String(body.model === undefined ? savedProvider.model || '' : body.model || '').trim();
  const typedKey = String(body.api_key || '').trim();
  const apiKey = typedKey || (savedProvider.encrypted_api_key ? getCredentials(provider).apiKey : '');

  if (!model && options.requireModel !== false) {
    throw createAppError('BAD_REQUEST', 'Model is required.', 400);
  }
  if (!apiKey) {
    throw createAppError('BAD_REQUEST', 'API key is required.', 400);
  }

  if (options.requireTypedKey && !typedKey) {
    throw createAppError('BAD_REQUEST', 'Enter an API key to save this provider.', 400);
  }

  return {
    provider,
    activeProvider,
    baseUrl,
    model,
    apiKey,
    typedKey
  };
}

async function handleSettingsSave(req, res) {
  const body = await readRequestBody(req);
  const resolved = resolveProviderPayload(body);

  let verification = {
    ok: false,
    message: 'Settings were not saved because verification did not complete.'
  };

  try {
    const testResult = await testProviderConnection({
      provider: resolved.provider,
      baseUrl: resolved.baseUrl,
      model: resolved.model,
      apiKey: resolved.apiKey
    });
    if (!testResult.models.includes(resolved.model)) {
      throw createAppError('BAD_REQUEST', 'Choose one of the models detected for this API key before saving.', 400);
    }
    saveSettings({
      provider: resolved.provider,
      active_provider: resolved.activeProvider,
      base_url: resolved.baseUrl,
      model: resolved.model,
      api_key: resolved.typedKey || undefined,
      connection_status: 'connected',
      last_tested_at: new Date().toISOString()
    });
    verification = {
      ok: true,
      message: `Settings saved and verified. Detected ${testResult.models.length} available models.`,
      models: testResult.models
    };
  } catch (error) {
    verification = {
      ok: false,
      message: error.message || 'Settings were saved, but verification failed.'
    };
  }

  sendJson(res, 200, {
    settings: getPublicSettings(),
    verification
  });
}

async function handleSettingsTest(req, res) {
  const body = await readRequestBody(req);
  const resolved = resolveProviderPayload(body, { requireModel: false });

  const result = await testProviderConnection({
    provider: resolved.provider,
    baseUrl: resolved.baseUrl,
    model: resolved.model,
    apiKey: resolved.apiKey
  });

  sendJson(res, 200, {
    ...result,
    persisted: false
  });
}

async function handleWordGeneration(req, res) {
  const body = await readRequestBody(req);
  const term = String(body.term || '').trim();
  if (!term) {
    throw createAppError('BAD_REQUEST', 'Enter a word or phrase to generate.', 400);
  }

  const credentials = getCredentials();
  const result = await generateWordCardWithAI(credentials, term);
  sendJson(res, 200, result);
}

async function handleImportGoogleDoc(req, res) {
  const body = await readRequestBody(req);
  const docUrl = String(body.url || '').trim();
  const accessToken = String(body.access_token || '').trim();
  const credentials = getCredentials();

  let text;
  try {
    text = await fetchGoogleDocText(docUrl, accessToken);
  } catch (error) {
    if (String(error.code || '').startsWith('GOOGLE_DOC') || error.code === 'GOOGLE_OAUTH_REQUIRED') {
      sendJson(res, 200, {
        requested_terms: [],
        imported: [],
        skipped: [],
        failed: [],
        import_error: {
          code: error.code,
          message: error.message
        },
        stats: buildStats()
      });
      return;
    }
    throw error;
  }

  const terms = extractWordsFromText(text, 25);
  if (!terms.length) {
    sendJson(res, 200, {
      requested_terms: [],
      imported: [],
      skipped: [],
      failed: [],
      import_error: {
        code: 'GOOGLE_DOC_NO_TERMS',
        message: 'The Google Doc was readable, but no importable words were found.'
      },
      stats: buildStats()
    });
    return;
  }

  const imported = [];
  const skipped = [];
  const failed = [];

  for (const term of terms) {
    const existing = findWordByTerm(term);
    if (existing) {
      skipped.push({ term, reason: 'Already in library' });
      continue;
    }

    try {
      const generated = await generateWordCardWithAI(credentials, term);
      const saved = saveWordCard(generated.card, {
        type: 'google-doc',
        label: docUrl
      });
      imported.push(saved);
    } catch (error) {
      failed.push({
        term,
        reason: error.message || 'Import failed'
      });
    }
  }

  addImportLog({
    source_url: docUrl,
    requested_terms: terms,
    imported_count: imported.length,
    skipped_count: skipped.length,
    failed_count: failed.length
  });

  sendJson(res, 200, {
    requested_terms: terms,
    imported,
    skipped,
    failed,
    import_error: null,
    stats: buildStats()
  });
}

async function handleApiRequest(req, res, url) {
  const pathname = url.pathname;

  if (req.method === 'GET' && pathname === '/api/bootstrap') {
    const words = getWords();
    sendJson(res, 200, {
      ...getBootstrap(),
      words,
      due_queue: getDueQueue(words)
    });
    return true;
  }

  if (req.method === 'GET' && pathname === '/api/words') {
    const words = getWords();
    sendJson(res, 200, {
      words,
      stats: buildStats()
    });
    return true;
  }

  if (req.method === 'GET' && pathname === '/api/review-queue') {
    sendJson(res, 200, getDueQueue(getWords()));
    return true;
  }

  if (req.method === 'POST' && pathname === '/api/settings') {
    await handleSettingsSave(req, res);
    return true;
  }

  if (req.method === 'POST' && pathname === '/api/settings/test') {
    await handleSettingsTest(req, res);
    return true;
  }

  if (req.method === 'POST' && pathname === '/api/profile') {
    const body = await readRequestBody(req);
    sendJson(res, 200, { profile: saveProfile(body) });
    return true;
  }

  if (req.method === 'POST' && pathname === '/api/words/generate') {
    await handleWordGeneration(req, res);
    return true;
  }

  if (req.method === 'POST' && pathname === '/api/words') {
    const body = await readRequestBody(req);
    const saved = saveWordCard(body.card || body, body.source || {});
    sendJson(res, 200, { word: saved, stats: buildStats() });
    return true;
  }

  if (req.method === 'POST' && pathname === '/api/review') {
    const body = await readRequestBody(req);
    const wordId = String(body.word_id || '').trim();
    const rating = String(body.rating || '').trim();
    const word = getWordById(wordId);

    if (!word) {
      throw createAppError('NOT_FOUND', 'Word not found.', 404);
    }
    if (!['Again', 'Hard', 'Good', 'Easy'].includes(rating)) {
      throw createAppError('BAD_REQUEST', 'Rating must be Again, Hard, Good, or Easy.', 400);
    }

    const outcome = sm2(word, rating);
    const updatedWord = updateWord(word.id, outcome.updatedWord);
    addReviewEvent(outcome.event);

    sendJson(res, 200, {
      word: updatedWord,
      review_event: outcome.event,
      due_queue: getDueQueue(getWords()),
      stats: buildStats()
    });
    return true;
  }

  if (req.method === 'POST' && pathname === '/api/import-google-doc') {
    await handleImportGoogleDoc(req, res);
    return true;
  }

  const wordId = resolveWordId(pathname);
  if (wordId && req.method === 'PUT') {
    const body = await readRequestBody(req);
    const updated = updateWord(wordId, body.card || body);
    sendJson(res, 200, { word: updated, stats: buildStats() });
    return true;
  }

  if (wordId && req.method === 'DELETE') {
    sendJson(res, 200, { deleted: true, word: deleteWord(wordId), stats: buildStats() });
    return true;
  }

  return false;
}

function createServer() {
  return http.createServer(async (req, res) => {
    try {
      const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
      const handledApi = await handleApiRequest(req, res, url);
      if (handledApi) return;
      if (serveStaticFile(res, url.pathname)) return;
      throw createAppError('NOT_FOUND', 'Not found.', 404);
    } catch (error) {
      sendError(res, error);
    }
  });
}

if (require.main === module) {
  createServer().listen(PORT, () => {
    console.log(`WordForge running on http://localhost:${PORT}`);
  });
}

module.exports = {
  createServer
};
