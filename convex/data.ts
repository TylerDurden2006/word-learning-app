import { v } from "convex/values";
import { mutation, query } from "./_generated/server";
import {
  appError,
  cardValidator,
  defaultProfile,
  defaultSettings,
  getDueQueue,
  normalizeSettings,
  normalizeText,
  nowIso,
  providerIds,
  publicSettings,
  sm2,
  sourceValidator,
  uid,
  validateWordCard,
  withGeneratedIllustration,
} from "./lib";

declare const process: { env: Record<string, string | undefined> };

async function findSettingsDoc(ctx: any) {
  return await ctx.db.query("settings").withIndex("by_key", (q: any) => q.eq("key", "settings")).unique();
}

async function findProfileDoc(ctx: any) {
  return await ctx.db.query("profile").withIndex("by_key", (q: any) => q.eq("key", "profile")).unique();
}

async function ensureSettingsDoc(ctx: any) {
  const existing = await findSettingsDoc(ctx);
  if (existing) return existing;
  const now = nowIso();
  const id = await ctx.db.insert("settings", { key: "settings", ...defaultSettings, updated_at: now });
  return await ctx.db.get(id);
}

async function ensureProfileDoc(ctx: any) {
  const existing = await findProfileDoc(ctx);
  if (existing) return existing;
  const now = nowIso();
  const id = await ctx.db.insert("profile", { key: "profile", ...defaultProfile, updated_at: now });
  return await ctx.db.get(id);
}

async function getSettingsValue(ctx: any) {
  return normalizeSettings(await findSettingsDoc(ctx));
}

async function getProfileValue(ctx: any) {
  const existing = await findProfileDoc(ctx);
  return existing || { key: "profile", ...defaultProfile, updated_at: nowIso() };
}

async function allWords(ctx: any) {
  const words = await ctx.db.query("words").withIndex("by_updated_at").order("desc").collect();
  return words.map(({ _id, _creationTime, ...word }: any) => word);
}

