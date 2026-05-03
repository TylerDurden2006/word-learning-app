import { ConvexError, v } from "convex/values";

export const reviewRatingOrder = ["Again", "Hard", "Good", "Easy"] as const;

export const defaultProfile = {
  learner_name: "Learner",
  accent: "American English",
  daily_goal: 12,
  new_cards_per_day: 10,
  review_prompt_mix: "balanced",
};

export const cardValidator = v.object({
  term: v.string(),
  definition: v.string(),
  nuances: v.string(),
  phonetics_us: v.string(),
  part_of_speech: v.string(),
  synonyms: v.array(v.string()),
  antonyms: v.array(v.string()),
  examples: v.array(v.string()),
  visual_cue: v.optional(v.string()),
  image_asset: v.optional(v.string()),
  image_prompt: v.optional(v.string()),
  image_svg: v.optional(v.string()),
});

export const sourceValidator = v.optional(v.object({
  type: v.optional(v.string()),
  label: v.optional(v.string()),
}));

export function appError(code: string, message: string, status = 400, details: any = null) {
  return new ConvexError({ code, message, status, details });
}

export function nowIso(now = new Date()) {
  return now.toISOString();
}

export function uid(prefix = "id") {
  return `${prefix}_${crypto.randomUUID()}`;
}

export function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

export function normalizeText(value: unknown) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s'-]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function uniqueStrings(values: unknown[], limit = 50) {
  const seen = new Set<string>();
  const items: string[] = [];
  for (const value of values || []) {
    const text = String(value || "").trim();
    if (!text) continue;
    const key = normalizeText(text);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    items.push(text);
    if (items.length >= limit) break;
  }
  return items;
}

export function normalizeProfile(value: any) {
  const rawGoal = Number(value?.daily_goal);
  const rawNewCards = Number(value?.new_cards_per_day);
  const promptMix = ["balanced", "meaning-first", "context-first"].includes(value?.review_prompt_mix)
    ? value.review_prompt_mix
    : defaultProfile.review_prompt_mix;
  return {
    learner_name: String(value?.learner_name || defaultProfile.learner_name).trim() || defaultProfile.learner_name,
    accent: "American English",
    daily_goal: Number.isInteger(rawGoal) ? clamp(rawGoal, 1, 50) : defaultProfile.daily_goal,
    new_cards_per_day: Number.isInteger(rawNewCards) ? clamp(rawNewCards, 0, 50) : defaultProfile.new_cards_per_day,
    review_prompt_mix: promptMix,
  };
}

export function validateWordCard(candidate: any) {
  if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) {
    return { ok: false as const, error: "Card must be a JSON object." };
  }

  const visualCue = candidate.visual_cue === undefined ? candidate.image_prompt : candidate.visual_cue;
  const imageAsset = candidate.image_asset === undefined ? candidate.image_svg : candidate.image_asset;
  const sanitized = {
    term: String(candidate.term || "").trim(),
    definition: String(candidate.definition || "").trim(),
    nuances: String(candidate.nuances || "").trim(),
    phonetics_us: String(candidate.phonetics_us || "").trim(),
    part_of_speech: String(candidate.part_of_speech || "").trim(),
    synonyms: uniqueStrings(candidate.synonyms || [], 8),
    antonyms: uniqueStrings(candidate.antonyms || [], 8),
    examples: Array.isArray(candidate.examples)
      ? candidate.examples.map((item: unknown) => String(item || "").trim()).filter(Boolean)
      : [],
    visual_cue: String(visualCue || "").trim(),
    image_asset: String(imageAsset || "").trim(),
  };

  if (sanitized.image_asset.includes("<script")) return { ok: false as const, error: "Image assets cannot include script tags." };
  for (const field of ["term", "definition", "nuances", "phonetics_us", "part_of_speech", "visual_cue"] as const) {
    if (!sanitized[field]) return { ok: false as const, error: `Field "${field}" must be a non-empty string.` };
  }
  if (sanitized.examples.length !== 10) return { ok: false as const, error: "examples must contain exactly 10 sentences." };
  if (!sanitized.synonyms.length) return { ok: false as const, error: "synonyms must contain at least one entry." };
  if (!sanitized.antonyms.length) return { ok: false as const, error: "antonyms must contain at least one entry." };
  return { ok: true as const, value: sanitized };
}

const promptTypes = [
  "term_to_definition",
  "definition_to_term",
  "synonym_recall",
  "antonym_contrast",
  "example_context",
  "pronunciation_recall",
];

export function getReviewPromptType(word: any) {
  const offset = promptTypes.indexOf(word.last_prompt_type);
  const base = Number(word.review_count || 0);
  return promptTypes[(base + (offset >= 0 ? 1 : 0)) % promptTypes.length];
}

function clozeExample(word: any) {
  const example = String((word.examples || [])[0] || "");
  if (!example || !word.term) return example;
  const escaped = String(word.term).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return example.replace(new RegExp(`\\b${escaped}\\b`, "i"), "_____");
}

