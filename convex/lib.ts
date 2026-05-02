import { ConvexError, v } from "convex/values";

export const providerIds = ["custom", "openai", "anthropic"] as const;
export type ProviderId = (typeof providerIds)[number];

export const defaultProvider = {
  base_url: "",
  model: "",
  encrypted_api_key: "",
  connection_status: "missing",
  last_tested_at: null as string | null,
};

export const defaultSettings = {
  active_provider: "custom",
  providers: {
    custom: { ...defaultProvider },
    openai: { ...defaultProvider },
    anthropic: { ...defaultProvider },
  },
  american_accent_only: true,
};

export const defaultProfile = {
  learner_name: "Learner",
  accent: "American English",
  daily_goal: 12,
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
  image_prompt: v.string(),
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

export function normalizeProviderEntry(value: any, providerId: ProviderId) {
  const source = value && typeof value === "object" ? value : {};
  return {
    ...defaultSettings.providers[providerId],
    base_url: String(source.base_url || "").trim(),
    model: String(source.model || "").trim(),
    encrypted_api_key: String(source.encrypted_api_key || "").trim(),
    connection_status: String(source.connection_status || defaultProvider.connection_status),
    last_tested_at: source.last_tested_at || null,
  };
}

export function normalizeSettings(value: any) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return structuredClone(defaultSettings);
  }

  if ("model" in value && !("providers" in value)) {
    return {
      active_provider: "custom",
      providers: {
        custom: normalizeProviderEntry(value, "custom"),
        openai: { ...defaultProvider },
        anthropic: { ...defaultProvider },
      },
      american_accent_only: true,
    };
  }

  const active = providerIds.includes(value.active_provider) ? value.active_provider : "custom";
  const rawProviders = value.providers && typeof value.providers === "object" ? value.providers : {};
  return {
    active_provider: active,
    providers: {
      custom: normalizeProviderEntry(rawProviders.custom, "custom"),
      openai: normalizeProviderEntry(rawProviders.openai, "openai"),
      anthropic: normalizeProviderEntry(rawProviders.anthropic, "anthropic"),
    },
    american_accent_only: true,
  };
}

export function publicSettings(settings: any) {
  return {
    active_provider: settings.active_provider,
    providers: Object.fromEntries(providerIds.map((providerId) => {
      const provider = settings.providers[providerId];
      return [providerId, {
        base_url: provider.base_url,
        model: provider.model,
        has_key: Boolean(provider.encrypted_api_key),
        connection_status: provider.connection_status,
        last_tested_at: provider.last_tested_at,
      }];
    })),
  };
}

export function validateWordCard(candidate: any) {
  if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) {
    return { ok: false as const, error: "Response must be a JSON object." };
  }

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
    image_prompt: String(candidate.image_prompt || "").trim(),
    image_svg: typeof candidate.image_svg === "string" ? candidate.image_svg : undefined,
  };

  for (const field of ["term", "definition", "nuances", "phonetics_us", "part_of_speech", "image_prompt"] as const) {
    if (!sanitized[field]) {
      return { ok: false as const, error: `Field "${field}" must be a non-empty string.` };
    }
  }
  if (sanitized.examples.length !== 10) return { ok: false as const, error: "examples must contain exactly 10 sentences." };
  if (!sanitized.synonyms.length) return { ok: false as const, error: "synonyms must contain at least one entry." };
  if (!sanitized.antonyms.length) return { ok: false as const, error: "antonyms must contain at least one entry." };
  return { ok: true as const, value: sanitized };
}

