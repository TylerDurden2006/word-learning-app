const { clamp, nowIso, uid } = require('./shared');

const REVIEW_RATING_ORDER = ['Again', 'Hard', 'Good', 'Easy'];
const REVIEW_LABEL_TO_QUALITY = {
  Again: 0,
  Hard: 3,
  Good: 4,
  Easy: 5
};

const PROMPT_TYPES = [
  'term_to_definition',
  'definition_to_term',
  'synonym_recall',
  'antonym_contrast',
  'example_context',
  'pronunciation_recall'
];

function getReviewPromptType(word) {
  const offset = PROMPT_TYPES.indexOf(word.last_prompt_type);
  const base = Number(word.review_count || 0);
  return PROMPT_TYPES[(base + (offset >= 0 ? 1 : 0)) % PROMPT_TYPES.length];
}

function clozeExample(word) {
  const example = String((word.examples || [])[0] || '');
  if (!example || !word.term) return example;
  const escaped = String(word.term).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return example.replace(new RegExp(`\\b${escaped}\\b`, 'i'), '_____');
}

function buildReviewPrompt(word) {
  const promptType = getReviewPromptType(word);

  if (promptType === 'definition_to_term') {
    return {
      type: promptType,
      headline: 'Recall the word',
      prompt: word.definition,
      support: `Part of speech: ${word.part_of_speech}`
    };
  }

  if (promptType === 'synonym_recall') {
    return {
      type: promptType,
      headline: 'Recall from synonyms',
      prompt: `Which word fits these meanings: ${(word.synonyms || []).slice(0, 3).join(', ')}?`,
      support: word.nuances
    };
  }

  if (promptType === 'antonym_contrast') {
    return {
      type: promptType,
      headline: 'Recall from contrast',
      prompt: `Which word contrasts with: ${(word.antonyms || []).slice(0, 3).join(', ')}?`,
      support: word.visual_cue
    };
  }

  if (promptType === 'example_context') {
    return {
      type: promptType,
      headline: 'Recall from context',
      prompt: clozeExample(word),
      support: 'Name the missing word, then recall its definition before revealing.'
    };
  }

  if (promptType === 'pronunciation_recall') {
    return {
      type: promptType,
      headline: 'Recall pronunciation',
      prompt: word.term,
      support: 'Say the American pronunciation and part of speech before revealing.'
    };
  }

  return {
    type: promptType,
    headline: 'Recall the definition',
    prompt: word.term,
    support: `${word.part_of_speech} | ${word.phonetics_us}`
  };
}

function scheduleInterval(word, reviewLabel) {
  const quality = REVIEW_LABEL_TO_QUALITY[reviewLabel];
  let repetitions = Number(word.repetitions || 0);
  let intervalDays = Number(word.interval_days || 0);
  let easeFactor = Number(word.ease_factor || 2.5);
  let learningStep = Number(word.learning_step || 0);
  let progressState = word.progress_state || 'new';
  let leechScore = Number(word.leech_score || 0);
  let lapses = Number(word.lapses || 0);

  if (quality < 3) {
    repetitions = 0;
    intervalDays = progressState === 'new' ? 0.25 : 1;
    learningStep = 0;
    lapses += 1;
    leechScore += 1;
    progressState = lapses >= 2 ? 'relearning' : 'learning';
  } else {
    leechScore = Math.max(0, leechScore - (reviewLabel === 'Easy' ? 2 : 1));
    if (progressState === 'new' || progressState === 'learning' || progressState === 'relearning') {
      learningStep += 1;
      if (learningStep === 1) {
        intervalDays = reviewLabel === 'Easy' ? 1 : 0.5;
        progressState = 'learning';
      } else {
        repetitions = Math.max(1, repetitions + 1);
        intervalDays = reviewLabel === 'Hard' ? 1 : reviewLabel === 'Easy' ? 4 : 2;
        progressState = 'reviewing';
      }
    } else {
      if (repetitions === 0) intervalDays = 1;
      else if (repetitions === 1) intervalDays = 6;
      else intervalDays = Math.max(1, Math.round(intervalDays * easeFactor));
      repetitions += 1;
      if (reviewLabel === 'Hard') intervalDays = Math.max(1, Math.round(intervalDays * 0.72));
      if (reviewLabel === 'Easy') intervalDays = Math.max(intervalDays + 2, Math.round(intervalDays * 1.35));
      progressState = repetitions >= 5 && intervalDays >= 21 ? 'mastered' : 'reviewing';
    }
  }

  easeFactor = easeFactor + (0.1 - (5 - quality) * (0.08 + (5 - quality) * 0.02));
  easeFactor = clamp(easeFactor, 1.3, 3.2);

  if (leechScore >= 4) {
    progressState = 'leech';
  }

  return {
    repetitions,
    intervalDays,
    easeFactor: Number(easeFactor.toFixed(2)),
    learningStep,
    progressState,
    lapses,
    leechScore,
    quality
  };
}