export function buildReviewPrompt(word: any) {
  const promptType = getReviewPromptType(word);
  if (promptType === "definition_to_term") return { type: promptType, headline: "Recall the word", prompt: word.definition, support: `Part of speech: ${word.part_of_speech}` };
  if (promptType === "synonym_recall") return { type: promptType, headline: "Recall from synonyms", prompt: `Which word fits these meanings: ${(word.synonyms || []).slice(0, 3).join(", ")}?`, support: word.nuances };
  if (promptType === "antonym_contrast") return { type: promptType, headline: "Recall from contrast", prompt: `Which word contrasts with: ${(word.antonyms || []).slice(0, 3).join(", ")}?`, support: word.visual_cue };
  if (promptType === "example_context") return { type: promptType, headline: "Recall from context", prompt: clozeExample(word), support: "Name the missing word, then recall its definition before revealing." };
  if (promptType === "pronunciation_recall") return { type: promptType, headline: "Recall pronunciation", prompt: word.term, support: "Say the American pronunciation and part of speech before revealing." };
  return { type: promptType, headline: "Recall the definition", prompt: word.term, support: `${word.part_of_speech} | ${word.phonetics_us}` };
}

export function getDueQueue(words: any[], now = new Date()) {
  const dueWords = words
    .filter((word) => !word.archived && word.next_review_at && new Date(word.next_review_at) <= now)
    .map((word) => {
      const overdueMs = Math.max(0, now.getTime() - new Date(word.next_review_at).getTime());
      const overdueHours = overdueMs / (1000 * 60 * 60);
      const stateWeight: Record<string, number> = { new: 24, learning: 28, relearning: 32, leech: 34, reviewing: 16, mastered: 4 };
      const priority = overdueHours * 3 + (stateWeight[word.progress_state] ?? 12) + (3.2 - Number(word.ease_factor || 2.5)) * 8 + Number(word.lapses || 0) * 3 + Number(word.leech_score || 0) * 5;
      return { ...word, overdue_hours: Number(overdueHours.toFixed(1)), priority_score: Number(priority.toFixed(2)), review_prompt: buildReviewPrompt(word) };
    })
    .sort((left, right) => right.priority_score !== left.priority_score ? right.priority_score - left.priority_score : new Date(left.next_review_at).getTime() - new Date(right.next_review_at).getTime());
  return { count: dueWords.length, items: dueWords };
}

function scheduleInterval(word: any, reviewLabel: string) {
  const qualities: Record<string, number> = { Again: 0, Hard: 3, Good: 4, Easy: 5 };
  const quality = qualities[reviewLabel];
  if (typeof quality !== "number") throw appError("BAD_REQUEST", "Unknown review label.", 400);
  let repetitions = Number(word.repetitions || 0);
  let intervalDays = Number(word.interval_days || 0);
  let easeFactor = Number(word.ease_factor || 2.5);
  let learningStep = Number(word.learning_step || 0);
  let progressState = word.progress_state || "new";
  let leechScore = Number(word.leech_score || 0);
  let lapses = Number(word.lapses || 0);

  if (quality < 3) {
    repetitions = 0;
    intervalDays = progressState === "new" ? 0.25 : 1;
    learningStep = 0;
    lapses += 1;
    leechScore += 1;
    progressState = lapses >= 2 ? "relearning" : "learning";
  } else {
    leechScore = Math.max(0, leechScore - (reviewLabel === "Easy" ? 2 : 1));
    if (progressState === "new" || progressState === "learning" || progressState === "relearning") {
      learningStep += 1;
      if (learningStep === 1) {
        intervalDays = reviewLabel === "Easy" ? 1 : 0.5;
        progressState = "learning";
      } else {
        repetitions = Math.max(1, repetitions + 1);
        intervalDays = reviewLabel === "Hard" ? 1 : reviewLabel === "Easy" ? 4 : 2;
        progressState = "reviewing";
      }
    } else {
      if (repetitions === 0) intervalDays = 1;
      else if (repetitions === 1) intervalDays = 6;
      else intervalDays = Math.max(1, Math.round(intervalDays * easeFactor));
      repetitions += 1;
      if (reviewLabel === "Hard") intervalDays = Math.max(1, Math.round(intervalDays * 0.72));
      if (reviewLabel === "Easy") intervalDays = Math.max(intervalDays + 2, Math.round(intervalDays * 1.35));
      progressState = repetitions >= 5 && intervalDays >= 21 ? "mastered" : "reviewing";
    }
  }

  easeFactor = clamp(easeFactor + (0.1 - (5 - quality) * (0.08 + (5 - quality) * 0.02)), 1.3, 3.2);
  if (leechScore >= 4) progressState = "leech";
  return { repetitions, intervalDays, easeFactor: Number(easeFactor.toFixed(2)), learningStep, progressState, lapses, leechScore, quality };
}

export function sm2(word: any, reviewLabel: string, now = new Date()) {
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
      updated_at: nowIso(now),
    },
    event: {
      id: uid("review"),
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
      progress_state_after: schedule.progressState,
    },
  };
}
