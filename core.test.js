const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const assert = require('node:assert/strict');
const { pathToFileURL } = require('node:url');

const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'wordforge-tests-'));
process.env.WORDFORGE_SKIP_ENV_FILE = '1';
process.env.WORD_FORGE_DATA_DIR = path.join(tempRoot, 'data');
process.env.WORD_FORGE_DB_PATH = path.join(process.env.WORD_FORGE_DATA_DIR, 'db.json');

const {
  createEmptyDb,
  writeDb,
  validateWordCard,
  normalizeProfile,
  normalizeReviewPreferences
} = require('./shared');
const { sm2, getDueQueue, buildReviewPrompt, PROMPT_TYPES } = require('./review');
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
    examples: Array.from({ length: 10 }, (_, index) => `Example sentence ${index + 1} for ${term}.`),
    visual_cue: 'A strategist leaning over a map before making a delicate move',
    image_asset: '<svg xmlns="http://www.w3.org/2000/svg"></svg>'
  };
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

async function withEnv(name, value, run) {
  const previous = process.env[name];
  if (value === undefined) delete process.env[name];
  else process.env[name] = value;
  try {
    return await run();
  } finally {
    if (previous === undefined) delete process.env[name];
    else process.env[name] = previous;
  }
}

test.beforeEach(() => {
  resetDb();
});

test('buildConvexSnapshot treats legacy incompatible db shape as empty app data', () => {
  const snapshot = buildConvexSnapshot({
    users: [],
    wordCards: [],
    reviewSessions: []
  }, require('./shared'));

  assert.deepEqual(snapshot.words, []);
  assert.deepEqual(snapshot.review_events, []);
  assert.equal(snapshot.profile.learner_name, 'Learner');
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
    learning_step: 0,
    last_quality: null,
    last_rating: null,
    last_prompt_type: null,
    lapses: 0,
    leech_score: 0,
    progress_state: 'new',
    archived: false
  };

  const snapshot = buildConvexSnapshot({
    words: [valid, { id: 'bad', term: 'bad' }],
    review_events: [{ id: 'review_1' }, { rating: 'Good' }]
  }, require('./shared'));

  assert.equal(snapshot.words.length, 1);
  assert.equal(snapshot.words[0].id, 'word_existing');
  assert.deepEqual(snapshot.review_events, [{ id: 'review_1' }]);
});

test('validateWordCard accepts rich manual cards and migrates old visual fields', () => {
  const result = validateWordCard(makeWordCard());
  assert.equal(result.ok, true);
  assert.equal(result.value.examples.length, 10);

  const legacy = validateWordCard({
    ...makeWordCard('lucid'),
    visual_cue: undefined,
    image_asset: undefined,
    image_prompt: 'Clear water in a glass',
    image_svg: '<svg></svg>'
  });
  assert.equal(legacy.ok, true);
  assert.equal(legacy.value.visual_cue, 'Clear water in a glass');
  assert.equal(legacy.value.image_asset, '<svg></svg>');
});

test('normalizeProfile clamps stored profile values', () => {
  const profile = normalizeProfile({ learner_name: ' Ada ', daily_goal: 99 });
  const preferences = normalizeReviewPreferences({ new_cards_per_day: 99 });
  assert.equal(profile.learner_name, 'Ada');
  assert.equal(profile.daily_goal, 50);
  assert.equal(preferences.new_cards_per_day, 50);
});

test('enhanced scheduler handles learning, review growth, relearning, and leech risk', () => {
  const now = new Date('2026-04-20T10:00:00.000Z');
  const newWord = {
    ...makeWordCard('lucid'),
    id: 'word_1',
    next_review_at: now.toISOString(),
    repetitions: 0,
    interval_days: 0,
    ease_factor: 2.5,
    learning_step: 0,
    review_count: 0,
    lapses: 0,
    leech_score: 0,
    progress_state: 'new',
    last_prompt_type: null
  };

  const firstGood = sm2(newWord, 'Good', now);
  assert.equal(firstGood.updatedWord.progress_state, 'learning');
  assert.equal(firstGood.updatedWord.interval_days, 0.5);
  assert.equal(firstGood.event.prompt_type, 'term_to_definition');

  const secondGood = sm2(firstGood.updatedWord, 'Good', now);
  assert.equal(secondGood.updatedWord.progress_state, 'reviewing');
  assert.equal(secondGood.updatedWord.interval_days, 2);

  const lapse = sm2(secondGood.updatedWord, 'Again', now);
  assert.equal(lapse.updatedWord.progress_state, 'learning');
  assert.equal(lapse.updatedWord.lapses, 1);
  assert.equal(lapse.updatedWord.leech_score, 1);

  const repeated = sm2({ ...lapse.updatedWord, leech_score: 3, lapses: 3 }, 'Again', now);
  assert.equal(repeated.updatedWord.progress_state, 'leech');
});

