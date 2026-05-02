const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const assert = require('node:assert/strict');
const { pathToFileURL } = require('node:url');

const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'wordforge-tests-'));
process.env.WORD_FORGE_DATA_DIR = path.join(tempRoot, 'data');
process.env.WORD_FORGE_DB_PATH = path.join(process.env.WORD_FORGE_DATA_DIR, 'db.json');
process.env.WORD_FORGE_MASTER_KEY_PATH = path.join(process.env.WORD_FORGE_DATA_DIR, 'server.key');
process.env.GOOGLE_OAUTH_CLIENT_ID = 'google-client-for-tests';

const {
  createEmptyDb,
  writeDb,
  readDb,
  normalizeSettings,
  validateWordCard,
  encryptSecret,
  decryptSecret,
  withGeneratedIllustration
} = require('./shared');
const { sm2, getDueQueue } = require('./review');
const { extractGoogleDocId, extractWordsFromText, fetchGoogleDocText } = require('./importer');
const { listProviderModels, testProviderConnection } = require('./providers');
const { createServer } = require('./server');
const { buildConvexSnapshot } = require('./scripts/convex-migration-utils.cjs');

function resetDb() {
  writeDb(createEmptyDb());
}

function makeWordCard(term = 'circumspect') {
  return {
    term,
    definition: 'careful to consider all risks before acting or speaking',
    nuances: 'Often suggests measured caution rather than fear, especially in formal or strategic contexts.',
    phonetics_us: '/ser-kuhm-spekt/',
    part_of_speech: 'adjective',
    synonyms: ['cautious', 'prudent', 'wary'],
    antonyms: ['rash', 'reckless'],
    examples: Array.from({ length: 10 }, (_, index) => `Example sentence ${index + 1}`),
    image_prompt: 'A strategist leaning over a map before making a delicate move'
  };
}

function openAiCompatibleResponse(payloadText) {
  return new Response(JSON.stringify({
    choices: [{ message: { content: payloadText } }],
    usage: { prompt_tokens: 11, completion_tokens: 22, total_tokens: 33 },
    model: 'stub-openai-model'
  }), {
    status: 200,
    headers: { 'content-type': 'application/json' }
  });
}

function modelsResponse(models) {
  return new Response(JSON.stringify({
    data: models.map((id) => ({ id }))
  }), {
    status: 200,
    headers: { 'content-type': 'application/json' }
  });
}

function anthropicResponse(payloadText) {
  return new Response(JSON.stringify({
    content: [{ type: 'text', text: payloadText }],
    usage: { input_tokens: 8, output_tokens: 13 },
    model: 'stub-anthropic-model'
  }), {
    status: 200,
    headers: { 'content-type': 'application/json' }
  });
}

