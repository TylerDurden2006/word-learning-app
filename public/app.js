import { REVIEW_RATING_ORDER, createEmptyWordEditor, splitCommaList, splitExampleList } from './view-model.mjs';

const NAV_ITEMS = [
  { id: 'home', title: 'Dashboard', icon: 'dashboard' },
  { id: 'library', title: 'Dictionary', icon: 'auto_stories' },
  { id: 'add', title: 'Add Word', icon: 'add_circle' },
  { id: 'review', title: 'Review', icon: 'quiz' },
  { id: 'settings', title: 'Profile', icon: 'settings' }
];

const SCREEN_COPY = {
  home: {
    eyebrow: 'WordForge',
    title: "Today's study desk",
    subtitle: 'A focused view of the words most worth your attention right now.'
  },
  add: {
    eyebrow: 'Manual entry',
    title: 'Add a complete word card.',
    subtitle: 'Store the definition, examples, related words, pronunciation, and visual cue yourself.'
  },
  library: {
    eyebrow: 'Dictionary',
    title: 'Personal Dictionary',
    subtitle: 'Search, inspect, and refine your saved cards without disturbing review history.'
  },
  review: {
    eyebrow: 'Practice',
    title: 'Active Recall',
    subtitle: 'Work through due cards with rotating prompts and spaced-repetition scheduling.'
  },
  settings: {
    eyebrow: 'Profile',
    title: 'Learner Profile',
    subtitle: 'Set your daily rhythm and review preferences.'
  }
};

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
  draftEditor: createEmptyWordEditor(),
  libraryEditingId: null,
  libraryEditor: null,
  review: {
    active: false,
    index: 0,
    items: [],
    revealed: false,
    summary: null
  },
  profileForm: {
    learner_name: 'Learner',
    daily_goal: 12,
    new_cards_per_day: 10,
    review_prompt_mix: 'balanced'
  }
};

