const { clamp, nowIso, uid } = require('./shared');

const REVIEW_LABEL_TO_QUALITY = {
  Again: 0,
  Hard: 3,
  Good: 4,
  Easy: 5
};

function getReviewPromptType(word) {
  const cycle = ['term_to_definition', 'definition_to_term', 'synonym_ladder', 'example_focus'];
  return cycle[(word.review_count || 0) % cycle.length];
}

function buildReviewPrompt(word) {
  const promptType = getReviewPromptType(word);

  if (promptType === 'definition_to_term') {
    return {
      type: promptType,
      headline: 'Recall the word',
      prompt: word.definition,
      support: `American pronunciation: ${word.phonetics_us}`
    };
  }

  if (promptType === 'synonym_ladder') {
    return {
      type: promptType,
      headline: 'Recall from synonyms',
      prompt: `Which word fits these shades of meaning: ${word.synonyms.slice(0, 3).join(', ')}?`,
      support: word.nuances
    };
  }

  if (promptType === 'example_focus') {
    return {
      type: promptType,
      headline: 'Recall from context',
      prompt: word.examples[0],
      support: 'Think of the precise meaning, tone, and pronunciation before you flip.'
    };
  }

  return {
    type: promptType,
    headline: 'Recall the definition',
    prompt: word.term,
    support: `${word.part_of_speech} | ${word.phonetics_us}`
  };
}

function sm2(word, reviewLabel, now = new Date()) {
  const quality = REVIEW_LABEL_TO_QUALITY[reviewLabel];
  if (typeof quality !== 'number') {
    throw new Error('Unknown review label.');
  }

  let repetitions = Number(word.repetitions || 0);
  let intervalDays = Number(word.interval_days || 0);
  let easeFactor = Number(word.ease_factor || 2.5);
  const previousInterval = intervalDays;

  if (quality < 3) {
    repetitions = 0;
    intervalDays = 1;
  } else {
    if (repetitions === 0) {
      intervalDays = 1;
    } else if (repetitions === 1) {
      intervalDays = 6;
    } else {
      intervalDays = Math.max(1, Math.round(intervalDays * easeFactor));
    }

    repetitions += 1;

    if (reviewLabel === 'Hard') {
      intervalDays = Math.max(1, Math.round(intervalDays * 0.8));
    }

    if (reviewLabel === 'Easy') {
      intervalDays = Math.max(intervalDays + 1, Math.round(intervalDays * 1.25));
    }
  }

  easeFactor = easeFactor + (0.1 - (5 - quality) * (0.08 + (5 - quality) * 0.02));
  easeFactor = clamp(easeFactor, 1.3, 3.2);

  const nextReviewAt = new Date(now.getTime() + intervalDays * 24 * 60 * 60 * 1000).toISOString();
  const lapses = quality < 3 ? Number(word.lapses || 0) + 1 : Number(word.lapses || 0);
  const progressState = repetitions >= 5 && intervalDays >= 21 ? 'mastered' : 'learning';

  return {
    updatedWord: {
      ...word,
      repetitions,
      interval_days: intervalDays,
      previous_interval_days: previousInterval,
      ease_factor: Number(easeFactor.toFixed(2)),
      last_quality: quality,
      last_rating: reviewLabel,
      last_reviewed_at: nowIso(now),
      next_review_at: nextReviewAt,
      review_count: Number(word.review_count || 0) + 1,
      lapses,
      progress_state: progressState,
      updated_at: nowIso(now)
    },
    event: {
      id: uid('review'),
      word_id: word.id,
      term: word.term,
      rating: reviewLabel,
      quality,
      due_before: word.next_review_at,
      due_after: nextReviewAt,
      occurred_at: nowIso(now),
      interval_days_before: previousInterval,
      interval_days_after: intervalDays,
      ease_factor_after: Number(easeFactor.toFixed(2))
    }
  };
}

function getDueQueue(words, now = new Date()) {
  const dueWords = words
    .filter((word) => !word.archived && word.next_review_at && new Date(word.next_review_at) <= now)
    .map((word) => {
      const overdueMs = Math.max(0, now.getTime() - new Date(word.next_review_at).getTime());
      const overdueHours = overdueMs / (1000 * 60 * 60);
      const priority =
        overdueHours * 4 +
        (word.progress_state === 'learning' ? 20 : 0) +
        (3.2 - Number(word.ease_factor || 2.5)) * 10 +
        Number(word.lapses || 0) * 2;

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
  REVIEW_LABEL_TO_QUALITY,
  getReviewPromptType,
  buildReviewPrompt,
  getDueQueue,
  sm2
};