async function withServer(run) {
  const server = createServer();
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  const baseUrl = `http://127.0.0.1:${address.port}`;

  try {
    return await run(baseUrl);
  } finally {
    await new Promise((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
  }
}

function stubFetch(routes) {
  const realFetch = global.fetch;
  global.fetch = async (url, options = {}) => {
    const stringUrl = typeof url === 'string' ? url : String(url);
    for (const route of routes) {
      if (route.match(stringUrl, options)) {
        return route.respond(stringUrl, options);
      }
    }
    return realFetch(url, options);
  };

  return () => {
    global.fetch = realFetch;
  };
}

function liveProviderConfigsFromEnv() {
  const configs = [];
  if (process.env.OPENAI_API_KEY) {
    configs.push({
      name: 'OpenAI',
      provider: 'openai',
      apiKey: process.env.OPENAI_API_KEY,
      model: process.env.OPENAI_MODEL || ''
    });
  }
  if (process.env.ANTHROPIC_API_KEY) {
    configs.push({
      name: 'Anthropic',
      provider: 'anthropic',
      apiKey: process.env.ANTHROPIC_API_KEY,
      model: process.env.ANTHROPIC_MODEL || ''
    });
  }
  if (process.env.CUSTOM_API_KEY && process.env.CUSTOM_BASE_URL) {
    configs.push({
      name: 'Custom OpenAI-compatible',
      provider: 'custom',
      baseUrl: process.env.CUSTOM_BASE_URL,
      apiKey: process.env.CUSTOM_API_KEY,
      model: process.env.CUSTOM_MODEL || ''
    });
  }
  return configs;
}

test.beforeEach(() => {
  resetDb();
});

test('buildConvexSnapshot treats legacy incompatible db shape as empty app data', () => {
  const snapshot = buildConvexSnapshot({
    users: [],
    wordCards: [],
    reviewSessions: [],
    settings: { model: 'legacy-model', encrypted_api_key: 'encrypted' }
  }, require('./shared'));

  assert.equal(snapshot.settings.active_provider, 'custom');
  assert.equal(snapshot.settings.providers.custom.model, 'legacy-model');
  assert.deepEqual(snapshot.words, []);
  assert.deepEqual(snapshot.review_events, []);
  assert.deepEqual(snapshot.imports, []);
});

test('buildConvexSnapshot preserves current-format word ids and filters invalid cards', () => {
  const valid = {
    ...makeWordCard('assiduous'),
    id: 'word_existing',
    term_normalized: 'assiduous',
    source_type: 'manual',
    source_label: 'Manual entry',
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    next_review_at: new Date().toISOString(),
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
    archived: false
  };

  const snapshot = buildConvexSnapshot({
    words: [valid, { id: 'bad', term: 'bad' }],
    review_events: [{ id: 'review_1' }, { rating: 'Good' }],
    imports: [{ id: 'import_1' }, { source_url: 'missing id' }]
  }, require('./shared'));

  assert.equal(snapshot.words.length, 1);
  assert.equal(snapshot.words[0].id, 'word_existing');
  assert.deepEqual(snapshot.review_events, [{ id: 'review_1' }]);
  assert.deepEqual(snapshot.imports, [{ id: 'import_1' }]);
});

test('validateWordCard accepts the WordForge schema', () => {
  const result = validateWordCard(makeWordCard());
  assert.equal(result.ok, true);
  assert.equal(result.value.examples.length, 10);
});

test('encryptSecret round-trips provider keys', () => {
  const encrypted = encryptSecret('sk-test-123');
  assert.notEqual(encrypted, 'sk-test-123');
  assert.equal(decryptSecret(encrypted), 'sk-test-123');
});

test('withGeneratedIllustration falls back when svg is missing', () => {
  const card = withGeneratedIllustration(makeWordCard('lucid'));
  assert.match(card.image_svg, /<svg/);
});

test('normalizeSettings migrates legacy flat settings into custom provider storage', () => {
  const migrated = normalizeSettings({
    base_url: 'https://provider.example/v1',
    model: 'legacy-model',
    encrypted_api_key: 'ciphertext',
    connection_status: 'connected',
    last_tested_at: '2026-04-20T00:00:00.000Z'
  });

  assert.equal(migrated.active_provider, 'custom');
  assert.equal(migrated.providers.custom.base_url, 'https://provider.example/v1');
  assert.equal(migrated.providers.custom.model, 'legacy-model');
  assert.equal(migrated.providers.custom.encrypted_api_key, 'ciphertext');
  assert.equal(migrated.providers.custom.connection_status, 'connected');
});

test('sm2 resets repetitions on Again and grows intervals on Good', () => {
  const baseWord = {
    id: 'word_1',
    term: 'lucid',
    next_review_at: '2026-04-20T10:00:00.000Z',
    repetitions: 2,
    interval_days: 6,
    ease_factor: 2.5,
    review_count: 2,
    lapses: 0
  };

  const success = sm2(baseWord, 'Good', new Date('2026-04-20T10:00:00.000Z'));
  assert.equal(success.updatedWord.repetitions, 3);
  assert.equal(success.updatedWord.interval_days, 15);

  const failure = sm2(baseWord, 'Again', new Date('2026-04-20T10:00:00.000Z'));
  assert.equal(failure.updatedWord.repetitions, 0);
  assert.equal(failure.updatedWord.interval_days, 1);
  assert.equal(failure.updatedWord.lapses, 1);
});

test('getDueQueue sorts due words by urgency', () => {
  const now = new Date('2026-04-20T10:00:00.000Z');
  const queue = getDueQueue([
    {
      id: 'a',
      term: 'precise',
      part_of_speech: 'adjective',
      phonetics_us: '/pri-sise/',
      examples: ['x'],
      next_review_at: '2026-04-20T09:00:00.000Z',
      progress_state: 'learning',
      ease_factor: 2.1,
      lapses: 1,
      review_count: 0,
      definition: 'x',
      nuances: 'x',
      synonyms: ['exact'],
      antonyms: ['vague']
    },
    {
      id: 'b',
      term: 'ornate',
      part_of_speech: 'adjective',
      phonetics_us: '/or-nayt/',
      examples: ['x'],
      next_review_at: '2026-04-20T09:30:00.000Z',
      progress_state: 'mastered',
      ease_factor: 2.8,
      lapses: 0,
      review_count: 0,
      definition: 'x',
      nuances: 'x',
      synonyms: ['decorative'],
      antonyms: ['plain']
    }
  ], now);

  assert.equal(queue.count, 2);
  assert.equal(queue.items[0].term, 'precise');
});

test('extractGoogleDocId and extractWordsFromText parse imports cleanly', () => {
  assert.equal(
    extractGoogleDocId('https://docs.google.com/document/d/abc123_DEF-456/edit?usp=sharing'),
    'abc123_DEF-456'
  );

  const words = extractWordsFromText(`
    1. lucid
    2. take ownership
    3. circumspect, oblique
    this line is much too long to be considered a single vocabulary entry for import
    lucid
  `);

  assert.deepEqual(words, ['lucid', 'take ownership', 'circumspect', 'oblique']);
});

test('fetchGoogleDocText maps Google auth failures', async () => {
  const restoreFetch = stubFetch([
    {
      match: (url) => url.includes('www.googleapis.com/drive/v3/files/abc123/export'),
      respond: () => Promise.resolve(new Response('expired', { status: 401 }))
    }
  ]);

  await assert.rejects(
    () => fetchGoogleDocText('https://docs.google.com/document/d/abc123/edit', 'token-1'),
    (error) => error.code === 'GOOGLE_DOC_AUTH_EXPIRED'
  );

  restoreFetch();
});

test('POST /api/settings/test probes a custom provider without persistence', async () => {
  const restoreFetch = stubFetch([
    {
      match: (url) => url.includes('provider.example') && url.endsWith('/models'),
      respond: () => Promise.resolve(modelsResponse(['test-model', 'backup-model']))
    }
  ]);

  await withServer(async (baseUrl) => {
    const response = await fetch(`${baseUrl}/api/settings/test`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        provider: 'custom',
        active_provider: 'custom',
        base_url: 'https://provider.example/v1',
        model: 'test-model',
        api_key: 'sk-probe'
      })
    });

    assert.equal(response.status, 200);
    const payload = await response.json();
    assert.equal(payload.persisted, false);
    assert.deepEqual(payload.models, ['backup-model', 'test-model']);

    const bootstrap = await fetch(`${baseUrl}/api/bootstrap`).then((res) => res.json());
    assert.equal(bootstrap.settings.active_provider, 'custom');
    assert.equal(bootstrap.settings.providers.custom.has_key, false);
  });

  restoreFetch();
});