async function wordById(ctx: any, id: string) {
  return await ctx.db.query("words").withIndex("by_id", (q: any) => q.eq("id", id)).unique();
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

export const getSettings = query({
  args: {},
  handler: async (ctx) => getSettingsValue(ctx),
});

export const getPrivateSettings = query({
  args: {},
  handler: async (ctx) => getSettingsValue(ctx),
});

export const getBootstrap = query({
  args: {},
  handler: async (ctx) => {
    const settings = await getSettingsValue(ctx);
    const profile = await getProfileValue(ctx);
    const words = await allWords(ctx);
    const reviewEvents = await ctx.db.query("reviewEvents").withIndex("by_occurred_at").order("desc").take(500);
    const imports = await ctx.db.query("imports").withIndex("by_created_at").order("desc").take(5);
    return {
      app_name: "WordForge",
      accent_mode: "American English",
      google_oauth: {
        client_id: process.env.GOOGLE_OAUTH_CLIENT_ID || "",
        scope: "https://www.googleapis.com/auth/drive.readonly",
      },
      settings: publicSettings(settings),
      profile: {
        learner_name: profile.learner_name,
        accent: profile.accent,
        daily_goal: profile.daily_goal,
      },
      stats: buildStatsFrom(words, reviewEvents),
      imports: imports.map(({ _id, _creationTime, ...item }: any) => item),
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

export const saveSettings = mutation({
  args: {
    provider: v.string(),
    active_provider: v.string(),
    base_url: v.string(),
    model: v.string(),
    encrypted_api_key: v.optional(v.string()),
    connection_status: v.string(),
    last_tested_at: v.union(v.string(), v.null()),
  },
  handler: async (ctx, args) => {
    if (!providerIds.includes(args.provider as any) || !providerIds.includes(args.active_provider as any)) {
      throw appError("BAD_REQUEST", "Unknown provider selected.", 400);
    }
    const existing = await ensureSettingsDoc(ctx);
    const settings = normalizeSettings(existing);
    const currentProvider = settings.providers[args.provider as keyof typeof settings.providers];
    const nextProvider = {
      ...currentProvider,
      base_url: args.base_url,
      model: args.model,
      encrypted_api_key: args.encrypted_api_key === undefined ? currentProvider.encrypted_api_key : args.encrypted_api_key,
      connection_status: args.connection_status || "saved",
      last_tested_at: args.last_tested_at,
    };
    const next = {
      active_provider: args.active_provider,
      providers: { ...settings.providers, [args.provider]: nextProvider },
      american_accent_only: true,
      updated_at: nowIso(),
    };
    await ctx.db.patch(existing._id, next);
    return publicSettings(next);
  },
});

export const saveProfile = mutation({
  args: {
    learner_name: v.string(),
    daily_goal: v.number(),
  },
  handler: async (ctx, args) => {
    if (!Number.isInteger(args.daily_goal) || args.daily_goal < 1 || args.daily_goal > 50) {
      throw appError("BAD_REQUEST", "Daily review goal must be a whole number between 1 and 50.", 400);
    }
    const existing = await ensureProfileDoc(ctx);
    const profile = {
      learner_name: String(args.learner_name || existing.learner_name || defaultProfile.learner_name).trim() || defaultProfile.learner_name,
      daily_goal: args.daily_goal,
      accent: "American English",
      updated_at: nowIso(),
    };
    await ctx.db.patch(existing._id, profile);
    return { learner_name: profile.learner_name, daily_goal: profile.daily_goal, accent: profile.accent };
  },
});

export const saveWord = mutation({
  args: {
    card: cardValidator,
    source: sourceValidator,
  },
  handler: async (ctx, args) => {
    const validation = validateWordCard(args.card);
    if (!validation.ok) throw appError("INVALID_AI_RESPONSE", validation.error, 422);
    const normalized = normalizeText(validation.value.term);
    const existing = await ctx.db.query("words").withIndex("by_term_normalized", (q: any) => q.eq("term_normalized", normalized)).unique();
    if (existing) {
      const { _id, _creationTime, ...word } = existing;
      return word;
    }
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
      last_quality: null,
      last_rating: null,
      lapses: 0,
      progress_state: "learning",
      archived: false,
      ...withGeneratedIllustration(validation.value),
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
    if (!validation.ok) throw appError("INVALID_AI_RESPONSE", validation.error, 422);
    const normalized = normalizeText(validation.value.term);
    const duplicate = await ctx.db.query("words").withIndex("by_term_normalized", (q: any) => q.eq("term_normalized", normalized)).unique();
    if (duplicate && duplicate.id !== args.id) {
      throw appError("BAD_REQUEST", "Another saved card already uses this term.", 409);
    }
    const next = {
      ...withGeneratedIllustration(validation.value),
      term_normalized: normalized,
      updated_at: nowIso(),
    };
    await ctx.db.patch(existing._id, next);
    return { ...existing, ...next, _id: undefined, _creationTime: undefined };
  },
});

export const deleteWord = mutation({
  args: { id: v.string() },
  handler: async (ctx, args) => {
    const existing = await wordById(ctx, args.id);
    if (!existing) throw appError("NOT_FOUND", "Word not found.", 404);
    await ctx.db.delete(existing._id);
    const { _id, _creationTime, ...word } = existing;
    return word;
  },
});

export const recordReview = mutation({
  args: {
    word_id: v.string(),
    rating: v.string(),
  },
  handler: async (ctx, args) => {
    if (!["Again", "Hard", "Good", "Easy"].includes(args.rating)) {
      throw appError("BAD_REQUEST", "Rating must be Again, Hard, Good, or Easy.", 400);
    }
    const existing = await wordById(ctx, args.word_id);
    if (!existing) throw appError("NOT_FOUND", "Word not found.", 404);
    const outcome = sm2(existing, args.rating);
    const { _id, _creationTime, ...updatedWord } = outcome.updatedWord;
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

export const addImportLog = mutation({
  args: {
    source_url: v.string(),
    requested_terms: v.array(v.string()),
    imported_count: v.number(),
    skipped_count: v.number(),
    failed_count: v.number(),
  },
  handler: async (ctx, args) => {
    const entry = { id: uid("import"), created_at: nowIso(), ...args };
    await ctx.db.insert("imports", entry);
    return entry;
  },
});

export const importSnapshot = mutation({
  args: {
    settings: v.any(),
    profile: v.any(),
    words: v.array(v.any()),
    review_events: v.array(v.any()),
    imports: v.array(v.any()),
  },
  handler: async (ctx, args) => {
    const settings = normalizeSettings(args.settings);
    const settingsDoc = await ensureSettingsDoc(ctx);
    await ctx.db.patch(settingsDoc._id, { ...settings, updated_at: nowIso() });

    const profileDoc = await ensureProfileDoc(ctx);
    await ctx.db.patch(profileDoc._id, {
      learner_name: args.profile?.learner_name || defaultProfile.learner_name,
      accent: "American English",
      daily_goal: Number.isInteger(args.profile?.daily_goal) ? args.profile.daily_goal : defaultProfile.daily_goal,
      updated_at: nowIso(),
    });

    let words = 0;
    for (const candidate of args.words || []) {
      if (!candidate?.id || !candidate?.term) continue;
      const existing = await wordById(ctx, String(candidate.id));
      if (existing) continue;
      const validation = validateWordCard(candidate);
      if (!validation.ok) continue;
      await ctx.db.insert("words", {
        ...withGeneratedIllustration(validation.value),
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
        last_quality: typeof candidate.last_quality === "number" ? candidate.last_quality : null,
        last_rating: candidate.last_rating || null,
        lapses: Number(candidate.lapses || 0),
        progress_state: candidate.progress_state || "learning",
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
        due_before: event.due_before || null,
        due_after: String(event.due_after || ""),
        occurred_at: String(event.occurred_at || nowIso()),
        interval_days_before: Number(event.interval_days_before || 0),
        interval_days_after: Number(event.interval_days_after || 0),
        ease_factor_after: Number(event.ease_factor_after || 2.5),
      });
      reviewEvents += 1;
    }

    let imports = 0;
    for (const item of args.imports || []) {
      if (!item?.id) continue;
      await ctx.db.insert("imports", {
        id: String(item.id),
        created_at: String(item.created_at || nowIso()),
        source_url: String(item.source_url || ""),
        requested_terms: Array.isArray(item.requested_terms) ? item.requested_terms.map(String) : [],
        imported_count: Number(item.imported_count || 0),
        skipped_count: Number(item.skipped_count || 0),
        failed_count: Number(item.failed_count || 0),
      });
      imports += 1;
    }

    return { words, review_events: reviewEvents, imports };
  },
});
