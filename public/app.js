import { REVIEW_RATING_ORDER, createEmptyProviderForms, clearSensitiveSettings } from './view-model.mjs';

/* ============================================================
   Constants
   ============================================================ */

const NAV_ITEMS = [
  { id: 'home',     title: 'Dashboard', icon: 'dashboard' },
  { id: 'library',  title: 'Vault',     icon: 'auto_stories' },
  { id: 'add',      title: 'Add New',   icon: 'add_circle' },
  { id: 'review',   title: 'Quizzes',   icon: 'quiz' },
  { id: 'settings', title: 'Settings',  icon: 'settings' }
];

const PROVIDER_META = {
  custom: {
    label: 'Custom',
    caption: 'OpenAI-compatible key',
    copy: 'Use an OpenAI-compatible key and let WordForge detect the available models automatically.'
  },
  openai: {
    label: 'OpenAI',
    caption: 'Official preset',
    copy: 'Use OpenAI directly with an official model name and encrypted server-side API key.'
  },
  anthropic: {
    label: 'Anthropic',
    caption: 'Official preset',
    copy: 'Use Anthropic directly with native Messages API routing and a saved API key.'
  }
};

const SCREEN_COPY = {
  home: {
    eyebrow: 'WordForge',
    title: "Today's study desk",
    subtitle: 'A focused view of the words most worth your attention right now.'
  },
  add: {
    eyebrow: 'Generation atelier',
    title: 'Generate, inspect, then save.',
    subtitle: 'Turn a word or phrase into a complete editable card before it enters your vault.'
  },
  library: {
    eyebrow: 'Vault',
    title: 'Vocabulary Vault',
    subtitle: 'Search, inspect, and refine your saved cards without disturbing review history.'
  },
  review: {
    eyebrow: 'Practice',
    title: 'Active Recall',
    subtitle: 'Work through due cards with rotating prompts and SM-2 difficulty ratings.'
  },
  settings: {
    eyebrow: 'Configure',
    title: 'Settings',
    subtitle: 'Control provider routing, encrypted keys, model selection, and your profile.'
  }
};

/* ============================================================
   Application State
   ============================================================ */

const state = {
  screen: 'home',
  loading: false,
  loadingLabel: '',
  notice: '',
  error: '',
  bootstrap: null,
  words: [],
  dueQueue: { count: 0, items: [] },
  selectedWordId: null,
  search: '',
  addWordInput: '',
  importUrl: '',
  importResult: null,
  googleAuth: {
    accessToken: '',
    expiresAt: 0
  },
  draftEditor: null,
  libraryEditingId: null,
  libraryEditor: null,
  review: {
    active: false,
    index: 0,
    items: [],
    revealed: false,
    summary: null
  },
  settingsForm: createEmptyProviderForms(),
  detectedModels: {
    custom: [],
    openai: [],
    anthropic: []
  },
  profileForm: {
    learner_name: 'Learner',
    daily_goal: 12
  }
};

const app = document.getElementById('app');