test('listProviderModels sends provider-specific auth headers and normalizes models', async () => {
  const seen = [];
  const restoreFetch = stubFetch([
    {
      match: (url) => url.includes('api.openai.com') && url.endsWith('/models'),
      respond: (_url, options) => {
        seen.push({ provider: 'openai', headers: options.headers });
        return Promise.resolve(modelsResponse(['z-model', 'a-model', 'a-model']));
      }
    },
    {
      match: (url) => url.includes('api.anthropic.com') && url.endsWith('/v1/models'),
      respond: (_url, options) => {
        seen.push({ provider: 'anthropic', headers: options.headers });
        return Promise.resolve(modelsResponse(['claude-3-5-sonnet', 'claude-3-haiku']));
      }
    }
  ]);

  const openAiModels = await listProviderModels({
    provider: 'openai',
    apiKey: 'sk-openai'
  });
  const anthropicModels = await listProviderModels({
    provider: 'anthropic',
    apiKey: 'sk-ant'
  });

  assert.deepEqual(openAiModels, ['a-model', 'z-model']);
  assert.deepEqual(anthropicModels, ['claude-3-5-sonnet', 'claude-3-haiku']);
  assert.equal(seen[0].headers.authorization, 'Bearer sk-openai');
  assert.equal(seen[1].headers['x-api-key'], 'sk-ant');
  assert.equal(seen[1].headers['anthropic-version'], '2023-06-01');

  restoreFetch();
});