test('review prompts rotate across rich-field active recall modes', () => {
  const prompts = PROMPT_TYPES.map((_, index) => buildReviewPrompt({
    ...makeWordCard('lucid'),
    review_count: index,
    last_prompt_type: null
  }).type);
  assert.deepEqual(prompts, PROMPT_TYPES);
});

test('getDueQueue sorts due words by urgency and leech risk', () => {
  const now = new Date('2026-04-20T10:00:00.000Z');
  const queue = getDueQueue([
    {
      ...makeWordCard('precise'),
      id: 'a',
      next_review_at: '2026-04-20T09:00:00.000Z',
      progress_state: 'leech',
      ease_factor: 2.1,
      lapses: 3,
      leech_score: 4,
      review_count: 0
    },
    {
      ...makeWordCard('ornate'),
      id: 'b',
      next_review_at: '2026-04-20T09:30:00.000Z',
      progress_state: 'mastered',
      ease_factor: 2.8,
      lapses: 0,
      leech_score: 0,
      review_count: 0
    }
  ], now);

  assert.equal(queue.count, 2);
  assert.equal(queue.items[0].term, 'precise');
  assert.equal(queue.items[0].review_prompt.type, 'term_to_definition');
});

test('server proxies API requests to configured Convex URL', async () => {
  await withEnv('CONVEX_URL', 'https://convex.example.test', async () => {
    const restoreFetch = stubFetch([
      {
        match: (url, options) => url === 'https://convex.example.test/api/bootstrap' && options.method === 'GET',
        respond: () => new Response(JSON.stringify({ app_name: 'WordForge', words: [] }), {
          status: 200,
          headers: { 'content-type': 'application/json' }
        })
      }
    ]);

    try {
      await withServer(async (baseUrl) => {
        const response = await fetch(`${baseUrl}/api/bootstrap`);
        const payload = await response.json();
        assert.equal(response.status, 200);
        assert.deepEqual(payload, { app_name: 'WordForge', words: [] });
      });
    } finally {
      restoreFetch();
    }
  });
});

test('server refuses API requests when Convex is not configured', async () => {
  await withEnv('CONVEX_URL', undefined, async () => {
    await withEnv('WORDFORGE_CONVEX_URL', undefined, async () => {
      await withServer(async (baseUrl) => {
        const response = await fetch(`${baseUrl}/api/bootstrap`);
        const payload = await response.json();
        assert.equal(response.status, 503);
        assert.equal(payload.error.code, 'CONVEX_NOT_CONFIGURED');
      });
    });
  });
});

test('frontend helpers cover manual editor helpers and nav markers', async () => {
  const helpers = await import(pathToFileURL(path.join(__dirname, 'public', 'view-model.mjs')).href);

  assert.deepEqual(helpers.REVIEW_RATING_ORDER, ['Again', 'Hard', 'Good', 'Easy']);
  assert.equal(helpers.getNavMarker(true), '*');
  assert.equal(helpers.getNavMarker(false), 'o');
  assert.deepEqual(helpers.createEmptyWordEditor(), {
    term: '',
    definition: '',
    nuances: '',
    phonetics_us: '',
    part_of_speech: '',
    synonyms_text: '',
    antonyms_text: '',
    examples_text: '',
    visual_cue: '',
    image_asset: ''
  });
  assert.deepEqual(helpers.splitCommaList('lucid, clear, lucid'), ['lucid', 'clear']);
  assert.deepEqual(helpers.splitExampleList('One\n\nTwo'), ['One', 'Two']);
});
