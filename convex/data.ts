import { v } from "convex/values";
import { mutation, query } from "./_generated/server";
import {
  appError,
  cardValidator,
  defaultProfile,
  getDueQueue,
  normalizeProfile,
  normalizeText,
  nowIso,
  reviewRatingOrder,
  sm2,
  sourceValidator,
  uid,
  validateWordCard,
} from "./lib";

async function findProfileDoc(ctx: any) {
  return await ctx.db.query("profile").withIndex("by_key", (q: any) => q.eq("key", "profile")).unique();
}

async function ensureProfileDoc(ctx: any) {
  const existing = await findProfileDoc(ctx);
  if (existing) return existing;
  const now = nowIso();
  const id = await ctx.db.insert("profile", { key: "profile", ...defaultProfile, updated_at: now });
  return await ctx.db.get(id);
}

async function getProfileValue(ctx: any) {
  const existing = await findProfileDoc(ctx);
  return { key: "profile", ...defaultProfile, ...(existing || {}), updated_at: existing?.updated_at || nowIso() };
}

async function allWords(ctx: any) {
  const words = await ctx.db.query("words").withIndex("by_updated_at").order("desc").collect();
  return words.map(normalizeWordDoc);
}

async function wordById(ctx: any, id: string) {
  return await ctx.db.query("words").withIndex("by_legacy_id", (q: any) => q.eq("id", id)).unique();
}

function buildStatsFrom(words: any[], reviewEvents: any[], now = new Date()) {
  const dueQueue = getDueQueue(words, now);
  const mastered = words.filter((word) => word.progress_state === "mastered").length;
  const learning = words.length - mastered;
  const today = nowIso(now).slice(0, 10);
  const reviewsToday = reviewEvents.filter((event) => event.occurred_at && event.occurred_at.startsWith(today)).length;
  const recentWords = words
    .slice()
    .sort((left, right) => new Date(right.created_at).getTime() - new Date(left.created_at).getTime())
    .slice(0, 4);
  return {
    total_words: words.length,
    due_words: dueQueue.count,
    mastered_words: mastered,
    learning_words: learning,
    reviews_today: reviewsToday,
    mastery_rate: words.length ? Math.round((mastered / words.length) * 100) : 0,
    recent_words: recentWords,
    due_preview: dueQueue.items.slice(0, 5),
  };
}

function publicProfile(profile: any) {
  const normalized = normalizeProfile(profile);
  return {
    learner_name: normalized.learner_name,
    accent: normalized.accent,
    daily_goal: normalized.daily_goal,
  };
}

function publicReviewPreferences(profile: any) {
  const normalized = normalizeProfile(profile);
  return {
    new_cards_per_day: normalized.new_cards_per_day,
    review_prompt_mix: normalized.review_prompt_mix,
  };
}

function cleanWordDoc(doc: any) {
  const { _id, _creationTime, ...word } = doc;
  return word;
}

function normalizeWordDoc(doc: any) {
  const word = cleanWordDoc(doc);
  return {
    ...word,
    visual_cue: String(word.visual_cue || word.image_prompt || "").trim(),
    image_asset: String(word.image_asset || word.image_svg || "").trim(),
    learning_step: Number(word.learning_step || 0),
    last_prompt_type: word.last_prompt_type || null,
    leech_score: Number(word.leech_score || 0),
    progress_state: word.progress_state || "new",
  };
}

export const getBootstrap = query({
  args: {},
  handler: async (ctx) => {
    const profile = await getProfileValue(ctx);
    const words = await allWords(ctx);
    const reviewEvents = await ctx.db.query("reviewEvents").withIndex("by_occurred_at").order("desc").take(500);
    return {
      app_name: "WordForge",
      accent_mode: "American English",
      profile: publicProfile(profile),
      review_preferences: publicReviewPreferences(profile),
      stats: buildStatsFrom(words, reviewEvents),
      words,
      due_queue: getDueQueue(words),
    };
  },
});

export const listWords = query({
  args: {},
  handler: async (ctx) => {
    const words = await allWords(ctx);
    const reviewEvents = await ctx.db.query("reviewEvents").withIndex("by_occurred_at").order("desc").take(500);
    return { words, stats: buildStatsFrom(words, reviewEvents) };
  },
});

export const getReviewQueue = query({
  args: {},
  handler: async (ctx) => getDueQueue(await allWords(ctx)),
});