test('provider model probing maps rejected API keys to INVALID_API_KEY', async () => {
  const restoreFetch = stubFetch([
    {
      match: (url) => url.includes('api.openai.com') && url.endsWith('/models'),
      respond: () => Promise.resolve(new Response(JSON.stringify({
        error: { message: 'Incorrect API key provided.' }
      }), {
        status: 401,
        headers: { 'content-type': 'application/json' }
      }))
    }
  ]);

  await assert.rejects(
    () => testProviderConnection({ provider: 'openai', apiKey: 'sk-bad' }),
    (error) => error.code === 'INVALID_API_KEY' && error.status === 401
  );

  restoreFetch();
});

test('POST /api/settings refuses to save a model the API key cannot access', async () => {
  const restoreFetch = stubFetch([
    {
      match: (url) => url.includes('api.openai.com') && url.endsWith('/models'),
      respond: () => Promise.resolve(modelsResponse(['gpt-4.1-mini']))
    }
  ]);

  await withServer(async (baseUrl) => {
    const response = await fetch(`${baseUrl}/api/settings`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        provider: 'openai',
        active_provider: 'openai',
        model: 'not-granted-model',
        api_key: 'sk-openai'
      })
    });
    const payload = await response.json();

    assert.equal(response.status, 200);
    assert.equal(payload.verification.ok, false);
    assert.match(payload.verification.message, /Choose one of the models detected/);
    assert.equal(payload.settings.providers.openai.has_key, false);
  });

  restoreFetch();
});

test('POST /api/settings persists encrypted custom provider settings', async () => {
  const restoreFetch = stubFetch([
    {
      match: (url) => url.includes('provider.example') && url.endsWith('/models'),
      respond: () => Promise.resolve(modelsResponse(['test-model']))
    }
  ]);

  await withServer(async (baseUrl) => {
    const response = await fetch(`${baseUrl}/api/settings`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        provider: 'custom',
        active_provider: 'custom',
        base_url: 'https://provider.example/v1',
        model: 'test-model',
        api_key: 'sk-saved'
      })
    });

    assert.equal(response.status, 200);
    const payload = await response.json();
    assert.equal(payload.settings.active_provider, 'custom');
    assert.equal(payload.settings.providers.custom.has_key, true);
    assert.equal(payload.settings.providers.custom.connection_status, 'connected');

    const db = readDb();
    assert.notEqual(db.settings.providers.custom.encrypted_api_key, 'sk-saved');
  });

  restoreFetch();
});