const app = document.getElementById('app');

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function imageAssetToSrc(asset) {
  const value = String(asset || '').trim();
  if (!value) return '';
  if (value.includes('<svg')) {
    return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(value)}`;
  }
  return value;
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

function editorFromWord(word = null) {
  if (!word) return createEmptyWordEditor();
  return {
    term: word.term || '',
    definition: word.definition || '',
    nuances: word.nuances || '',
    phonetics_us: word.phonetics_us || '',
    part_of_speech: word.part_of_speech || '',
    synonyms_text: Array.isArray(word.synonyms) ? word.synonyms.join(', ') : '',
    antonyms_text: Array.isArray(word.antonyms) ? word.antonyms.join(', ') : '',
    examples_text: Array.isArray(word.examples) ? word.examples.join('\n') : '',
    visual_cue: word.visual_cue || '',
    image_asset: word.image_asset || ''
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
    visual_cue: String(editor.visual_cue || '').trim(),
    image_asset: String(editor.image_asset || '').trim()
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
  return state.words.filter((word) => [
    word.term,
    word.definition,
    word.nuances,
    word.part_of_speech,
    word.visual_cue,
    ...(word.synonyms || []),
    ...(word.antonyms || [])
  ].some((value) => String(value || '').toLowerCase().includes(query)));
}

function clearMessages() {
  state.notice = '';
  state.error = '';
}

function setNotice(message) {
  state.notice = message;
  state.error = '';
}

function setError(message) {
  state.error = message;
  state.notice = '';
}

function apiBaseUrl() {
  const configured = window.WORDFORGE_CONFIG?.apiBaseUrl
    || document.querySelector('meta[name="wordforge-api-base"]')?.getAttribute('content')
    || '';
  return configured.replace(/\/+$/, '');
}

async function api(path, options = {}) {
  const response = await fetch(`${apiBaseUrl()}${path}`, {
    headers: { 'content-type': 'application/json', ...(options.headers || {}) },
    ...options
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = payload.error || {};
    throw new Error(error.message || `Request failed with ${response.status}`);
  }
  return payload;
}

function hydrateFromBootstrap(payload) {
  state.bootstrap = payload;
  state.words = payload.words || [];
  state.dueQueue = payload.due_queue || { count: 0, items: [] };
  state.profileForm = {
    learner_name: payload.profile?.learner_name || 'Learner',
    daily_goal: payload.profile?.daily_goal || 12,
    new_cards_per_day: payload.review_preferences?.new_cards_per_day || 10,
    review_prompt_mix: payload.review_preferences?.review_prompt_mix || 'balanced'
  };
  if (!state.selectedWordId || !state.words.some((word) => word.id === state.selectedWordId)) {
    state.selectedWordId = state.words[0]?.id || null;
  }
}

async function loadBootstrap({ keepSelection = true } = {}) {
  state.loading = true;
  state.loadingLabel = 'Loading WordForge';
  render();
  try {
    const previousSelection = keepSelection ? state.selectedWordId : null;
    hydrateFromBootstrap(await api('/api/bootstrap'));
    state.selectedWordId = previousSelection && state.words.some((word) => word.id === previousSelection)
      ? previousSelection
      : state.words[0]?.id || null;
    if (state.review.active) {
      state.review.items = state.dueQueue.items;
      if (!state.review.items.length) state.review.active = false;
      state.review.index = Math.min(state.review.index, Math.max(0, state.review.items.length - 1));
    }
  } catch (error) {
    setError(error.message);
  } finally {
    state.loading = false;
    state.loadingLabel = '';
    render();
  }
}

async function handleSaveDraft() {
  const card = editorToCard(state.draftEditor);
  state.loading = true;
  state.loadingLabel = `Saving ${card.term || 'word'}`;
  clearMessages();
  render();
  try {
    const payload = await api('/api/words', {
      method: 'POST',
      body: JSON.stringify({ card, source: { type: 'manual', label: 'Manual entry' } })
    });
    state.draftEditor = createEmptyWordEditor();
    await loadBootstrap({ keepSelection: false });
    state.screen = 'library';
    state.selectedWordId = payload.word.id;
    setNotice(`${payload.word.term} is saved and ready for review.`);
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
  state.loadingLabel = `Updating ${card.term || 'word'}`;
  clearMessages();
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
    setNotice(`${payload.word.term} was updated without resetting review history.`);
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
    if (state.selectedWordId === wordId) state.selectedWordId = null;
    state.libraryEditingId = null;
    state.libraryEditor = null;
    await loadBootstrap({ keepSelection: false });
    setNotice(`Removed ${word.term}.`);
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
  state.review = { active: true, index: 0, items: [...state.dueQueue.items], revealed: false, summary: null };
  clearMessages();
  render();
}

function revealReviewCard() {
  state.review.revealed = true;
  render();
}

async function submitReviewRating(rating) {
  const current = state.review.items[state.review.index];
  if (!current) return;
  state.loading = true;
  state.loadingLabel = `Scheduling ${current.term}`;
  render();
  try {
    await api('/api/review', {
      method: 'POST',
      body: JSON.stringify({ word_id: current.id, rating })
    });
    const summary = state.review.summary || {
      completed: 0,
      ratings: Object.fromEntries(REVIEW_RATING_ORDER.map((label) => [label, 0]))
    };
    summary.completed += 1;
    summary.ratings[rating] += 1;
    const isLast = state.review.index >= state.review.items.length - 1;
    await loadBootstrap();
    if (isLast) {
      state.review = { active: false, index: 0, items: [], revealed: false, summary };
      setNotice('Review session complete. Your queue has been re-ranked.');
    } else {
      state.review.index += 1;
      state.review.items = state.dueQueue.items;
      state.review.revealed = false;
      state.review.summary = summary;
    }
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
  state.loadingLabel = 'Saving profile';
  clearMessages();
  render();
  try {
    const payload = await api('/api/profile', {
      method: 'POST',
      body: JSON.stringify({
        learner_name: state.profileForm.learner_name,
        daily_goal: Number(state.profileForm.daily_goal),
        new_cards_per_day: Number(state.profileForm.new_cards_per_day),
        review_prompt_mix: state.profileForm.review_prompt_mix
      })
    });
    state.bootstrap = {
      ...state.bootstrap,
      profile: payload.profile,
      review_preferences: payload.review_preferences
    };
    setNotice('Profile saved.');
  } catch (error) {
    setError(error.message);
  } finally {
    state.loading = false;
    state.loadingLabel = '';
    render();
  }
}

function renderShell(content) {
  return `
    <div class="app-shell">
      <aside class="sidebar">
        <div class="brand"><span class="brand-mark">W</span><div><strong>WordForge</strong><small>Manual dictionary</small></div></div>
        <nav class="nav-list">
          ${NAV_ITEMS.map((item) => `
            <button class="nav-item ${state.screen === item.id ? 'active' : ''}" data-screen="${item.id}">
              <span class="material-symbols-outlined">${item.icon}</span>
              <span>${escapeHtml(item.title)}</span>
            </button>
          `).join('')}
        </nav>
      </aside>
      <main class="main-panel">
        ${state.loading ? `<div class="loading-bar">${escapeHtml(state.loadingLabel || 'Working')}</div>` : ''}
        ${state.notice ? `<div class="notice success">${escapeHtml(state.notice)}</div>` : ''}
        ${state.error ? `<div class="notice error">${escapeHtml(state.error)}</div>` : ''}
        ${content}
      </main>
    </div>
  `;
}

function renderHome() {
  const stats = getStats();
  const totalWords = Number(stats.total_words || 0);
  const masteredPct = totalWords ? Math.round((stats.mastered_words / totalWords) * 100) : 0;
  const dailyGoal = Number(state.bootstrap?.profile?.daily_goal || state.profileForm.daily_goal || 12);
  const dailyPct = dailyGoal ? Math.min(100, Math.round((Number(stats.reviews_today || 0) / dailyGoal) * 100)) : 0;
  const featured = (state.dueQueue.items || [])[0] || (stats.recent_words || [])[0] || null;

  return `
    <section class="desk-hero-shell">
      <div class="desk-copy">
        <div class="page-eyebrow">${SCREEN_COPY.home.eyebrow}</div>
        <h2 class="page-title">${SCREEN_COPY.home.title}</h2>
        <p class="page-subtitle">${SCREEN_COPY.home.subtitle}</p>
        <div class="desk-actions">
          <button class="btn btn-primary" data-screen="review"><span class="material-symbols-outlined">play_arrow</span>Start due review</button>
          <button class="btn btn-secondary" data-screen="add"><span class="material-symbols-outlined">add</span>Add word</button>
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
        ['Learning', stats.learning_words, 'Active cards']
      ].map(([label, value, note]) => `
        <div class="metric-chip"><div class="metric-chip-label">${escapeHtml(label)}</div><div class="metric-chip-value">${escapeHtml(value)}</div><div class="metric-chip-note">${escapeHtml(note)}</div></div>
      `).join('')}
    </div>
    <div class="study-grid">
      <article class="card featured-card">
        ${featured ? `
          <div class="featured-topline"><span>${state.dueQueue.items?.some(item => item.id === featured.id) ? 'Highest priority' : 'Recent card'}</span><button class="text-command" data-action="select-word" data-word-id="${featured.id}" data-screen="library">Open</button></div>
          <h3 class="featured-term">${escapeHtml(featured.term)}</h3>
          <p class="featured-phonetics">${escapeHtml(featured.part_of_speech)} / ${escapeHtml(featured.phonetics_us)}</p>
          <p class="featured-definition">${escapeHtml(featured.definition)}</p>
          ${featured.examples?.length ? `<blockquote class="featured-quote">${escapeHtml(featured.examples[0])}</blockquote>` : ''}
        ` : `<div class="empty-state empty-quiet"><strong>Your dictionary is empty.</strong><span>Add your first word card to begin.</span><button class="btn btn-primary" data-screen="add">Add a word</button></div>`}
      </article>
      <section class="card card-padded queue-panel">
        <div class="section-heading"><div><h3>Due priority</h3><p>Cards most likely to slip are shown first.</p></div><span class="pill">${escapeHtml(state.dueQueue.count)} due</span></div>
        ${renderQueueList((state.dueQueue.items || []).slice(0, 4), 'Nothing is due right now.')}
      </section>
      <section class="card card-padded mastery-panel">
        <div class="chart-title">Mastery split</div>
        <div class="mastery-meter" style="--mastered:${masteredPct};"><div class="mastery-fill"></div></div>
        <div class="legend-row"><div class="legend-item"><span class="legend-dot"></span><span>Mastered</span><strong>${masteredPct}%</strong></div><div class="legend-item"><span class="legend-dot learning"></span><span>Learning</span><strong>${100 - masteredPct}%</strong></div></div>
      </section>
    </div>
  `;
}

function renderAdd() {
  return `
    <div class="page-header"><div class="page-eyebrow">${SCREEN_COPY.add.eyebrow}</div><h2 class="page-title">${SCREEN_COPY.add.title}</h2><p class="page-subtitle">${SCREEN_COPY.add.subtitle}</p></div>
    <div class="card card-padded editor-card">
      ${renderWordEditor(state.draftEditor, 'draft', { title: 'New word card', copy: 'All rich fields are required except the optional image asset.', saveAction: 'save-draft', saveLabel: 'Save word' })}
    </div>
  `;
}

function renderLibrary() {
  const words = getFilteredWords();
  const selectedWord = getSelectedWord();
  const isEditing = Boolean(selectedWord && state.libraryEditingId === selectedWord.id && state.libraryEditor);
  return `
    <div class="page-header"><div class="page-eyebrow">${SCREEN_COPY.library.eyebrow}</div><h2 class="page-title">${SCREEN_COPY.library.title}</h2><p class="page-subtitle">${SCREEN_COPY.library.subtitle}</p></div>
    <div class="vault-header-row"><div class="vault-search"><span class="material-symbols-outlined">search</span><input id="searchInput" type="text" placeholder="Search your dictionary..." value="${escapeHtml(state.search)}" /></div></div>
    <div class="library-grid">
      <div class="vault-card-list">
        ${words.length ? words.map(word => `
          <button class="vault-card ${state.selectedWordId === word.id ? 'selected' : ''}" data-action="select-word" data-word-id="${word.id}">
            <div style="position:relative;z-index:1;display:flex;flex-direction:column;height:100%">
              <span class="vault-card-category" style="color:var(--secondary)">${escapeHtml(word.part_of_speech)}</span>
              <div class="vault-card-term">${escapeHtml(word.term)}</div>
              <p class="vault-card-def">${escapeHtml((word.definition || '').slice(0, 110))}${(word.definition?.length || 0) > 110 ? '...' : ''}</p>
              <div class="vault-card-center" style="margin-top:auto"><span class="mastery-badge ${word.progress_state === 'mastered' ? 'mastered' : 'learning'}"><span class="badge-dot"></span>${escapeHtml(word.progress_state)}</span></div>
            </div>
          </button>
        `).join('') : `<div class="empty-state" style="grid-column:1/-1;">No cards match this search.</div>`}
      </div>
      <div>
        ${isEditing
          ? `<div class="card card-padded">${renderWordEditor(state.libraryEditor, 'library', { title: 'Edit word card', copy: 'Changes keep review history intact.', saveAction: 'save-word-edit', saveLabel: 'Save changes', cancelAction: 'cancel-edit-word' })}</div>`
          : renderWordDetailPanel(selectedWord)}
      </div>
    </div>
  `;
}

function renderWordDetailPanel(word) {
  if (!word) return `<div class="card card-padded"><div class="empty-state">Select a word to see its details.</div></div>`;
  const imageSrc = imageAssetToSrc(word.image_asset);
  return `
    <div class="card word-detail-panel">
      <div class="word-hero">
        <div class="word-hero-row"><h1 class="word-hero-term">${escapeHtml(word.term)}</h1><div class="pronunciation-btn"><span class="material-symbols-outlined">volume_up</span><span>${escapeHtml(word.phonetics_us)}</span></div></div>
        <div class="word-tags"><span class="word-tag primary">${escapeHtml(word.part_of_speech)}</span><span class="word-tag muted">${escapeHtml(word.progress_state)}</span></div>
      </div>
      <div class="definition-grid">
        <div>
          <div class="def-tier"><div class="def-tier-head"><span class="tier-num">I</span><span class="tier-label">Definition</span></div><div class="def-tier-body"><p class="def-text-large">${escapeHtml(word.definition)}</p></div></div>
          <div class="def-tier"><div class="def-tier-head"><span class="tier-num">II</span><span class="tier-label">Nuance</span></div><div class="def-tier-body"><p class="def-text">${escapeHtml(word.nuances)}</p>${word.examples?.length ? `<div class="context-quote">"${escapeHtml(word.examples[0])}"</div>` : ''}</div></div>
          <div class="def-tier"><div class="def-tier-head"><span class="tier-num">III</span><span class="tier-label">Visual Cue</span></div><div class="def-tier-body"><p class="def-text">${escapeHtml(word.visual_cue)}</p></div></div>
        </div>
        <div>
          <div class="def-tier"><div class="def-tier-head"><span class="tier-num">IV</span><span class="tier-label">Related Terms</span></div><div class="def-tier-compact"><div class="detail-block"><h4>Synonyms</h4><div class="pill-row">${(word.synonyms || []).map(s => `<span class="pill">${escapeHtml(s)}</span>`).join('')}</div></div><div class="detail-block mb-0"><h4>Antonyms</h4><div class="pill-row">${(word.antonyms || []).map(a => `<span class="pill">${escapeHtml(a)}</span>`).join('')}</div></div></div></div>
          ${imageSrc ? `<div class="word-image"><img src="${escapeHtml(imageSrc)}" alt="${escapeHtml(word.term)} visual asset" /></div>` : ''}
          <div style="display:flex;gap:10px;margin-top:20px;"><button class="btn btn-secondary btn-sm" data-action="start-edit-word">Edit</button><button class="btn btn-danger btn-sm" data-action="delete-word" data-word-id="${word.id}">Delete</button></div>
        </div>
      </div>
      <div class="sm2-stats">
        <div class="sm2-stat"><strong>${escapeHtml(word.review_count)}</strong><span>reviews</span></div>
        <div class="sm2-stat"><strong>${escapeHtml(word.interval_days)}d</strong><span>interval</span></div>
        <div class="sm2-stat"><strong>${escapeHtml(word.ease_factor)}</strong><span>ease</span></div>
        <div class="sm2-stat"><strong>${escapeHtml(word.lapses)}</strong><span>lapses</span></div>
        <div class="sm2-stat"><strong>${escapeHtml(word.leech_score || 0)}</strong><span>risk</span></div>
      </div>
    </div>
  `;
}

function renderWordEditor(editor, source, options = {}) {
  const preview = editorToCard(editor);
  return `
    <div>
      <div class="section-heading"><div><h3>${escapeHtml(options.title || 'Card editor')}</h3><p>${escapeHtml(options.copy || 'Edit every asset directly.')}</p></div><div class="pill-row"><span class="pill">${escapeHtml(preview.examples.length)} examples</span><span class="pill">${escapeHtml(preview.synonyms.length)} synonyms</span><span class="pill">${escapeHtml(preview.antonyms.length)} antonyms</span></div></div>
      <div class="editor-grid">
        <div class="field"><label>Term</label><input class="input" data-editor-source="${source}" data-editor-field="term" value="${escapeHtml(editor.term)}" placeholder="Quixotic" /></div>
        <div class="field"><label>Part of speech</label><input class="input" data-editor-source="${source}" data-editor-field="part_of_speech" value="${escapeHtml(editor.part_of_speech)}" placeholder="adjective" /></div>
      </div>
      <div class="field"><label>American phonetics</label><input class="input" data-editor-source="${source}" data-editor-field="phonetics_us" value="${escapeHtml(editor.phonetics_us)}" placeholder="/kwik-sot-ik/" /></div>
      <div class="field"><label>Definition</label><textarea class="textarea" data-editor-source="${source}" data-editor-field="definition">${escapeHtml(editor.definition)}</textarea></div>
      <div class="field"><label>Nuances</label><textarea class="textarea" data-editor-source="${source}" data-editor-field="nuances">${escapeHtml(editor.nuances)}</textarea></div>
      <div class="editor-grid">
        <div class="field"><label>Synonyms (comma separated)</label><textarea class="textarea sm" data-editor-source="${source}" data-editor-field="synonyms_text">${escapeHtml(editor.synonyms_text)}</textarea></div>
        <div class="field"><label>Antonyms (comma separated)</label><textarea class="textarea sm" data-editor-source="${source}" data-editor-field="antonyms_text">${escapeHtml(editor.antonyms_text)}</textarea></div>
      </div>
      <div class="field"><label>Examples (one per line, exactly 10)</label><textarea class="textarea lg" data-editor-source="${source}" data-editor-field="examples_text">${escapeHtml(editor.examples_text)}</textarea></div>
      <div class="field"><label>Visual cue</label><textarea class="textarea" data-editor-source="${source}" data-editor-field="visual_cue">${escapeHtml(editor.visual_cue)}</textarea></div>
      <div class="field"><label>Image asset (optional URL, data URI, or SVG)</label><textarea class="textarea lg" data-editor-source="${source}" data-editor-field="image_asset">${escapeHtml(editor.image_asset)}</textarea></div>
      <div class="btn-row"><button class="btn btn-primary" data-action="${escapeHtml(options.saveAction || '')}">${escapeHtml(options.saveLabel || 'Save')}</button>${options.cancelAction ? `<button class="btn btn-secondary" data-action="${escapeHtml(options.cancelAction)}">Cancel</button>` : ''}</div>
      <div style="margin-top:32px;"><div class="detail-block"><h4>Preview</h4></div>${renderWordPreviewCompact(preview)}</div>
    </div>
  `;
}

function renderWordPreviewCompact(word) {
  const imageSrc = imageAssetToSrc(word.image_asset);
  return `
    <div style="border:1px solid var(--outline-variant);border-radius:var(--radius-lg);padding:24px;">
      ${imageSrc ? `<div class="word-image" style="margin-bottom:16px;aspect-ratio:16/10;max-height:240px;"><img src="${escapeHtml(imageSrc)}" alt="${escapeHtml(word.term)}" /></div>` : ''}
      <h3 style="font-family:var(--font-headline);font-size:28px;margin-bottom:4px;">${escapeHtml(word.term || 'Untitled word')}</h3>
      <p style="font-size:13px;color:var(--secondary);margin-bottom:12px;">${escapeHtml(word.part_of_speech)} / ${escapeHtml(word.phonetics_us)}</p>
      <p style="font-size:14px;line-height:1.7;margin-bottom:12px;">${escapeHtml(word.definition)}</p>
      <p style="font-size:13px;color:var(--on-surface-variant);line-height:1.7;">${escapeHtml(word.visual_cue)}</p>
    </div>
  `;
}

function renderReview() {
  const summary = state.review.summary;
  if (!state.review.active) {
    return `
      <div class="page-header"><div class="page-eyebrow">${SCREEN_COPY.review.eyebrow}</div><h2 class="page-title">${SCREEN_COPY.review.title}</h2><p class="page-subtitle">${SCREEN_COPY.review.subtitle}</p></div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:24px;">
        <div class="card card-padded"><div class="section-heading"><div><h3>Ready Queue</h3><p>${state.dueQueue.count ? `${state.dueQueue.count} words are due right now.` : 'You are caught up.'}</p></div></div>${state.dueQueue.count ? `<div class="btn-row" style="margin-bottom:20px;"><button class="btn btn-primary" data-action="start-review"><span class="material-symbols-outlined" style="font-size:18px">play_arrow</span>Start review session</button></div>` : ''}${renderQueueList(state.dueQueue.items.slice(0, 8), 'Nothing is due. Add more words or come back later.')}</div>
        <div class="card card-padded"><div class="section-heading"><div><h3>Last Session</h3><p>Ratings summary from your most recent review.</p></div></div>${summary ? renderReviewSummary(summary) : `<div class="empty-state">Complete a review session to see your summary.</div>`}</div>
      </div>
    `;
  }
  const current = state.review.items[state.review.index];
  if (!current) return `<div class="empty-state">No active review card found.</div>`;
  return state.review.revealed ? renderQuizReveal(current) : renderQuizPrompt(current);
}

function renderQuizPrompt(current) {
  const total = state.review.items.length;
  const idx = state.review.index + 1;
  const pct = Math.round((idx / total) * 100);
  const prompt = current.review_prompt || { headline: 'Recall the definition', prompt: current.term, support: `${current.part_of_speech} / ${current.phonetics_us}`, type: 'term_to_definition' };
  return `
    <div class="quiz-layout">
      <div class="quiz-header"><h1>${escapeHtml(prompt.headline)}</h1><p>Question ${idx} of ${total}</p><div class="progress-track"><div class="progress-meta"><span>Question ${idx} of ${total}</span><span>${pct}%</span></div><div class="progress-bar"><div class="progress-fill" style="width:${pct}%"></div></div></div></div>
      <div class="quiz-card"><div class="quiz-instruction">Recall before revealing the card</div><h2 class="quiz-term">${escapeHtml(prompt.prompt)}</h2><p class="quiz-phonetics">${escapeHtml(prompt.support || '')}</p><div class="pill-row" style="justify-content:center;margin-bottom:28px;"><span class="pill">${escapeHtml(prompt.type)}</span><span class="pill">Priority ${escapeHtml(current.priority_score)}</span></div><button class="btn btn-primary quiz-reveal-btn" data-action="reveal-review"><span class="material-symbols-outlined" style="font-size:20px">visibility</span>Reveal card</button></div>
      <div class="quiz-bottom-actions"><span style="font-size:13px;color:var(--on-surface-variant)">${escapeHtml(current.progress_state)}</span></div>
    </div>
  `;
}

function renderQuizReveal(current) {
  const total = state.review.items.length;
  const idx = state.review.index + 1;
  const pct = Math.round((idx / total) * 100);
  return `
    <div class="quiz-layout">
      <div class="quiz-header"><h1>Rate Difficulty</h1><p>Question ${idx} of ${total}</p><div class="progress-track"><div class="progress-meta"><span>Question ${idx} of ${total}</span><span>${pct}%</span></div><div class="progress-bar"><div class="progress-fill" style="width:${pct}%"></div></div></div></div>
      <div class="quiz-reveal">
        <div class="card card-padded reveal-card"><h2>${escapeHtml(current.term)}</h2><p style="font-size:14px;color:var(--secondary);margin-bottom:16px;">${escapeHtml(current.part_of_speech)} / ${escapeHtml(current.phonetics_us)}</p><p class="reveal-definition">${escapeHtml(current.definition)}</p><p class="reveal-nuance">${escapeHtml(current.nuances)}</p>${current.synonyms?.length ? `<div class="pill-row">${current.synonyms.map(s => `<span class="pill">${escapeHtml(s)}</span>`).join('')}</div>` : ''}${current.examples?.length ? `<div class="context-quote">"${escapeHtml(current.examples[0])}"</div>` : ''}</div>
        <div class="detail-block text-center"><h4>Rate Difficulty</h4><p style="font-size:13px;color:var(--on-surface-variant);margin-bottom:16px;">How difficult was this recall?</p></div>
        <div class="rating-row">${REVIEW_RATING_ORDER.map(label => `<button class="btn ${label === 'Again' ? 'btn-danger' : label === 'Easy' ? 'btn-primary' : 'btn-secondary'}" data-action="rate-review" data-rating="${label}">${label}</button>`).join('')}</div>
      </div>
    </div>
  `;
}

function renderQueueList(items, emptyCopy = 'No due words yet.') {
  if (!items.length) return `<div class="empty-state">${escapeHtml(emptyCopy)}</div>`;
  return `<div class="queue-list">${items.map(item => `<div class="queue-item"><strong>${escapeHtml(item.term)}</strong><div class="queue-meta"><span>${escapeHtml(item.part_of_speech)}</span><span>${escapeHtml(item.phonetics_us)}</span><span>${escapeHtml(item.progress_state)}</span><span>${escapeHtml(formatDate(item.next_review_at))}</span>${typeof item.priority_score === 'number' ? `<span class="queue-score">priority ${escapeHtml(item.priority_score)}</span>` : ''}</div></div>`).join('')}</div>`;
}

function renderReviewSummary(summary) {
  return `<div class="review-summary"><div class="sm2-stat"><strong>${escapeHtml(summary.completed)}</strong><span>reviewed</span></div>${REVIEW_RATING_ORDER.map(label => `<div class="sm2-stat"><strong>${escapeHtml(summary.ratings[label])}</strong><span>${escapeHtml(label.toLowerCase())}</span></div>`).join('')}</div>`;
}

function renderSettings() {
  return `
    <div class="page-header"><div class="page-eyebrow">${SCREEN_COPY.settings.eyebrow}</div><h2 class="page-title">${SCREEN_COPY.settings.title}</h2><p class="page-subtitle">${SCREEN_COPY.settings.subtitle}</p></div>
    <div class="settings-grid">
      <div class="settings-hero"><div class="page-eyebrow">Study rhythm</div><h3 style="font-family:var(--font-headline);font-size:28px;margin:8px 0;">Tune the review desk.</h3><p>These settings guide daily planning. Scheduling is still based on each card's review history.</p></div>
      <div class="card card-padded">
        <div class="section-heading"><div><h3>Learner Profile</h3><p>Your daily target and new-card budget.</p></div></div>
        <div class="field"><label for="learnerNameInput">Learner name</label><input id="learnerNameInput" class="input" value="${escapeHtml(state.profileForm.learner_name)}" /></div>
        <div class="editor-grid"><div class="field"><label for="dailyGoalInput">Daily review goal</label><input id="dailyGoalInput" type="number" min="1" max="50" class="input" value="${escapeHtml(state.profileForm.daily_goal)}" /></div><div class="field"><label for="newCardsInput">New cards per day</label><input id="newCardsInput" type="number" min="0" max="50" class="input" value="${escapeHtml(state.profileForm.new_cards_per_day)}" /></div></div>
        <div class="field"><label for="promptMixInput">Prompt mix</label><select id="promptMixInput" class="input"><option value="balanced" ${state.profileForm.review_prompt_mix === 'balanced' ? 'selected' : ''}>Balanced</option><option value="meaning-first" ${state.profileForm.review_prompt_mix === 'meaning-first' ? 'selected' : ''}>Meaning first</option><option value="context-first" ${state.profileForm.review_prompt_mix === 'context-first' ? 'selected' : ''}>Context first</option></select></div>
        <div class="btn-row"><button class="btn btn-primary" data-action="save-profile">Save profile</button></div>
        <div class="detail-block"><h4>Storage</h4><p>WordForge stores words and review history in Convex through the configured API proxy.</p></div>
      </div>
    </div>
  `;
}

function renderMain() {
  if (state.screen === 'add') return renderAdd();
  if (state.screen === 'library') return renderLibrary();
  if (state.screen === 'review') return renderReview();
  if (state.screen === 'settings') return renderSettings();
  return renderHome();
}

function render() {
  if (!app) return;
  app.innerHTML = renderShell(renderMain());
}

document.addEventListener('input', (event) => {
  const target = event.target;
  if (!(target instanceof HTMLElement)) return;
  if (target.id === 'searchInput') state.search = target.value;
  if (target.id === 'learnerNameInput') state.profileForm.learner_name = target.value;
  if (target.id === 'dailyGoalInput') state.profileForm.daily_goal = Number(target.value);
  if (target.id === 'newCardsInput') state.profileForm.new_cards_per_day = Number(target.value);
  if (target.id === 'promptMixInput') state.profileForm.review_prompt_mix = target.value;
  const source = target.getAttribute('data-editor-source');
  const field = target.getAttribute('data-editor-field');
  if (source && field) {
    const editor = source === 'draft' ? state.draftEditor : state.libraryEditor;
    if (editor) editor[field] = target.value;
  }
});

document.addEventListener('click', (event) => {
  const button = event.target.closest('button');
  if (!button) return;
  const screen = button.getAttribute('data-screen');
  const action = button.getAttribute('data-action');
  const wordId = button.getAttribute('data-word-id');
  if (screen) {
    if (action === 'select-word' && wordId) state.selectedWordId = wordId;
    state.screen = screen;
    clearMessages();
    render();
    return;
  }
  if (action === 'save-draft') return handleSaveDraft();
  if (action === 'select-word') {
    state.selectedWordId = wordId;
    state.libraryEditingId = null;
    state.libraryEditor = null;
    render();
    return;
  }
  if (action === 'start-edit-word') {
    const selected = getSelectedWord();
    if (!selected) return;
    state.libraryEditingId = selected.id;
    state.libraryEditor = editorFromWord(selected);
    render();
    return;
  }
  if (action === 'cancel-edit-word') {
    state.libraryEditingId = null;
    state.libraryEditor = null;
    render();
    return;
  }
  if (action === 'save-word-edit') return handleSaveWordEdit();
  if (action === 'delete-word') return handleDeleteWord(wordId);
  if (action === 'start-review') return startReviewSession();
  if (action === 'reveal-review') return revealReviewCard();
  if (action === 'rate-review') return submitReviewRating(button.getAttribute('data-rating'));
  if (action === 'save-profile') return handleSaveProfile();
});

loadBootstrap();