/* ============================================================
   Utility Helpers
   ============================================================ */

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function svgToDataUri(svg) {
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(String(svg || ''))}`;
}

function formatDate(value) {
  if (!value) return 'Not scheduled';
  return new Date(value).toLocaleString([], {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit'
  });
}

function titleCaseProvider(providerId) {
  return PROVIDER_META[providerId]?.label || providerId;
}

function splitCommaList(value) {
  const seen = new Set();
  return String(value || '')
    .split(',')
    .map((item) => item.trim())
    .filter((item) => {
      if (!item) return false;
      const key = item.toLowerCase();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
}

function splitExampleList(value) {
  return String(value || '')
    .split(/\r?\n/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function createWordEditor(word = null) {
  const base = word || {
    term: '',
    definition: '',
    nuances: '',
    phonetics_us: '',
    part_of_speech: '',
    synonyms: [],
    antonyms: [],
    examples: Array.from({ length: 10 }, () => ''),
    image_prompt: '',
    image_svg: ''
  };

  return {
    term: base.term || '',
    definition: base.definition || '',
    nuances: base.nuances || '',
    phonetics_us: base.phonetics_us || '',
    part_of_speech: base.part_of_speech || '',
    synonyms_text: Array.isArray(base.synonyms) ? base.synonyms.join(', ') : '',
    antonyms_text: Array.isArray(base.antonyms) ? base.antonyms.join(', ') : '',
    examples_text: Array.isArray(base.examples) ? base.examples.join('\n') : '',
    image_prompt: base.image_prompt || '',
    image_svg: base.image_svg || ''
  };
}

function editorToCard(editor) {
  return {
    term: String(editor.term || '').trim(),
    definition: String(editor.definition || '').trim(),
    nuances: String(editor.nuances || '').trim(),
    phonetics_us: String(editor.phonetics_us || '').trim(),
    part_of_speech: String(editor.part_of_speech || '').trim(),
    synonyms: splitCommaList(editor.synonyms_text),
    antonyms: splitCommaList(editor.antonyms_text),
    examples: splitExampleList(editor.examples_text),
    image_prompt: String(editor.image_prompt || '').trim(),
    image_svg: String(editor.image_svg || '').trim()
  };
}

/* ============================================================
   Data Access Layer
   ============================================================ */

function getActiveProviderId() {
  return state.settingsForm.active_provider || 'custom';
}

function getActiveProviderForm() {
  return state.settingsForm.providers[getActiveProviderId()];
}

function getDetectedModels(providerId) {
  const detected = state.detectedModels[providerId] || [];
  const current = state.settingsForm.providers[providerId]?.model || '';
  const saved = getSettingsSnapshot().providers?.[providerId]?.model || '';
  return [...new Set([current, saved, ...detected].filter(Boolean))];
}

function getSettingsSnapshot() {
  return state.bootstrap?.settings || {
    active_provider: 'custom',
    providers: {
      custom: { base_url: '', model: '', has_key: false, connection_status: 'missing', last_tested_at: null },
      openai: { base_url: '', model: '', has_key: false, connection_status: 'missing', last_tested_at: null },
      anthropic: { base_url: '', model: '', has_key: false, connection_status: 'missing', last_tested_at: null }
    }
  };
}

function getActiveProviderSummary() {
  const snapshot = getSettingsSnapshot();
  const providerId = snapshot.active_provider || 'custom';
  return {
    providerId,
    provider: snapshot.providers?.[providerId] || {}
  };
}

function getStats() {
  return state.bootstrap?.stats || {
    total_words: 0,
    due_words: 0,
    mastered_words: 0,
    learning_words: 0,
    reviews_today: 0,
    mastery_rate: 0,
    recent_words: [],
    due_preview: []
  };
}

function getSelectedWord() {
  return state.words.find((word) => word.id === state.selectedWordId) || null;
}

function getFilteredWords() {
  const query = state.search.trim().toLowerCase();
  if (!query) return state.words;

  return state.words.filter((word) => {
    const haystack = [
      word.term,
      word.definition,
      word.nuances,
      word.part_of_speech,
      ...(word.synonyms || []),
      ...(word.antonyms || [])
    ]
      .join(' ')
      .toLowerCase();

    return haystack.includes(query);
  });
}

function getGoogleClientId() {
  return String(state.bootstrap?.google_oauth?.client_id || '').trim();
}

function hasFreshGoogleToken() {
  return Boolean(state.googleAuth.accessToken) && Date.now() < state.googleAuth.expiresAt;
}

/* ============================================================
   State Helpers
   ============================================================ */

function setNotice(message) {
  state.notice = message;
  state.error = '';
  render();
}

function setError(message) {
  state.error = message;
  state.notice = '';
  render();
}

function clearMessages() {
  state.error = '';
  state.notice = '';
}

/* ============================================================
   API Layer
   ============================================================ */

function getApiBaseUrl() {
  const configured = window.WORDFORGE_CONFIG?.apiBaseUrl
    || document.querySelector('meta[name="wordforge-api-base"]')?.getAttribute('content')
    || '';
  return String(configured).trim().replace(/\/+$/, '');
}

async function api(path, options = {}) {
  const response = await fetch(`${getApiBaseUrl()}${path}`, {
    ...options,
    headers: {
      'content-type': 'application/json',
      ...(options.headers || {})
    }
  });

  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(payload?.error?.message || 'Request failed.');
  }
  return payload;
}

/* ============================================================
   Bootstrap & Sync
   ============================================================ */

function syncFormsFromBootstrap() {
  const bootstrap = state.bootstrap;
  if (!bootstrap) return;

  state.settingsForm.active_provider = bootstrap.settings?.active_provider || 'custom';
  for (const providerId of Object.keys(state.settingsForm.providers)) {
    const saved = bootstrap.settings?.providers?.[providerId] || {};
    state.settingsForm.providers[providerId].model = saved.model || '';
    state.settingsForm.providers[providerId].api_key = '';
  }

  state.profileForm.learner_name = bootstrap.profile?.learner_name || 'Learner';
  state.profileForm.daily_goal = Number(bootstrap.profile?.daily_goal || 12);

  if (!state.selectedWordId && state.words.length) {
    state.selectedWordId = state.words[0].id;
  }
}

async function loadBootstrap({ keepSelection = true } = {}) {
  state.loading = true;
    state.loadingLabel = 'Loading WordForge';
  render();

  try {
    const payload = await api('/api/bootstrap');
    const previousSelection = keepSelection ? state.selectedWordId : null;
    state.bootstrap = payload;
    state.words = payload.words || [];
    state.dueQueue = payload.due_queue || { count: 0, items: [] };
    state.selectedWordId =
      previousSelection && state.words.some((word) => word.id === previousSelection)
        ? previousSelection
        : state.words[0]?.id || null;
    syncFormsFromBootstrap();

    if (state.libraryEditingId && state.libraryEditingId !== state.selectedWordId) {
      state.libraryEditingId = null;
      state.libraryEditor = null;
    }

    if (state.review.active) {
      state.review.items = state.dueQueue.items;
      if (state.review.index >= state.review.items.length) {
        state.review.index = Math.max(0, state.review.items.length - 1);
      }
      if (!state.review.items.length) {
        state.review.active = false;
      }
    }
  } catch (error) {
    setError(error.message);
  } finally {
    state.loading = false;
    state.loadingLabel = '';
    render();
  }
}

/* ============================================================
   Google OAuth
   ============================================================ */

function requestGoogleAccessToken() {
  const clientId = getGoogleClientId();
  if (!clientId) {
    throw new Error('Google Docs import is not configured yet. Set GOOGLE_OAUTH_CLIENT_ID on the server first.');
  }
  if (!window.google?.accounts?.oauth2) {
    throw new Error('Google Identity Services did not finish loading. Refresh the page and try again.');
  }

  return new Promise((resolve, reject) => {
    const tokenClient = window.google.accounts.oauth2.initTokenClient({
      client_id: clientId,
      scope: 'https://www.googleapis.com/auth/drive.readonly',
      callback: (response) => {
        if (!response || response.error) {
          reject(new Error(response?.error || 'Google authorization failed.'));
          return;
        }

        const expiresIn = Number(response.expires_in || 3600);
        state.googleAuth.accessToken = response.access_token;
        state.googleAuth.expiresAt = Date.now() + Math.max(1, expiresIn - 30) * 1000;
        resolve(state.googleAuth.accessToken);
      },
      error_callback: () => {
        reject(new Error('Google authorization was cancelled or blocked.'));
      }
    });

    tokenClient.requestAccessToken({
      prompt: hasFreshGoogleToken() ? '' : 'consent'
    });
  });
}

/* ============================================================
   Business Logic Handlers
   ============================================================ */

async function handleGenerateWord() {
  const term = state.addWordInput.trim();
  if (!term) {
    setError('Enter a word or phrase first.');
    return;
  }

  state.loading = true;
  state.loadingLabel = `Generating assets for ${term}`;
  clearMessages();
  render();

  try {
    const payload = await api('/api/words/generate', {
      method: 'POST',
      body: JSON.stringify({ term })
    });
    state.draftEditor = createWordEditor(payload.card);
    setNotice(`Draft created with ${titleCaseProvider(payload.provider)}. Review every field, then save it when ready.`);
  } catch (error) {
    setError(error.message);
  } finally {
    state.loading = false;
    state.loadingLabel = '';
    render();
  }
}

async function handleSaveDraft() {
  if (!state.draftEditor) return;

  const card = editorToCard(state.draftEditor);
  state.loading = true;
  state.loadingLabel = `Saving ${card.term || 'draft'}`;
  render();

  try {
    const payload = await api('/api/words', {
      method: 'POST',
      body: JSON.stringify({
        card,
        source: {
          type: 'manual',
          label: 'Manual entry'
        }
      })
    });
    state.draftEditor = null;
    await loadBootstrap({ keepSelection: false });
    state.screen = 'library';
    state.selectedWordId = payload.word.id;
    setNotice(`${payload.word.term} is now in your vault and ready for review.`);
  } catch (error) {
    setError(error.message);
  } finally {
    state.loading = false;
    state.loadingLabel = '';
    render();
  }
}

async function handleSaveWordEdit() {
  if (!state.libraryEditingId || !state.libraryEditor) return;

  const card = editorToCard(state.libraryEditor);
  state.loading = true;
  state.loadingLabel = `Updating ${card.term || 'word card'}`;
  render();

  try {
    const payload = await api(`/api/words/${state.libraryEditingId}`, {
      method: 'PUT',
      body: JSON.stringify({ card })
    });
    state.libraryEditingId = null;
    state.libraryEditor = null;
    await loadBootstrap();
    state.selectedWordId = payload.word.id;
    setNotice(`${payload.word.term} was updated without resetting its review history.`);
  } catch (error) {
    setError(error.message);
  } finally {
    state.loading = false;
    state.loadingLabel = '';
    render();
  }
}

async function handleImportGoogleDoc() {
  const url = state.importUrl.trim();
  if (!url) {
    setError('Paste a Google Docs URL first.');
    return;
  }

  state.loading = true;
  state.loadingLabel = 'Importing Google Docs word list';
  clearMessages();
  render();

  try {
    const accessToken = hasFreshGoogleToken() ? state.googleAuth.accessToken : await requestGoogleAccessToken();
    const payload = await api('/api/import-google-doc', {
      method: 'POST',
      body: JSON.stringify({
        url,
        access_token: accessToken
      })
    });

    state.importResult = payload;
    if (payload.import_error) {
      setError(payload.import_error.message);
      return;
    }

    await loadBootstrap();
    state.screen = 'library';
    setNotice(`Imported ${payload.imported.length} words through ${titleCaseProvider(getActiveProviderSummary().providerId)}.`);
  } catch (error) {
    setError(error.message);
  } finally {
    state.loading = false;
    state.loadingLabel = '';
    render();
  }
}

async function handleDeleteWord(wordId) {
  const word = state.words.find((item) => item.id === wordId);
  if (!word) return;
  if (!window.confirm(`Delete "${word.term}" from WordForge?`)) return;

  state.loading = true;
  state.loadingLabel = `Deleting ${word.term}`;
  render();

  try {
    await api(`/api/words/${wordId}`, { method: 'DELETE' });
    state.libraryEditingId = null;
    state.libraryEditor = null;
    if (state.selectedWordId === wordId) {
      state.selectedWordId = null;
    }
    await loadBootstrap({ keepSelection: false });
    setNotice(`Removed ${word.term} from your vault.`);
  } catch (error) {
    setError(error.message);
  } finally {
    state.loading = false;
    state.loadingLabel = '';
    render();
  }
}

function startReviewSession() {
  if (!state.dueQueue.items.length) {
    setError('No words are due right now.');
    return;
  }

  state.review = {
    active: true,
    index: 0,
    items: [...state.dueQueue.items],
    revealed: false,
    summary: null
  };
  clearMessages();
  render();
}

function revealReviewCard() {
  if (!state.review.active) return;
  state.review.revealed = true;
  render();
}

async function submitReviewRating(rating) {
  if (!state.review.active) return;
  const current = state.review.items[state.review.index];
  if (!current) return;

  state.loading = true;
  state.loadingLabel = `Scheduling ${current.term}`;
  render();

  try {
    await api('/api/review', {
      method: 'POST',
      body: JSON.stringify({
        word_id: current.id,
        rating
      })
    });

    const nextSummary = state.review.summary || {
      completed: 0,
      ratings: Object.fromEntries(REVIEW_RATING_ORDER.map((label) => [label, 0]))
    };

    nextSummary.completed += 1;
    nextSummary.ratings[rating] += 1;

    const isLast = state.review.index >= state.review.items.length - 1;
    await loadBootstrap();

    if (isLast) {
      state.review = {
        active: false,
        index: 0,
        items: [],
        revealed: false,
        summary: nextSummary
      };
      setNotice('Review session complete. Your queue has been re-ranked.');
      return;
    }

    state.review.index = Math.min(state.review.index, Math.max(0, state.dueQueue.items.length - 1));
    state.review.revealed = false;
    state.review.summary = nextSummary;
    state.review.items = [...state.dueQueue.items];
  } catch (error) {
    setError(error.message);
  } finally {
    state.loading = false;
    state.loadingLabel = '';
    render();
  }
}

function buildSettingsPayload() {
  const provider = getActiveProviderId();
  const form = getActiveProviderForm();
  return {
    provider,
    active_provider: provider,
    model: form.model,
    api_key: form.api_key
  };
}

async function handleSaveSettings() {
  state.loading = true;
  state.loadingLabel = 'Saving provider settings';
  clearMessages();
  render();

  try {
    const payload = await api('/api/settings', {
      method: 'POST',
      body: JSON.stringify(buildSettingsPayload())
    });
    state.settingsForm = clearSensitiveSettings(state.settingsForm);
    await loadBootstrap();
    setNotice(payload.verification?.message || 'Provider settings saved and encrypted.');
  } catch (error) {
    setError(error.message);
  } finally {
    state.loading = false;
    state.loadingLabel = '';
    render();
  }
}

async function handleTestSettings() {
  state.loading = true;
  state.loadingLabel = 'Testing provider connection';
  clearMessages();
  render();

  try {
    const payload = await api('/api/settings/test', {
      method: 'POST',
      body: JSON.stringify(buildSettingsPayload())
    });
    const models = Array.isArray(payload.models) ? payload.models : [];
    state.detectedModels[getActiveProviderId()] = models;
    if (models.length && !getActiveProviderForm().model) {
      getActiveProviderForm().model = payload.model || models[0];
    }
    setNotice(models.length
      ? `Connection successful. Detected ${models.length} available models. Choose one, then save settings.`
      : 'Connection successful, but no models were returned.');
  } catch (error) {
    setError(error.message);
  } finally {
    state.loading = false;
    state.loadingLabel = '';
    render();
  }
}

async function handleSaveProfile() {
  state.loading = true;
  state.loadingLabel = 'Saving learner profile';
  clearMessages();
  render();

  try {
    await api('/api/profile', {
      method: 'POST',
      body: JSON.stringify(state.profileForm)
    });
    await loadBootstrap();
    setNotice('Learner profile updated.');
  } catch (error) {
    setError(error.message);
  } finally {
    state.loading = false;
    state.loadingLabel = '';
    render();
  }
}

/* ============================================================
   RENDER FUNCTIONS
   ============================================================ */

function renderToasts() {
  if (!state.notice && !state.error && !state.loadingLabel) return '';
  const items = [];
  if (state.loadingLabel) items.push(`<div class="toast">${escapeHtml(state.loadingLabel)}...</div>`);
  if (state.notice) items.push(`<div class="toast success">${escapeHtml(state.notice)}</div>`);
  if (state.error) items.push(`<div class="toast error">${escapeHtml(state.error)}</div>`);
  return `<div class="toast-stack">${items.join('')}</div>`;
}

/* --- Sidebar --- */
function renderSidebar() {
  const stats = getStats();
  const name = state.bootstrap?.profile?.learner_name || 'Learner';
  const initials = name.split(' ').map(w => w[0]).join('').toUpperCase().slice(0, 2) || 'LM';

  return `
    <nav class="sidebar" aria-label="Main Navigation">
      <div class="sidebar-header">
        <div class="sidebar-avatar">${escapeHtml(initials)}</div>
        <div class="sidebar-brand">WordForge</div>
        <div class="sidebar-subtitle">Personal vocabulary desk</div>
      </div>

      <div class="sidebar-nav">
        ${NAV_ITEMS.map(item => `
          <button class="nav-link ${state.screen === item.id ? 'active' : ''}" data-screen="${item.id}">
            <span class="material-symbols-outlined" ${state.screen === item.id ? 'style="font-variation-settings: \'FILL\' 1;"' : ''}>${item.icon}</span>
            ${escapeHtml(item.title)}
          </button>
        `).join('')}
      </div>

      <div class="sidebar-stat-box">
        <div class="sidebar-stat-value">${escapeHtml(stats.due_words)}</div>
        <div class="sidebar-stat-label">Due now</div>
      </div>

      <button class="sidebar-cta" data-screen="review">
        <span class="material-symbols-outlined" style="font-size:18px">play_arrow</span>
        Start Study Session
      </button>
    </nav>
  `;
}

/* --- Top Header --- */
function renderTopHeader() {
  return `
    <header class="top-header">
      <div class="header-left">
        <div class="header-brand">WordForge</div>
      </div>
      <div class="header-right">
        <button class="icon-btn" aria-label="Settings" data-screen="settings">
          <span class="material-symbols-outlined">settings</span>
        </button>
        <button class="icon-btn" aria-label="Account">
          <span class="material-symbols-outlined">account_circle</span>
        </button>
      </div>
    </header>
  `;
}

/* --- Bottom Nav (Mobile) --- */
function renderBottomNav() {
  const mobileNav = [
    { id: 'home', icon: 'dashboard', label: 'Home' },
    { id: 'library', icon: 'auto_stories', label: 'Vault' },
    { id: 'add', icon: 'add_circle', label: 'Add' },
    { id: 'review', icon: 'quiz', label: 'Quiz' }
  ];

  return `
    <nav class="bottom-nav">
      <div class="bottom-nav-inner">
        ${mobileNav.map(item => `
          <button class="bottom-nav-item ${state.screen === item.id ? 'active' : ''}" data-screen="${item.id}">
            <span class="material-symbols-outlined" ${state.screen === item.id ? 'style="font-variation-settings: \'FILL\' 1;"' : ''}>${item.icon}</span>
            <span>${item.label}</span>
          </button>
        `).join('')}
      </div>
    </nav>
  `;
}

/* --- Dashboard (Home Screen) --- */
function renderHome() {
  const stats = getStats();
  const allWords = [...(state.dueQueue.items || []), ...(stats.recent_words || [])];
  const uniqueMap = new Map();
  allWords.forEach(w => { if (!uniqueMap.has(w.id)) uniqueMap.set(w.id, w); });
  const displayWords = Array.from(uniqueMap.values()).slice(0, 5);
  const featured = displayWords[0] || null;
  const queuePreview = (state.dueQueue.items || []).slice(0, 4);
  const totalWords = Number(stats.total_words || 0);
  const masteredPct = totalWords ? Math.round((stats.mastered_words / totalWords) * 100) : 0;
  const learningPct = totalWords ? Math.max(0, 100 - masteredPct) : 0;
  const dailyGoal = Number(state.bootstrap?.profile?.daily_goal || state.profileForm.daily_goal || 12);
  const dailyPct = dailyGoal ? Math.min(100, Math.round((Number(stats.reviews_today || 0) / dailyGoal) * 100)) : 0;

  return `
    <section class="desk-hero-shell">
      <div class="desk-copy">
        <div class="page-eyebrow">${escapeHtml(SCREEN_COPY.home.eyebrow)}</div>
        <h2 class="page-title">${escapeHtml(SCREEN_COPY.home.title)}</h2>
        <p class="page-subtitle">${escapeHtml(SCREEN_COPY.home.subtitle)}</p>
        <div class="desk-actions">
          <button class="btn btn-primary" data-screen="review">
            <span class="material-symbols-outlined">play_arrow</span>
            Start due review
          </button>
          <button class="btn btn-secondary" data-screen="add">
            <span class="material-symbols-outlined">add</span>
            Generate card
          </button>
        </div>
      </div>

      <aside class="daily-ledger">
        <span>Daily rhythm</span>
        <strong>${escapeHtml(stats.reviews_today)} / ${escapeHtml(dailyGoal)}</strong>
        <div class="progress-bar compact"><div class="progress-fill" style="width:${dailyPct}%"></div></div>
        <small>${escapeHtml(state.dueQueue.count)} due now</small>
      </aside>
    </section>

    <div class="metrics-row">
      ${[
        ['Total words', stats.total_words, 'Saved cards'],
        ['Due queue', stats.due_words, 'Ranked by priority'],
        ['Mastered', stats.mastered_words, `${masteredPct}% of library`],
        ['Learning', stats.learning_words, `${learningPct}% still active`]
      ].map(([label, value, note]) => `
        <div class="metric-chip">
          <div class="metric-chip-label">${escapeHtml(label)}</div>
          <div class="metric-chip-value">${escapeHtml(value)}</div>
          <div class="metric-chip-note">${escapeHtml(note)}</div>
        </div>
      `).join('')}
    </div>

    <div class="study-grid">
      <article class="card featured-card">
        ${featured ? `
          <div class="featured-topline">
            <span>${state.dueQueue.items?.some(item => item.id === featured.id) ? 'Highest priority' : 'Recent card'}</span>
            <button class="text-command" data-action="select-word" data-word-id="${featured.id}" data-screen="library">Open in vault</button>
          </div>
          <h3 class="featured-term">${escapeHtml(featured.term)}</h3>
          <p class="featured-phonetics">${escapeHtml(featured.part_of_speech)} / ${escapeHtml(featured.phonetics_us)}</p>
          <p class="featured-definition">${escapeHtml(featured.definition)}</p>
          ${featured.examples?.length ? `<blockquote class="featured-quote">${escapeHtml(featured.examples[0])}</blockquote>` : ''}
          <div class="pill-row">${(featured.synonyms || []).slice(0, 4).map(item => `<span class="pill">${escapeHtml(item)}</span>`).join('')}</div>
        ` : `
          <div class="empty-state empty-quiet">
            <strong>Your desk is empty.</strong>
            <span>Generate your first word card to start building a personal vocabulary system.</span>
            <button class="btn btn-primary" data-screen="add">Add a word</button>
          </div>
        `}
      </article>

      <section class="card card-padded queue-panel">
        <div class="section-heading">
          <div>
            <h3>Due priority</h3>
            <p>Cards most likely to slip are shown first.</p>
          </div>
          <span class="pill">${escapeHtml(state.dueQueue.count)} due</span>
        </div>
        ${queuePreview.length ? renderQueueList(queuePreview, '') : `<div class="empty-state empty-quiet">Nothing is due right now.</div>`}
      </section>

      <section class="card card-padded mastery-panel">
        <div class="chart-title">Mastery split</div>
        <div class="mastery-meter" style="--mastered:${masteredPct};">
          <div class="mastery-fill"></div>
        </div>
        <div class="legend-row">
          <div class="legend-item"><span class="legend-dot"></span><span>Mastered</span><strong>${masteredPct}%</strong></div>
          <div class="legend-item"><span class="legend-dot learning"></span><span>Learning</span><strong>${learningPct}%</strong></div>
        </div>
      </section>
    </div>
  `;
}

/* --- Add Word Screen --- */
function renderAdd() {
  const clientIdConfigured = Boolean(getGoogleClientId());
  const activeProvider = getActiveProviderSummary();

  return `
    <div class="atelier-layout">
      <aside class="atelier-rail">
        <div>
          <div class="page-eyebrow">${escapeHtml(SCREEN_COPY.add.eyebrow)}</div>
          <h2 class="page-title">${escapeHtml(SCREEN_COPY.add.title)}</h2>
          <p class="page-subtitle">${escapeHtml(SCREEN_COPY.add.subtitle)}</p>
        </div>

        <div class="atelier-input-card">
          <label for="addWordInput">Word or phrase</label>
          <input
            id="addWordInput"
            class="atelier-input"
            type="text"
            autocomplete="off"
            autofocus
            placeholder="serendipity"
            value="${escapeHtml(state.addWordInput)}"
          />
          <button class="btn btn-primary" data-action="generate-word">
            <span class="material-symbols-outlined">auto_awesome</span>
            Generate card
          </button>
          ${state.draftEditor ? `<button class="btn btn-secondary btn-sm" data-action="clear-draft">Clear draft</button>` : ''}
        </div>

        <div class="rail-note">
          <span>Active provider</span>
          <strong>${escapeHtml(titleCaseProvider(activeProvider.providerId))}</strong>
          <small>${escapeHtml(activeProvider.model || 'No model selected')}</small>
        </div>

        <div class="rail-note">
          <span>Google Docs import</span>
          <strong>${hasFreshGoogleToken() ? 'Authorized' : (clientIdConfigured ? 'Ready to authorize' : 'OAuth not configured')}</strong>
          <textarea id="importUrlInput" class="textarea sm" placeholder="https://docs.google.com/document/d/...">${escapeHtml(state.importUrl)}</textarea>
          <button class="btn btn-secondary btn-sm" data-action="import-doc">Import terms</button>
          ${renderImportResult()}
        </div>
      </aside>

      <main class="atelier-workbench">
        ${state.draftEditor ? `
          <div class="card card-padded editor-card">
            ${renderWordEditor(state.draftEditor, 'draft', {
              title: 'Generated draft',
              copy: 'Review every field before saving. AI output stays editable by design.',
              saveAction: 'save-draft',
              saveLabel: 'Save to vault'
            })}
          </div>
        ` : `
          <div class="card card-padded atelier-empty">
            <span class="material-symbols-outlined">stylus_note</span>
            <h3>No draft open</h3>
            <p>Generate a word card or import a study list to open the editing bench.</p>
          </div>
        `}
      </main>
    </div>
  `;
}

function renderImportResult() {
  const result = state.importResult;
  if (!result) return '';
  return `
    <div class="detail-block" style="margin-top:16px;">
      <h4>Latest Import</h4>
      <div class="pill-row">
        <span class="pill">${escapeHtml(result.imported.length)} imported</span>
        <span class="pill">${escapeHtml(result.skipped.length)} skipped</span>
        <span class="pill">${escapeHtml(result.failed.length)} failed</span>
      </div>
      ${result.import_error ? `<p style="margin-top:8px;font-size:13px;color:var(--error);">${escapeHtml(result.import_error.message)}</p>` : ''}
    </div>
  `;
}

/* --- Library / Vault Screen --- */
function renderLibrary() {
  const words = getFilteredWords();
  const selectedWord = getSelectedWord();
  const isEditing = Boolean(selectedWord && state.libraryEditingId === selectedWord.id && state.libraryEditor);

  return `
    <div class="page-header">
      <div class="page-header-row">
        <div>
          <div class="page-eyebrow">${escapeHtml(SCREEN_COPY.library.eyebrow)}</div>
          <h2 class="page-title">${escapeHtml(SCREEN_COPY.library.title)}</h2>
          <p class="page-subtitle">${escapeHtml(SCREEN_COPY.library.subtitle)}</p>
        </div>
      </div>
    </div>

    <div class="vault-header-row">
      <div class="vault-search">
        <span class="material-symbols-outlined">search</span>
        <input id="searchInput" type="text" placeholder="Search your lexicon..." value="${escapeHtml(state.search)}" />
      </div>
    </div>

    <div class="vault-tags">
      <span class="vault-tag active">All Words</span>
    </div>

    <div class="library-grid">
      <!-- Card List -->
      <div class="vault-card-list">
        ${words.length ? words.map(word => `
          <button class="vault-card ${state.selectedWordId === word.id ? 'selected' : ''}" data-action="select-word" data-word-id="${word.id}">
            <div style="position:relative;z-index:1;display:flex;flex-direction:column;height:100%">
              <div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:12px;">
                <span class="vault-card-category" style="color:var(--secondary)">${escapeHtml(word.part_of_speech)}</span>
              </div>
              <div class="vault-card-term">${escapeHtml(word.term)}</div>
              <p class="vault-card-def">${escapeHtml(word.definition?.slice(0, 100))}${(word.definition?.length || 0) > 100 ? '...' : ''}</p>
              <div class="vault-card-center" style="margin-top:auto">
                <span class="mastery-badge ${word.progress_state === 'mastered' ? 'mastered' : 'learning'}">
                  <span class="badge-dot"></span>
                  ${escapeHtml(word.progress_state === 'mastered' ? 'Mastered' : 'Learning')}
                </span>
              </div>
            </div>
          </button>
        `).join('') : `<div class="empty-state" style="grid-column:1/-1;">No cards match this search yet.</div>`}
      </div>

      <!-- Detail / Editor Panel -->
      <div>
        ${isEditing
          ? `<div class="card card-padded">
              ${renderWordEditor(state.libraryEditor, 'library', {
                title: 'Edit Saved Card',
                copy: 'Update without losing spaced-repetition history.',
                saveAction: 'save-word-edit',
                saveLabel: 'Save changes',
                cancelAction: 'cancel-edit-word'
              })}
             </div>`
          : renderWordDetailPanel(selectedWord)
        }
      </div>
    </div>
  `;
}

/* --- Word Definition Panel (used inside library) --- */
function renderWordDetailPanel(word) {
  if (!word) {
    return `<div class="card card-padded"><div class="empty-state">Select a word from your vault to see its details.</div></div>`;
  }

  return `
    <div class="card word-detail-panel">
      <!-- Hero -->
      <div class="word-hero">
        <div class="word-hero-row">
          <h1 class="word-hero-term">${escapeHtml(word.term)}</h1>
          <div class="pronunciation-btn">
            <span class="material-symbols-outlined">volume_up</span>
            <span>${escapeHtml(word.phonetics_us)}</span>
          </div>
        </div>
        <div class="word-tags">
          <span class="word-tag primary">${escapeHtml(word.part_of_speech)}</span>
          <span class="word-tag muted">${escapeHtml(word.progress_state)}</span>
        </div>
      </div>

      <!-- Definition Tiers -->
      <div class="definition-grid">
        <div>
          <!-- Tier I: Definition -->
          <div class="def-tier">
            <div class="def-tier-head">
              <span class="tier-num">I</span>
              <span class="tier-label">Definition</span>
            </div>
            <div class="def-tier-body">
              <p class="def-text-large">${escapeHtml(word.definition)}</p>
            </div>
          </div>

          <!-- Tier II: Nuances -->
          <div class="def-tier">
            <div class="def-tier-head">
              <span class="tier-num">II</span>
              <span class="tier-label">Contextual Nuance</span>
            </div>
            <div class="def-tier-body">
              <p class="def-text">${escapeHtml(word.nuances)}</p>
              ${word.examples?.length ? `
                <div class="context-quote">"${escapeHtml(word.examples[0])}"</div>
              ` : ''}
            </div>
          </div>
        </div>

        <div>
          <!-- Tier III: Synonyms & Antonyms -->
          <div class="def-tier">
            <div class="def-tier-head">
              <span class="tier-num">III</span>
              <span class="tier-label">Related Terms</span>
            </div>
            <div class="def-tier-compact">
              <div class="detail-block">
                <h4>Synonyms</h4>
                <div class="pill-row">${(word.synonyms || []).map(s => `<span class="pill">${escapeHtml(s)}</span>`).join('') || '<span class="pill">-</span>'}</div>
              </div>
              <div class="detail-block mb-0">
                <h4>Antonyms</h4>
                <div class="pill-row">${(word.antonyms || []).map(a => `<span class="pill">${escapeHtml(a)}</span>`).join('') || '<span class="pill">-</span>'}</div>
              </div>
            </div>
          </div>

          <!-- Image -->
          ${word.image_svg ? `
            <div class="word-image">
              <img src="${svgToDataUri(word.image_svg)}" alt="${escapeHtml(word.term)} illustration" />
            </div>
          ` : ''}

          <!-- Actions -->
          <div style="display:flex;gap:10px;margin-top:20px;">
            <button class="btn btn-secondary btn-sm" data-action="start-edit-word">Edit</button>
            <button class="btn btn-danger btn-sm" data-action="delete-word" data-word-id="${word.id}">Delete</button>
          </div>
        </div>
      </div>

      <!-- SM-2 Stats Footer -->
      <div class="sm2-stats">
        <div class="sm2-stat"><strong>${escapeHtml(word.review_count)}</strong><span>reviews</span></div>
        <div class="sm2-stat"><strong>${escapeHtml(word.repetitions)}</strong><span>reps</span></div>
        <div class="sm2-stat"><strong>${escapeHtml(word.interval_days)}d</strong><span>interval</span></div>
        <div class="sm2-stat"><strong>${escapeHtml(word.lapses)}</strong><span>lapses</span></div>
        <div class="sm2-stat"><strong>${escapeHtml(word.ease_factor)}</strong><span>EF</span></div>
      </div>
    </div>
  `;
}

/* --- Word Editor (used in Add + Library) --- */
function renderWordEditor(editor, source, options = {}) {
  if (!editor) {
    return `<div class="empty-state">No editable card is open yet.</div>`;
  }

  const preview = editorToCard(editor);
  const exampleCount = preview.examples.length;
  const synonymCount = preview.synonyms.length;
  const antonymCount = preview.antonyms.length;

  return `
    <div>
      <div class="section-heading">
        <div>
          <h3>${escapeHtml(options.title || 'Card Editor')}</h3>
          <p>${escapeHtml(options.copy || 'Edit every asset directly before saving.')}</p>
        </div>
        <div class="pill-row">
          <span class="pill">${escapeHtml(exampleCount)} examples</span>
          <span class="pill">${escapeHtml(synonymCount)} synonyms</span>
          <span class="pill">${escapeHtml(antonymCount)} antonyms</span>
        </div>
      </div>

      <div class="editor-grid">
        <div class="field">
          <label>Term</label>
          <input class="input" data-editor-source="${source}" data-editor-field="term" value="${escapeHtml(editor.term)}" placeholder="Quixotic" />
        </div>
        <div class="field">
          <label>Part of Speech</label>
          <input class="input" data-editor-source="${source}" data-editor-field="part_of_speech" value="${escapeHtml(editor.part_of_speech)}" placeholder="adjective" />
        </div>
      </div>

      <div class="field">
        <label>American Phonetics</label>
        <input class="input" data-editor-source="${source}" data-editor-field="phonetics_us" value="${escapeHtml(editor.phonetics_us)}" placeholder="/kwik-sot-ik/" />
      </div>

      <div class="field">
        <label>Definition</label>
        <textarea class="textarea" data-editor-source="${source}" data-editor-field="definition" placeholder="A concise but precise definition.">${escapeHtml(editor.definition)}</textarea>
      </div>

      <div class="field">
        <label>Nuances</label>
        <textarea class="textarea" data-editor-source="${source}" data-editor-field="nuances" placeholder="Subtle shades of meaning, register, and usage.">${escapeHtml(editor.nuances)}</textarea>
      </div>

      <div class="editor-grid">
        <div class="field">
          <label>Synonyms (comma separated)</label>
          <textarea class="textarea sm" data-editor-source="${source}" data-editor-field="synonyms_text" placeholder="idealistic, romantic">${escapeHtml(editor.synonyms_text)}</textarea>
        </div>
        <div class="field">
          <label>Antonyms (comma separated)</label>
          <textarea class="textarea sm" data-editor-source="${source}" data-editor-field="antonyms_text" placeholder="practical, realistic">${escapeHtml(editor.antonyms_text)}</textarea>
        </div>
      </div>

      <div class="field">
        <label>Examples (one per line, exactly 10 when saving)</label>
        <textarea class="textarea lg" data-editor-source="${source}" data-editor-field="examples_text" placeholder="Write one example sentence per line.">${escapeHtml(editor.examples_text)}</textarea>
      </div>

      <div class="field">
        <label>Image Prompt</label>
        <textarea class="textarea" data-editor-source="${source}" data-editor-field="image_prompt" placeholder="A vivid visual scene to help picture the word.">${escapeHtml(editor.image_prompt)}</textarea>
      </div>

      <div class="field">
        <label>Generated Illustration SVG</label>
        <textarea class="textarea lg" data-editor-source="${source}" data-editor-field="image_svg" placeholder="<svg ...>">${escapeHtml(editor.image_svg)}</textarea>
      </div>

      <div class="btn-row">
        <button class="btn btn-primary" data-action="${escapeHtml(options.saveAction || '')}">${escapeHtml(options.saveLabel || 'Save')}</button>
        ${options.cancelAction ? `<button class="btn btn-secondary" data-action="${escapeHtml(options.cancelAction)}">Cancel</button>` : ''}
      </div>

      <!-- Live Preview -->
      <div style="margin-top:32px;">
        <div class="detail-block"><h4>Live Preview</h4></div>
        ${renderWordPreviewCompact(preview)}
      </div>
    </div>
  `;
}

/* mini preview for the editor */
function renderWordPreviewCompact(word) {
  if (!word) return '';
  return `
    <div style="border:1px solid var(--outline-variant);border-radius:var(--radius-lg);padding:24px;">
      ${word.image_svg ? `<div class="word-image" style="margin-bottom:16px;aspect-ratio:16/10;max-height:240px;"><img src="${svgToDataUri(word.image_svg)}" alt="${escapeHtml(word.term)}" /></div>` : ''}
      <h3 style="font-family:var(--font-headline);font-size:28px;margin-bottom:4px;">${escapeHtml(word.term)}</h3>
      <p style="font-size:13px;color:var(--secondary);margin-bottom:12px;">${escapeHtml(word.part_of_speech)} / ${escapeHtml(word.phonetics_us)}</p>
      <p style="font-size:14px;line-height:1.7;margin-bottom:12px;">${escapeHtml(word.definition)}</p>
      <p style="font-size:13px;color:var(--on-surface-variant);line-height:1.7;">${escapeHtml(word.nuances)}</p>
      ${word.synonyms?.length ? `<div class="pill-row" style="margin-top:12px;">${word.synonyms.map(s => `<span class="pill">${escapeHtml(s)}</span>`).join('')}</div>` : ''}
    </div>
  `;
}

/* --- Review / Quiz Screen --- */
function renderReview() {
  const summary = state.review.summary;

  if (!state.review.active) {
    return `
      <div class="page-header">
        <div class="page-header-row">
          <div>
            <div class="page-eyebrow">${escapeHtml(SCREEN_COPY.review.eyebrow)}</div>
            <h2 class="page-title">${escapeHtml(SCREEN_COPY.review.title)}</h2>
            <p class="page-subtitle">${escapeHtml(SCREEN_COPY.review.subtitle)}</p>
          </div>
        </div>
      </div>

      <div style="display:grid;grid-template-columns:1fr 1fr;gap:24px;">
        <div class="card card-padded">
          <div class="section-heading">
            <div>
              <h3>Ready Queue</h3>
              <p>${state.dueQueue.count ? `${state.dueQueue.count} words are due right now.` : 'You are caught up.'}</p>
            </div>
          </div>
          ${state.dueQueue.count ? `
            <div class="btn-row" style="margin-bottom:20px;">
              <button class="btn btn-primary" data-action="start-review">
                <span class="material-symbols-outlined" style="font-size:18px">play_arrow</span>
                Start review session
              </button>
            </div>
          ` : ''}
          ${renderQueueList(state.dueQueue.items.slice(0, 8), 'Nothing is due. Add more words or come back later.')}
        </div>

        <div class="card card-padded">
          <div class="section-heading">
            <div>
              <h3>Last Session</h3>
              <p>SM-2 ratings summary from your most recent review.</p>
            </div>
          </div>
          ${summary ? renderReviewSummary(summary) : `<div class="empty-state">Complete a review session to see your summary.</div>`}
        </div>
      </div>
    `;
  }

  const current = state.review.items[state.review.index];
  if (!current) {
    return `<div class="empty-state">No active review card found.</div>`;
  }

  if (!state.review.revealed) {
    return renderQuizPrompt(current);
  }

  return renderQuizReveal(current);
}

function renderQuizPrompt(current) {
  const total = state.review.items.length;
  const idx = state.review.index + 1;
  const pct = Math.round((idx / total) * 100);
  const prompt = current.review_prompt || {
    headline: 'Recall the definition',
    prompt: current.term,
    support: `${current.part_of_speech} / ${current.phonetics_us}`,
    type: 'term_to_definition'
  };

  return `
    <div class="quiz-layout">
      <div class="quiz-header">
        <h1>${escapeHtml(prompt.headline)}</h1>
        <p>Question ${idx} of ${total}</p>
        <div class="progress-track">
          <div class="progress-meta"><span>Question ${idx} of ${total}</span><span>${pct}%</span></div>
          <div class="progress-bar"><div class="progress-fill" style="width:${pct}%"></div></div>
        </div>
      </div>

      <div class="quiz-card">
        <div class="quiz-instruction">Recall before revealing the card</div>
        <h2 class="quiz-term">${escapeHtml(prompt.prompt)}</h2>
        <p class="quiz-phonetics">${escapeHtml(prompt.support || '')}</p>
        <div class="pill-row" style="justify-content:center;margin-bottom:28px;">
          <span class="pill">${escapeHtml(prompt.type)}</span>
          <span class="pill">Priority ${escapeHtml(current.priority_score)}</span>
        </div>
        <button class="btn btn-primary quiz-reveal-btn" data-action="reveal-review">
          <span class="material-symbols-outlined" style="font-size:20px">visibility</span>
          Reveal Full Card
        </button>
      </div>

      <div class="quiz-bottom-actions">
        <button><span class="material-symbols-outlined" style="font-size:18px">flag</span> Flag for later</button>
        <span style="font-size:13px;color:var(--on-surface-variant)">${escapeHtml(current.progress_state)}</span>
      </div>
    </div>
  `;
}

function renderQuizReveal(current) {
  const total = state.review.items.length;
  const idx = state.review.index + 1;
  const pct = Math.round((idx / total) * 100);

  return `
    <div class="quiz-layout">
      <div class="quiz-header">
        <h1>Rate Difficulty</h1>
        <p>Question ${idx} of ${total}</p>
        <div class="progress-track">
          <div class="progress-meta"><span>Question ${idx} of ${total}</span><span>${pct}%</span></div>
          <div class="progress-bar"><div class="progress-fill" style="width:${pct}%"></div></div>
        </div>
      </div>

      <div class="quiz-reveal">
        <div class="card card-padded reveal-card">
          <h2>${escapeHtml(current.term)}</h2>
          <p style="font-size:14px;color:var(--secondary);margin-bottom:16px;">${escapeHtml(current.part_of_speech)} / ${escapeHtml(current.phonetics_us)}</p>
          <p class="reveal-definition">${escapeHtml(current.definition)}</p>
          <p class="reveal-nuance">${escapeHtml(current.nuances)}</p>
          ${current.synonyms?.length ? `<div class="pill-row">${current.synonyms.map(s => `<span class="pill">${escapeHtml(s)}</span>`).join('')}</div>` : ''}
          ${current.examples?.length ? `<div class="context-quote">"${escapeHtml(current.examples[0])}"</div>` : ''}
        </div>

        <div class="detail-block text-center">
          <h4>Rate Difficulty</h4>
          <p style="font-size:13px;color:var(--on-surface-variant);margin-bottom:16px;">How difficult was this recall?</p>
        </div>
        <div class="rating-row">
          ${REVIEW_RATING_ORDER.map(label => {
            const cls = label === 'Again' ? 'btn-danger' : label === 'Easy' ? 'btn-primary' : 'btn-secondary';
            return `<button class="btn ${cls}" data-action="rate-review" data-rating="${label}">${label}</button>`;
          }).join('')}
        </div>
      </div>
    </div>
  `;
}

function renderQueueList(items, emptyCopy = 'No due words yet.') {
  if (!items.length) return `<div class="empty-state">${escapeHtml(emptyCopy)}</div>`;

  return `
    <div class="queue-list">
      ${items.map(item => `
        <div class="queue-item">
          <strong>${escapeHtml(item.term)}</strong>
          <div class="queue-meta">
            <span>${escapeHtml(item.part_of_speech)}</span>
            <span>${escapeHtml(item.phonetics_us)}</span>
            <span>${escapeHtml(item.progress_state)}</span>
            <span>${escapeHtml(formatDate(item.next_review_at))}</span>
            ${typeof item.priority_score === 'number' ? `<span class="queue-score">priority ${escapeHtml(item.priority_score)}</span>` : ''}
          </div>
        </div>
      `).join('')}
    </div>
  `;
}

function renderReviewSummary(summary) {
  return `
    <div class="review-summary">
      <div class="sm2-stat"><strong>${escapeHtml(summary.completed)}</strong><span>reviewed</span></div>
      ${REVIEW_RATING_ORDER.map(label => `
        <div class="sm2-stat"><strong>${escapeHtml(summary.ratings[label])}</strong><span>${escapeHtml(label.toLowerCase())}</span></div>
      `).join('')}
    </div>
  `;
}

/* --- Settings Screen --- */
function renderSettings() {
  const googleClientConfigured = Boolean(getGoogleClientId());
  const providerId = getActiveProviderId();
  const form = getActiveProviderForm();
  const saved = getSettingsSnapshot().providers?.[providerId] || {};

  return `
    <div class="page-header">
      <div class="page-header-row">
        <div>
          <div class="page-eyebrow">${escapeHtml(SCREEN_COPY.settings.eyebrow)}</div>
          <h2 class="page-title">${escapeHtml(SCREEN_COPY.settings.title)}</h2>
          <p class="page-subtitle">${escapeHtml(SCREEN_COPY.settings.subtitle)}</p>
        </div>
      </div>
    </div>

    <div class="settings-grid">
      <div class="settings-hero">
        <div class="page-eyebrow">Routing</div>
        <h3 style="font-family:var(--font-headline);font-size:28px;margin:8px 0;">Choose where WordForge generates assets.</h3>
        <p>Keys stay encrypted on the server. The active provider is used for single-card generation and Google Docs imports.</p>
      </div>

      <div class="provider-grid">
        ${Object.entries(PROVIDER_META).map(([pid, meta]) => {
          const pSaved = getSettingsSnapshot().providers?.[pid] || {};
          const isActive = getActiveProviderId() === pid;
          return `
            <button class="provider-card ${isActive ? 'active' : ''}" data-action="select-provider" data-provider="${pid}">
              <div class="provider-card-head">
                <div>
                  <strong>${escapeHtml(meta.label)}</strong>
                  <div class="provider-caption">${escapeHtml(meta.caption)}</div>
                </div>
                <span class="provider-dot ${pSaved.connection_status || 'missing'}"></span>
              </div>
              <p>${escapeHtml(meta.copy)}</p>
              <div class="pill-row">
                <span class="pill">${escapeHtml(pSaved.model || 'No model')}</span>
                <span class="pill">${pSaved.has_key ? 'Key saved' : 'No key'}</span>
              </div>
            </button>
          `;
        }).join('')}
      </div>

      <!-- Provider Form -->
      <div class="card card-padded">
        <div class="section-heading">
          <div>
            <h3>${escapeHtml(titleCaseProvider(providerId))} Provider</h3>
            <p>${escapeHtml(PROVIDER_META[providerId].copy)}</p>
          </div>
        </div>

        <div class="field">
          <label>Model</label>
          ${getDetectedModels(providerId).length ? `
            <select class="input" data-provider-field="${providerId}" data-provider-prop="model">
              <option value="">Choose a detected model</option>
              ${getDetectedModels(providerId).map((model) => `
                <option value="${escapeHtml(model)}" ${model === form.model ? 'selected' : ''}>${escapeHtml(model)}</option>
              `).join('')}
            </select>
          ` : `
            <input class="input" data-provider-field="${providerId}" data-provider-prop="model" value="${escapeHtml(form.model)}" placeholder="Test your API key to detect models" />
          `}
        </div>

        <div class="field">
          <label>API Key</label>
          <input type="password" class="input" data-provider-field="${providerId}" data-provider-prop="api_key" value="${escapeHtml(form.api_key)}" placeholder="${providerId === 'anthropic' ? 'sk-ant-...' : 'sk-...'}" />
        </div>

        <div class="btn-row">
          <button class="btn btn-primary" data-action="test-settings">Test key and detect models</button>
          <button class="btn btn-secondary" data-action="save-settings">Save settings</button>
        </div>

        <div class="detail-block" style="margin-top:20px;">
          <h4>Status</h4>
          <div class="pill-row">
            <span class="pill">${escapeHtml(saved.connection_status || 'missing')}</span>
            <span class="pill">${saved.has_key ? 'Key saved' : 'No key'}</span>
            <span class="pill">Tested ${escapeHtml(saved.last_tested_at ? formatDate(saved.last_tested_at) : 'never')}</span>
          </div>
        </div>
      </div>

      <!-- Profile -->
      <div class="card card-padded">
        <div class="section-heading">
          <div>
            <h3>Learner Profile</h3>
            <p>Your daily rhythm and pronunciation standard.</p>
          </div>
        </div>

        <div class="field">
          <label for="learnerNameInput">Learner name</label>
          <input id="learnerNameInput" class="input" value="${escapeHtml(state.profileForm.learner_name)}" placeholder="Your name" />
        </div>
        <div class="field">
          <label for="dailyGoalInput">Daily review goal</label>
          <input id="dailyGoalInput" type="number" min="1" max="50" class="input" value="${escapeHtml(state.profileForm.daily_goal)}" />
        </div>

        <div class="btn-row" style="margin-bottom:20px;">
          <button class="btn btn-primary" data-action="save-profile">Save profile</button>
        </div>

        <div class="detail-block">
          <h4>Storage</h4>
          <p>WordForge stores words, settings, and review state in a local database.</p>
        </div>

        <div class="detail-block">
          <h4>Google Docs OAuth</h4>
          <p>${googleClientConfigured ? 'Private Google Docs import is enabled.' : 'Set GOOGLE_OAUTH_CLIENT_ID on the server to enable.'}</p>
        </div>
      </div>
    </div>
  `;
}

/* ============================================================
   Main Render Orchestrator
   ============================================================ */

function renderMain() {
  if (state.screen === 'add') return renderAdd();
  if (state.screen === 'library') return renderLibrary();
  if (state.screen === 'review') return renderReview();
  if (state.screen === 'settings') return renderSettings();
  return renderHome();
}

function render() {
  app.innerHTML = `
    <div class="app-shell ${state.loading ? 'loading' : ''}">
      ${renderSidebar()}
      <div class="main-area">
        ${renderTopHeader()}
        <div class="page-content">
          ${renderMain()}
        </div>
      </div>
      ${renderBottomNav()}
    </div>
    ${renderToasts()}
  `;
}

/* ============================================================
   Event Listeners (preserved, with updated selectors)
   ============================================================ */

function handleFormInput(event) {
  const target = event.target;

  if (target.id === 'addWordInput') state.addWordInput = target.value;
  if (target.id === 'importUrlInput') state.importUrl = target.value;
  if (target.id === 'searchInput') {
    state.search = target.value;
    render();
    return;
  }
  if (target.id === 'learnerNameInput') state.profileForm.learner_name = target.value;
  if (target.id === 'dailyGoalInput') state.profileForm.daily_goal = Number(target.value || 0);

  const providerId = target.getAttribute('data-provider-field');
  const providerProp = target.getAttribute('data-provider-prop');
  if (providerId && providerProp) {
    state.settingsForm.providers[providerId][providerProp] = target.value;
  }

  const editorSource = target.getAttribute('data-editor-source');
  const editorField = target.getAttribute('data-editor-field');
  if (editorSource && editorField) {
    const editor = editorSource === 'draft' ? state.draftEditor : state.libraryEditor;
    if (editor) {
      editor[editorField] = target.value;
      render();
      return;
    }
  }
}

document.addEventListener('input', handleFormInput);
document.addEventListener('change', handleFormInput);

document.addEventListener('click', async (event) => {
  const button = event.target.closest('button');
  if (!button) return;

  const screen = button.getAttribute('data-screen');
  const action = button.getAttribute('data-action');
  const wordId = button.getAttribute('data-word-id');

  if (screen) {
    /* If clicking a word-day-card "View Details", also select that word */
    if (action === 'select-word' && wordId) {
      state.selectedWordId = wordId;
      state.libraryEditingId = null;
      state.libraryEditor = null;
    }
    state.screen = screen;
    clearMessages();
    render();
    return;
  }

  if (!action) return;

  if (action === 'generate-word') return handleGenerateWord();
  if (action === 'save-draft') return handleSaveDraft();
  if (action === 'clear-draft') {
    state.draftEditor = null;
    clearMessages();
    render();
    return;
  }
  if (action === 'import-doc') return handleImportGoogleDoc();
  if (action === 'select-word') {
    state.selectedWordId = wordId;
    state.libraryEditingId = null;
    state.libraryEditor = null;
    render();
    return;
  }
  if (action === 'start-edit-word') {
    const selectedWord = getSelectedWord();
    if (!selectedWord) return;
    state.libraryEditingId = selectedWord.id;
    state.libraryEditor = createWordEditor(selectedWord);
    clearMessages();
    render();
    return;
  }
  if (action === 'cancel-edit-word') {
    state.libraryEditingId = null;
    state.libraryEditor = null;
    clearMessages();
    render();
    return;
  }
  if (action === 'save-word-edit') return handleSaveWordEdit();
  if (action === 'delete-word') return handleDeleteWord(wordId);
  if (action === 'start-review') return startReviewSession();
  if (action === 'reveal-review') return revealReviewCard();
  if (action === 'rate-review') return submitReviewRating(button.getAttribute('data-rating'));
  if (action === 'save-settings') return handleSaveSettings();
  if (action === 'test-settings') return handleTestSettings();
  if (action === 'save-profile') return handleSaveProfile();
  if (action === 'select-provider') {
    state.settingsForm.active_provider = button.getAttribute('data-provider');
    clearMessages();
    render();
  }
});

/* Handle Enter key on add word input */
document.addEventListener('keydown', (event) => {
  if (event.key === 'Enter' && event.target.id === 'addWordInput') {
    event.preventDefault();
    handleGenerateWord();
  }
});

/* ============================================================
   Bootstrap
   ============================================================ */

loadBootstrap();