test('settings can remember multiple providers while switching the active provider', async () => {
  const restoreFetch = stubFetch([
    {
      match: (url) => url.includes('provider.example') && url.endsWith('/models'),
      respond: () => Promise.resolve(modelsResponse(['custom-model']))
    },
    {
      match: (url) => url.includes('api.openai.com') && url.endsWith('/models'),
      respond: () => Promise.resolve(modelsResponse(['gpt-4.1-mini']))
    }
  ]);

  await withServer(async (baseUrl) => {
    await fetch(`${baseUrl}/api/settings`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        provider: 'custom',
        active_provider: 'custom',
        base_url: 'https://provider.example/v1',
        model: 'custom-model',
        api_key: 'sk-custom'
      })
    });

    await fetch(`${baseUrl}/api/settings`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        provider: 'openai',
        active_provider: 'openai',
        model: 'gpt-4.1-mini',
        api_key: 'sk-openai'
      })
    });

    const bootstrap = await fetch(`${baseUrl}/api/bootstrap`).then((res) => res.json());
    assert.equal(bootstrap.settings.active_provider, 'openai');
    assert.equal(bootstrap.settings.providers.custom.model, 'custom-model');
    assert.equal(bootstrap.settings.providers.custom.has_key, true);
    assert.equal(bootstrap.settings.providers.openai.model, 'gpt-4.1-mini');
    assert.equal(bootstrap.settings.providers.openai.has_key, true);
  });

  restoreFetch();
});

test('POST /api/words/generate uses the active custom provider', async () => {
  const restoreFetch = stubFetch([
    {
      match: (url) => url.includes('provider.example') && url.endsWith('/models'),
      respond: () => Promise.resolve(modelsResponse(['custom-model']))
    },
    {
      match: (url, options) => url.includes('provider.example') && url.endsWith('/chat/completions'),
      respond: (_url, options) => {
        const body = JSON.parse(options.body);
        const system = body.messages?.[0]?.content || '';
        if (system.includes('compact SVG illustrations')) {
          return Promise.resolve(openAiCompatibleResponse('<svg xmlns="http://www.w3.org/2000/svg"></svg>'));
        }
        return Promise.resolve(openAiCompatibleResponse(JSON.stringify(makeWordCard('lucid'))));
      }
    }
  ]);

  await withServer(async (baseUrl) => {
    await fetch(`${baseUrl}/api/settings`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        provider: 'custom',
        active_provider: 'custom',
        base_url: 'https://provider.example/v1',
        model: 'custom-model',
        api_key: 'sk-custom'
      })
    });

    const response = await fetch(`${baseUrl}/api/words/generate`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ term: 'lucid' })
    });
    const payload = await response.json();

    assert.equal(response.status, 200);
    assert.equal(payload.provider, 'custom');
    assert.equal(payload.card.term, 'lucid');
    assert.match(payload.card.image_svg, /<svg/);
  });

  restoreFetch();
});

test('POST /api/words/generate uses the active anthropic provider', async () => {
  const restoreFetch = stubFetch([
    {
      match: (url) => url.includes('api.anthropic.com') && url.endsWith('/v1/models'),
      respond: () => Promise.resolve(modelsResponse(['claude-sonnet-4-20250514']))
    },
    {
      match: (url) => url.includes('api.anthropic.com') && url.endsWith('/v1/messages'),
      respond: (_url, options) => {
        const body = JSON.parse(options.body);
        const system = body.system || '';
        if (system.includes('compact SVG illustrations')) {
          return Promise.resolve(anthropicResponse('<svg xmlns="http://www.w3.org/2000/svg"></svg>'));
        }
        return Promise.resolve(anthropicResponse(JSON.stringify(makeWordCard('luminous'))));
      }
    }
  ]);

  await withServer(async (baseUrl) => {
    await fetch(`${baseUrl}/api/settings`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        provider: 'anthropic',
        active_provider: 'anthropic',
        model: 'claude-sonnet-4-20250514',
        api_key: 'sk-ant-test'
      })
    });

    const response = await fetch(`${baseUrl}/api/words/generate`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ term: 'luminous' })
    });
    const payload = await response.json();

    assert.equal(response.status, 200);
    assert.equal(payload.provider, 'anthropic');
    assert.equal(payload.card.term, 'luminous');
  });

  restoreFetch();
});