function escapeXml(value: unknown) {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

export function fallbackIllustration(card: any) {
  const safeTerm = escapeXml(card.term);
  const safePrompt = escapeXml(String(card.image_prompt || "").slice(0, 110));
  return [
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 720 480" role="img" aria-label="Word illustration">',
    '<rect width="720" height="480" rx="36" fill="#173b34"/>',
    '<circle cx="130" cy="120" r="110" fill="#e7b84f" fill-opacity="0.25"/>',
    '<circle cx="595" cy="96" r="84" fill="#ffffff" fill-opacity="0.16"/>',
    '<rect x="72" y="74" width="576" height="332" rx="28" fill="#275c4c" stroke="#fffaf0" stroke-opacity="0.28"/>',
    `<text x="112" y="180" fill="#fffaf0" font-family="Georgia, serif" font-size="58" font-style="italic">${safeTerm}</text>`,
    `<text x="114" y="362" fill="#fffaf0" fill-opacity="0.82" font-family="Arial, sans-serif" font-size="16">${safePrompt}</text>`,
    '</svg>',
  ].join("");
}

export function withGeneratedIllustration(card: any) {
  const svg = typeof card.image_svg === "string" && card.image_svg.includes("<svg") && card.image_svg.includes("</svg")
    ? card.image_svg
    : fallbackIllustration(card);
  return { ...card, image_svg: svg };
}

export function buildReviewPrompt(word: any) {
  const cycle = ["term_to_definition", "definition_to_term", "synonym_ladder", "example_focus"];
  const promptType = cycle[Number(word.review_count || 0) % cycle.length];
  if (promptType === "definition_to_term") {
    return { type: promptType, headline: "Recall the word", prompt: word.definition, support: `American pronunciation: ${word.phonetics_us}` };
  }
  if (promptType === "synonym_ladder") {
    return { type: promptType, headline: "Recall from synonyms", prompt: `Which word fits these shades of meaning: ${(word.synonyms || []).slice(0, 3).join(", ")}?`, support: word.nuances };
  }
  if (promptType === "example_focus") {
    return { type: promptType, headline: "Recall from context", prompt: (word.examples || [])[0], support: "Think of the precise meaning, tone, and pronunciation before you flip." };
  }
  return { type: promptType, headline: "Recall the definition", prompt: word.term, support: `${word.part_of_speech} | ${word.phonetics_us}` };
}

export function getDueQueue(words: any[], now = new Date()) {
  const dueWords = words
    .filter((word) => !word.archived && word.next_review_at && new Date(word.next_review_at) <= now)
    .map((word) => {
      const overdueMs = Math.max(0, now.getTime() - new Date(word.next_review_at).getTime());
      const overdueHours = overdueMs / (1000 * 60 * 60);
      const priority = overdueHours * 4 + (word.progress_state === "learning" ? 20 : 0) + (3.2 - Number(word.ease_factor || 2.5)) * 10 + Number(word.lapses || 0) * 2;
      return { ...word, overdue_hours: Number(overdueHours.toFixed(1)), priority_score: Number(priority.toFixed(2)), review_prompt: buildReviewPrompt(word) };
    })
    .sort((left, right) => right.priority_score !== left.priority_score ? right.priority_score - left.priority_score : new Date(left.next_review_at).getTime() - new Date(right.next_review_at).getTime());
  return { count: dueWords.length, items: dueWords };
}

export function sm2(word: any, reviewLabel: string, now = new Date()) {
  const qualities: Record<string, number> = { Again: 0, Hard: 3, Good: 4, Easy: 5 };
  const quality = qualities[reviewLabel];
  if (typeof quality !== "number") throw appError("BAD_REQUEST", "Unknown review label.", 400);

  let repetitions = Number(word.repetitions || 0);
  let intervalDays = Number(word.interval_days || 0);
  let easeFactor = Number(word.ease_factor || 2.5);
  const previousInterval = intervalDays;

  if (quality < 3) {
    repetitions = 0;
    intervalDays = 1;
  } else {
    if (repetitions === 0) intervalDays = 1;
    else if (repetitions === 1) intervalDays = 6;
    else intervalDays = Math.max(1, Math.round(intervalDays * easeFactor));
    repetitions += 1;
    if (reviewLabel === "Hard") intervalDays = Math.max(1, Math.round(intervalDays * 0.8));
    if (reviewLabel === "Easy") intervalDays = Math.max(intervalDays + 1, Math.round(intervalDays * 1.25));
  }

  easeFactor = Math.min(3.2, Math.max(1.3, easeFactor + (0.1 - (5 - quality) * (0.08 + (5 - quality) * 0.02))));
  const nextReviewAt = new Date(now.getTime() + intervalDays * 24 * 60 * 60 * 1000).toISOString();
  const lapses = quality < 3 ? Number(word.lapses || 0) + 1 : Number(word.lapses || 0);
  const progressState = repetitions >= 5 && intervalDays >= 21 ? "mastered" : "learning";

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
      updated_at: nowIso(now),
    },
    event: {
      id: uid("review"),
      word_id: word.id,
      term: word.term,
      rating: reviewLabel,
      quality,
      due_before: word.next_review_at || null,
      due_after: nextReviewAt,
      occurred_at: nowIso(now),
      interval_days_before: previousInterval,
      interval_days_after: intervalDays,
      ease_factor_after: Number(easeFactor.toFixed(2)),
    },
  };
}