function sm2(word, reviewLabel, now = new Date()) {
  if (!REVIEW_RATING_ORDER.includes(reviewLabel)) {
    throw new Error('Unknown review label.');
  }

  const previousInterval = Number(word.interval_days || 0);
  const prompt = buildReviewPrompt(word);
  const schedule = scheduleInterval(word, reviewLabel);
  const nextReviewAt = new Date(now.getTime() + schedule.intervalDays * 24 * 60 * 60 * 1000).toISOString();

  return {
    updatedWord: {
      ...word,
      repetitions: schedule.repetitions,
      interval_days: schedule.intervalDays,
      previous_interval_days: previousInterval,
      ease_factor: schedule.easeFactor,
      learning_step: schedule.learningStep,
      last_quality: schedule.quality,
      last_rating: reviewLabel,
      last_prompt_type: prompt.type,
      last_reviewed_at: nowIso(now),
      next_review_at: nextReviewAt,
      review_count: Number(word.review_count || 0) + 1,
      lapses: schedule.lapses,
      leech_score: schedule.leechScore,
      progress_state: schedule.progressState,
      updated_at: nowIso(now)
    },
    event: {
      id: uid('review'),
      word_id: word.id,
      term: word.term,
      rating: reviewLabel,
      quality: schedule.quality,
      prompt_type: prompt.type,
      due_before: word.next_review_at || null,
      due_after: nextReviewAt,
      occurred_at: nowIso(now),
      interval_days_before: previousInterval,
      interval_days_after: schedule.intervalDays,
      ease_factor_after: schedule.easeFactor,
      progress_state_after: schedule.progressState
    }
  };
}

function getDueQueue(words, now = new Date()) {
  const dueWords = words
    .filter((word) => !word.archived && word.next_review_at && new Date(word.next_review_at) <= now)
    .map((word) => {
      const overdueMs = Math.max(0, now.getTime() - new Date(word.next_review_at).getTime());
      const overdueHours = overdueMs / (1000 * 60 * 60);
      const stateWeight = {
        new: 24,
        learning: 28,
        relearning: 32,
        leech: 34,
        reviewing: 16,
        mastered: 4
      }[word.progress_state] ?? 12;
      const priority =
        overdueHours * 3 +
        stateWeight +
        (3.2 - Number(word.ease_factor || 2.5)) * 8 +
        Number(word.lapses || 0) * 3 +
        Number(word.leech_score || 0) * 5;

      return {
        ...word,
        overdue_hours: Number(overdueHours.toFixed(1)),
        priority_score: Number(priority.toFixed(2)),
        review_prompt: buildReviewPrompt(word)
      };
    })
    .sort((left, right) => {
      if (right.priority_score !== left.priority_score) {
        return right.priority_score - left.priority_score;
      }
      return new Date(left.next_review_at) - new Date(right.next_review_at);
    });

  return {
    count: dueWords.length,
    items: dueWords
  };
}

module.exports = {
  REVIEW_RATING_ORDER,
  REVIEW_LABEL_TO_QUALITY,
  PROMPT_TYPES,
  getReviewPromptType,
  buildReviewPrompt,
  getDueQueue,
  sm2
};