test('PUT /api/words updates editable assets without losing review metadata', async () => {
  await withServer(async (baseUrl) => {
    const createResponse = await fetch(`${baseUrl}/api/words`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ card: makeWordCard('ephemeral') })
    });
    const created = await createResponse.json();

    const db = readDb();
    db.words[0].review_count = 7;
    db.words[0].repetitions = 4;
    db.words[0].interval_days = 12;
    writeDb(db);

    const updatedCard = {
      ...makeWordCard('ephemeral'),
      definition: 'lasting for a very short time; transient',
      examples: Array.from({ length: 10 }, (_, index) => `Edited sentence ${index + 1}`)
    };

    const updateResponse = await fetch(`${baseUrl}/api/words/${created.word.id}`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ card: updatedCard })
    });
    const payload = await updateResponse.json();

    assert.equal(updateResponse.status, 200);
    assert.equal(payload.word.definition, updatedCard.definition);
    assert.equal(payload.word.review_count, 7);
    assert.equal(payload.word.repetitions, 4);
    assert.equal(payload.word.interval_days, 12);
  });
});

test('POST /api/review records scheduling outcome and DELETE /api/words removes the card', async () => {
  await withServer(async (baseUrl) => {
    const createResponse = await fetch(`${baseUrl}/api/words`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ card: makeWordCard('tenacious') })
    });
    const created = await createResponse.json();

    const reviewResponse = await fetch(`${baseUrl}/api/review`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ word_id: created.word.id, rating: 'Easy' })
    });
    const reviewed = await reviewResponse.json();

    assert.equal(reviewResponse.status, 200);
    assert.equal(reviewed.word.review_count, 1);
    assert.equal(reviewed.word.last_rating, 'Easy');
    assert.equal(reviewed.review_event.word_id, created.word.id);
    assert.equal(reviewed.review_event.rating, 'Easy');
    assert.equal(reviewed.stats.total_words, 1);

    const deleteResponse = await fetch(`${baseUrl}/api/words/${created.word.id}`, {
      method: 'DELETE'
    });
    const deleted = await deleteResponse.json();

    assert.equal(deleteResponse.status, 200);
    assert.equal(deleted.deleted, true);
    assert.equal(deleted.word.term, 'tenacious');
    assert.equal(deleted.stats.total_words, 0);
  });
});

test('POST /api/import-google-doc imports new terms, skips duplicates, and logs the import', async () => {
  const restoreFetch = stubFetch([
    {
      match: (url) => url.includes('www.googleapis.com/drive/v3/files/doc123/export'),
      respond: () => Promise.resolve(new Response('lucid\nresolute\nlucid', { status: 200 }))
    },
    {
      match: (url) => url.includes('provider.example') && url.endsWith('/models'),
      respond: () => Promise.resolve(modelsResponse(['custom-model']))
    },
    {
      match: (url) => url.includes('provider.example') && url.endsWith('/chat/completions'),
      respond: (_url, options) => {
        const body = JSON.parse(options.body);
        const system = body.messages?.[0]?.content || '';
        if (system.includes('compact SVG illustrations')) {
          return Promise.resolve(openAiCompatibleResponse('<svg xmlns="http://www.w3.org/2000/svg"></svg>'));
        }
        const term = String(body.messages?.[1]?.content || '').split(':').pop().trim();
        return Promise.resolve(openAiCompatibleResponse(JSON.stringify(makeWordCard(term))));
      }
    }
  ]);

  await withServer(async (baseUrl) => {
    await fetch(`${baseUrl}/api/settings`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        provider: 'custom',
        active_provider: 'custom',
        base_url: 'https://provider.example/v1',
        model: 'custom-model',
        api_key: 'sk-custom'
      })
    });

    await fetch(`${baseUrl}/api/words`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ card: makeWordCard('lucid') })
    });

    const response = await fetch(`${baseUrl}/api/import-google-doc`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        url: 'https://docs.google.com/document/d/doc123/edit',
        access_token: 'google-token'
      })
    });
    const payload = await response.json();

    assert.equal(response.status, 200);
    assert.deepEqual(payload.requested_terms, ['lucid', 'resolute']);
    assert.equal(payload.imported.length, 1);
    assert.equal(payload.imported[0].term, 'resolute');
    assert.deepEqual(payload.skipped, [{ term: 'lucid', reason: 'Already in library' }]);
    assert.equal(payload.failed.length, 0);
    assert.equal(payload.stats.total_words, 2);

    const bootstrap = await fetch(`${baseUrl}/api/bootstrap`).then((res) => res.json());
    assert.equal(bootstrap.imports.length, 1);
    assert.equal(bootstrap.imports[0].imported_count, 1);
    assert.equal(bootstrap.imports[0].skipped_count, 1);
  });

  restoreFetch();
});

