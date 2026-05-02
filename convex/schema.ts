import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

const provider = v.object({
  base_url: v.string(),
  model: v.string(),
  encrypted_api_key: v.string(),
  connection_status: v.string(),
  last_tested_at: v.union(v.string(), v.null()),
});

const wordFields = {
  id: v.string(),
  term: v.string(),
  term_normalized: v.string(),
  definition: v.string(),
  nuances: v.string(),
  phonetics_us: v.string(),
  part_of_speech: v.string(),
  synonyms: v.array(v.string()),
  antonyms: v.array(v.string()),
  examples: v.array(v.string()),
  image_prompt: v.string(),
  image_svg: v.optional(v.string()),
  source_type: v.string(),
  source_label: v.string(),
  created_at: v.string(),
  updated_at: v.string(),
  next_review_at: v.string(),
  last_reviewed_at: v.union(v.string(), v.null()),
  review_count: v.number(),
  repetitions: v.number(),
  interval_days: v.number(),
  previous_interval_days: v.number(),
  ease_factor: v.number(),
  last_quality: v.union(v.number(), v.null()),
  last_rating: v.union(v.string(), v.null()),
  lapses: v.number(),
  progress_state: v.string(),
  archived: v.boolean(),
};

export default defineSchema({
  settings: defineTable({
    key: v.string(),
    active_provider: v.string(),
    providers: v.object({
      custom: provider,
      openai: provider,
      anthropic: provider,
    }),
    american_accent_only: v.boolean(),
    updated_at: v.string(),
  }).index("by_key", ["key"]),

  profile: defineTable({
    key: v.string(),
    learner_name: v.string(),
    accent: v.string(),
    daily_goal: v.number(),
    updated_at: v.string(),
  }).index("by_key", ["key"]),

  words: defineTable(wordFields)
    .index("by_id", ["id"])
    .index("by_term_normalized", ["term_normalized"])
    .index("by_updated_at", ["updated_at"])
    .index("by_created_at", ["created_at"])
    .index("by_next_review_at", ["next_review_at"])
    .index("by_progress_state", ["progress_state"]),

  reviewEvents: defineTable({
    id: v.string(),
    word_id: v.string(),
    term: v.string(),
    rating: v.string(),
    quality: v.number(),
    due_before: v.union(v.string(), v.null()),
    due_after: v.string(),
    occurred_at: v.string(),
    interval_days_before: v.number(),
    interval_days_after: v.number(),
    ease_factor_after: v.number(),
  }).index("by_occurred_at", ["occurred_at"]),

  imports: defineTable({
    id: v.string(),
    created_at: v.string(),
    source_url: v.string(),
    requested_terms: v.array(v.string()),
    imported_count: v.number(),
    skipped_count: v.number(),
    failed_count: v.number(),
  }).index("by_created_at", ["created_at"]),
});