export const saveProfile = mutation({
  args: {
    learner_name: v.string(),
    daily_goal: v.number(),
    new_cards_per_day: v.optional(v.number()),
    review_prompt_mix: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    if (!Number.isInteger(args.daily_goal) || args.daily_goal < 1 || args.daily_goal > 50) {
      throw appError("BAD_REQUEST", "Daily review goal must be a whole number between 1 and 50.", 400);
    }
    const newCards = args.new_cards_per_day === undefined ? defaultProfile.new_cards_per_day : args.new_cards_per_day;
    if (!Number.isInteger(newCards) || newCards < 0 || newCards > 50) {
      throw appError("BAD_REQUEST", "New cards per day must be a whole number between 0 and 50.", 400);
    }
    const promptMix = ["balanced", "meaning-first", "context-first"].includes(args.review_prompt_mix)
      ? args.review_prompt_mix!
      : defaultProfile.review_prompt_mix;
    const existing = await ensureProfileDoc(ctx);
    const profile = {
      learner_name: String(args.learner_name || existing.learner_name || defaultProfile.learner_name).trim() || defaultProfile.learner_name,
      daily_goal: args.daily_goal,
      new_cards_per_day: newCards,
      review_prompt_mix: promptMix,
      accent: "American English",
      updated_at: nowIso(),
    };
    await ctx.db.patch(existing._id, profile);
    return { profile: publicProfile(profile), review_preferences: publicReviewPreferences(profile) };
  },
});

export const saveWord = mutation({
  args: {
    card: cardValidator,
    source: sourceValidator,
  },
  handler: async (ctx, args) => {
    const validation = validateWordCard(args.card);
    if (!validation.ok) throw appError("INVALID_WORD_CARD", validation.error, 422);
    const normalized = normalizeText(validation.value.term);
    const existing = await ctx.db.query("words").withIndex("by_term_normalized", (q: any) => q.eq("term_normalized", normalized)).unique();
    if (existing) return normalizeWordDoc(existing);
    const now = nowIso();
    const record = {
      id: uid("word"),
      term_normalized: normalized,
      source_type: args.source?.type || "manual",
      source_label: args.source?.label || "Manual entry",
      created_at: now,
      updated_at: now,
      next_review_at: now,
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
      progress_state: "new",
      archived: false,
      ...validation.value,
    };
    await ctx.db.insert("words", record);
    return record;
  },
});

export const updateWord = mutation({
  args: {
    id: v.string(),
    card: cardValidator,
  },
  handler: async (ctx, args) => {
    const existing = await wordById(ctx, args.id);
    if (!existing) throw appError("NOT_FOUND", "Word not found.", 404);
    const validation = validateWordCard(args.card);
    if (!validation.ok) throw appError("INVALID_WORD_CARD", validation.error, 422);
    const normalized = normalizeText(validation.value.term);
    const duplicate = await ctx.db.query("words").withIndex("by_term_normalized", (q: any) => q.eq("term_normalized", normalized)).unique();
    if (duplicate && duplicate.id !== args.id) throw appError("BAD_REQUEST", "Another saved card already uses this term.", 409);
    const next = { ...validation.value, term_normalized: normalized, updated_at: nowIso() };
    await ctx.db.patch(existing._id, next);
    return { ...normalizeWordDoc(existing), ...next };
  },
});

export const deleteWord = mutation({
  args: { id: v.string() },
  handler: async (ctx, args) => {
    const existing = await wordById(ctx, args.id);
    if (!existing) throw appError("NOT_FOUND", "Word not found.", 404);
    await ctx.db.delete(existing._id);
    return normalizeWordDoc(existing);
  },
});

export const recordReview = mutation({
  args: {
    word_id: v.string(),
    rating: v.string(),
  },
  handler: async (ctx, args) => {
    if (!reviewRatingOrder.includes(args.rating as any)) {
      throw appError("BAD_REQUEST", "Rating must be Again, Hard, Good, or Easy.", 400);
    }
    const existing = await wordById(ctx, args.word_id);
    if (!existing) throw appError("NOT_FOUND", "Word not found.", 404);
    const outcome = sm2(normalizeWordDoc(existing), args.rating);
    const updatedWord = normalizeWordDoc(outcome.updatedWord);
    await ctx.db.patch(existing._id, updatedWord);
    await ctx.db.insert("reviewEvents", outcome.event);
    const words = await allWords(ctx);
    const reviewEvents = await ctx.db.query("reviewEvents").withIndex("by_occurred_at").order("desc").take(500);
    return {
      word: updatedWord,
      review_event: outcome.event,
      due_queue: getDueQueue(words),
      stats: buildStatsFrom(words, reviewEvents),
    };
  },
});