test('POST /api/profile rejects non-integer and out-of-range daily goals', async () => {
  await withServer(async (baseUrl) => {
    const invalid = await fetch(`${baseUrl}/api/profile`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        learner_name: 'Ava',
        daily_goal: 'abc'
      })
    });
    assert.equal(invalid.status, 400);

    const tooHigh = await fetch(`${baseUrl}/api/profile`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        learner_name: 'Ava',
        daily_goal: 99
      })
    });
    assert.equal(tooHigh.status, 400);
  });
});

test('frontend helpers cover provider-form bootstrapping, API-key clearing, and ASCII nav markers', async () => {
  const helpers = await import(pathToFileURL(path.join(__dirname, 'public', 'view-model.mjs')).href);

  assert.deepEqual(helpers.REVIEW_RATING_ORDER, ['Again', 'Hard', 'Good', 'Easy']);
  assert.equal(helpers.getNavMarker(true), '*');
  assert.equal(helpers.getNavMarker(false), 'o');
  assert.deepEqual(helpers.createEmptyProviderForms(), {
    active_provider: 'custom',
    providers: {
      custom: { model: '', api_key: '' },
      openai: { model: '', api_key: '' },
      anthropic: { model: '', api_key: '' }
    }
  });
  assert.deepEqual(
    helpers.clearSensitiveSettings({
      active_provider: 'custom',
      providers: {
        custom: { model: 'y', api_key: 'sk-live' },
        openai: { model: 'gpt-4.1-mini', api_key: 'sk-openai' },
        anthropic: { model: 'claude', api_key: 'sk-ant' }
      }
    }),
    {
      active_provider: 'custom',
      providers: {
        custom: { model: 'y', api_key: '' },
        openai: { model: 'gpt-4.1-mini', api_key: '' },
        anthropic: { model: 'claude', api_key: '' }
      }
    }
  );
});

test('LIVE: configured provider API keys connect and return accessible models', {
  skip: process.env.WORDFORGE_LIVE_PROVIDER_TESTS !== '1'
}, async () => {
  const configs = liveProviderConfigsFromEnv();
  assert.ok(
    configs.length > 0,
    'Set at least one provider key: OPENAI_API_KEY, ANTHROPIC_API_KEY, or CUSTOM_API_KEY plus CUSTOM_BASE_URL.'
  );

  for (const config of configs) {
    const result = await testProviderConnection(config);
    assert.equal(result.status, 'connected', `${config.name} should connect`);
    assert.equal(result.provider, config.provider);
    assert.ok(result.models.length > 0, `${config.name} should return at least one model`);
    assert.ok(
      result.models.every((modelId) => typeof modelId === 'string' && modelId.trim()),
      `${config.name} model ids should be non-empty strings`
    );
    if (config.model) {
      assert.ok(
        result.models.includes(config.model),
        `${config.name} key did not expose requested model "${config.model}". Returned models: ${result.models.slice(0, 20).join(', ')}`
      );
    }
  }
});