export const importSnapshot = mutation({
  args: {
    profile: v.any(),
    words: v.array(v.any()),
    review_events: v.array(v.any()),
  },
  handler: async (ctx, args) => {
    const profileDoc = await ensureProfileDoc(ctx);
    const profile = normalizeProfile(args.profile);
    await ctx.db.patch(profileDoc._id, { ...profile, updated_at: nowIso() });

    let words = 0;
    for (const candidate of args.words || []) {
      if (!candidate?.id || !candidate?.term) continue;
      const existing = await wordById(ctx, String(candidate.id));
      if (existing) continue;
      const validation = validateWordCard(candidate);
      if (!validation.ok) continue;
      await ctx.db.insert("words", {
        ...validation.value,
        id: String(candidate.id),
        term_normalized: candidate.term_normalized || normalizeText(validation.value.term),
        source_type: candidate.source_type || "migration",
        source_label: candidate.source_label || "JSON migration",
        created_at: candidate.created_at || nowIso(),
        updated_at: candidate.updated_at || candidate.created_at || nowIso(),
        next_review_at: candidate.next_review_at || nowIso(),
        last_reviewed_at: candidate.last_reviewed_at || null,
        review_count: Number(candidate.review_count || 0),
        repetitions: Number(candidate.repetitions || 0),
        interval_days: Number(candidate.interval_days || 0),
        previous_interval_days: Number(candidate.previous_interval_days || 0),
        ease_factor: Number(candidate.ease_factor || 2.5),
        learning_step: Number(candidate.learning_step || 0),
        last_quality: typeof candidate.last_quality === "number" ? candidate.last_quality : null,
        last_rating: candidate.last_rating || null,
        last_prompt_type: candidate.last_prompt_type || null,
        lapses: Number(candidate.lapses || 0),
        leech_score: Number(candidate.leech_score || 0),
        progress_state: candidate.progress_state || "new",
        archived: Boolean(candidate.archived),
      });
      words += 1;
    }

    let reviewEvents = 0;
    for (const event of args.review_events || []) {
      if (!event?.id) continue;
      await ctx.db.insert("reviewEvents", {
        id: String(event.id),
        word_id: String(event.word_id || ""),
        term: String(event.term || ""),
        rating: String(event.rating || ""),
        quality: Number(event.quality || 0),
        prompt_type: String(event.prompt_type || "term_to_definition"),
        due_before: event.due_before || null,
        due_after: String(event.due_after || ""),
        occurred_at: String(event.occurred_at || nowIso()),
        interval_days_before: Number(event.interval_days_before || 0),
        interval_days_after: Number(event.interval_days_after || 0),
        ease_factor_after: Number(event.ease_factor_after || 2.5),
        progress_state_after: String(event.progress_state_after || "reviewing"),
      });
      reviewEvents += 1;
    }

    return { words, review_events: reviewEvents };
  },
});

export const migrateLegacyWords = mutation({
  args: {},
  handler: async (ctx) => {
    const words = await ctx.db.query("words").collect();
    let patched = 0;
    for (const doc of words) {
      const next: any = {};
      if (!doc.visual_cue && doc.image_prompt) next.visual_cue = String(doc.image_prompt);
      if (!doc.image_asset && doc.image_svg) next.image_asset = String(doc.image_svg);
      if (doc.learning_step === undefined) next.learning_step = 0;
      if (doc.last_prompt_type === undefined) next.last_prompt_type = null;
      if (doc.leech_score === undefined) next.leech_score = 0;
      if (!doc.progress_state) next.progress_state = "new";
      if (Object.keys(next).length) {
        await ctx.db.patch(doc._id, next);
        patched += 1;
      }
    }

    const profile = await ensureProfileDoc(ctx);
    const normalized = normalizeProfile(profile);
    const profilePatch: any = {};
    if (profile.new_cards_per_day === undefined) profilePatch.new_cards_per_day = normalized.new_cards_per_day;
    if (profile.review_prompt_mix === undefined) profilePatch.review_prompt_mix = normalized.review_prompt_mix;
    if (Object.keys(profilePatch).length) await ctx.db.patch(profile._id, profilePatch);

    return { patched_words: patched, patched_profile: Object.keys(profilePatch).length > 0 };
  },
});
