import { ConvexHttpClient } from "convex/browser";
import { makeFunctionReference } from "convex/server";
import { convexTest } from "convex-test";
import { describe, expect, test } from "vitest";
import { api } from "./_generated/api";
import schema from "./schema";
import { modules } from "./test.setup";

function makeCard(term = "circumspect") {
  return {
    term,
    definition: "careful to consider all risks before acting or speaking",
    nuances: "Often suggests measured caution rather than fear in formal contexts.",
    phonetics_us: "/ser-kuhm-spekt/",
    part_of_speech: "adjective",
    synonyms: ["cautious", "prudent", "wary"],
    antonyms: ["rash", "reckless"],
    examples: Array.from({ length: 10 }, (_, index) => `Example sentence ${index + 1} for ${term}.`),
    image_prompt: "A strategist leaning over a map before making a delicate move",
  };
}

function convexApp() {
  return convexTest(schema, modules);
}

describe("Convex database", () => {
  test("bootstrap returns default empty app contract without creating local state", async () => {
    const t = convexApp();
    const bootstrap = await t.query(api.data.getBootstrap, {});

    expect(bootstrap.app_name).toBe("WordForge");
    expect(bootstrap.profile).toMatchObject({
      learner_name: "Learner",
      accent: "American English",
      daily_goal: 12,
    });
    expect(bootstrap.stats).toMatchObject({
      total_words: 0,
      due_words: 0,
      mastery_rate: 0,
    });
    expect(bootstrap.words).toEqual([]);
    expect(bootstrap.due_queue).toMatchObject({ count: 0, items: [] });
    expect(bootstrap.settings.providers.custom.has_key).toBe(false);
    expect(bootstrap.settings.providers.custom).not.toHaveProperty("encrypted_api_key");
  });

  test("word lifecycle saves, rejects duplicate terms, updates, reviews, and deletes", async () => {
    const t = convexApp();

    const saved = await t.mutation(api.data.saveWord, {
      card: makeCard("Assiduous"),
      source: { type: "manual", label: "Test suite" },
    });
    expect(saved.id).toMatch(/^word_/);
    expect(saved.term_normalized).toBe("assiduous");

    const duplicate = await t.mutation(api.data.saveWord, {
      card: makeCard(" assiduous "),
      source: { type: "manual", label: "Duplicate" },
    });
    expect(duplicate.id).toBe(saved.id);

    const listAfterDuplicate = await t.query(api.data.listWords, {});
    expect(listAfterDuplicate.words).toHaveLength(1);

    const updated = await t.mutation(api.data.updateWord, {
      id: saved.id,
      card: { ...makeCard("Assiduous"), definition: "showing great care and perseverance" },
    });
    expect(updated.id).toBe(saved.id);
    expect(updated.definition).toBe("showing great care and perseverance");
    expect(updated).not.toHaveProperty("_id");

    const review = await t.mutation(api.data.recordReview, {
      word_id: saved.id,
      rating: "Good",
    });
    expect(review.word.review_count).toBe(1);
    expect(review.word.repetitions).toBe(1);
    expect(review.review_event.word_id).toBe(saved.id);
    expect(review.stats.reviews_today).toBeGreaterThanOrEqual(1);

    const removed = await t.mutation(api.data.deleteWord, { id: saved.id });
    expect(removed.id).toBe(saved.id);
    const listAfterDelete = await t.query(api.data.listWords, {});
    expect(listAfterDelete.words).toEqual([]);
  });

  test("settings keep encrypted keys private in public payloads", async () => {
    const t = convexApp();

    const publicSettings = await t.mutation(api.data.saveSettings, {
      provider: "custom",
      active_provider: "custom",
      base_url: "https://provider.example/v1",
      model: "model-a",
      encrypted_api_key: "encrypted-secret",
      connection_status: "connected",
      last_tested_at: "2026-05-02T00:00:00.000Z",
    });

    expect(publicSettings.providers.custom.has_key).toBe(true);
    expect(publicSettings.providers.custom).not.toHaveProperty("encrypted_api_key");

    const bootstrap = await t.query(api.data.getBootstrap, {});
    expect(bootstrap.settings.providers.custom.has_key).toBe(true);
    expect(JSON.stringify(bootstrap.settings)).not.toContain("encrypted-secret");

    const privateSettings = await t.query(api.data.getPrivateSettings, {});
    expect(privateSettings.providers.custom.encrypted_api_key).toBe("encrypted-secret");
  });

  test("profile validation and import snapshot preserve data rules", async () => {
    const t = convexApp();

    await expect(t.mutation(api.data.saveProfile, {
      learner_name: "Ada",
      daily_goal: 51,
    })).rejects.toThrow(/Daily review goal/);

    const result = await t.mutation(api.data.importSnapshot, {
      settings: {
        model: "legacy-model",
        encrypted_api_key: "legacy-encrypted-key",
      },
      profile: {
        learner_name: "Ada",
        daily_goal: 7,
      },
      words: [
        {
          ...makeCard("Lucid"),
          id: "word_legacy_1",
          term_normalized: "lucid",
          source_type: "migration",
          source_label: "JSON migration",
        },
        { id: "word_invalid", term: "bad" },
      ],
      review_events: [{ id: "review_1", word_id: "word_legacy_1", rating: "Good" }],
      imports: [{ id: "import_1", source_url: "https://docs.example", requested_terms: ["Lucid"] }],
    });

    expect(result).toEqual({ words: 1, review_events: 1, imports: 1 });
    const bootstrap = await t.query(api.data.getBootstrap, {});
    expect(bootstrap.profile.learner_name).toBe("Ada");
    expect(bootstrap.words).toHaveLength(1);
    expect(bootstrap.words[0].id).toBe("word_legacy_1");
    expect(bootstrap.imports).toHaveLength(1);
  });

  test("missing provider key fails generation before any provider call is needed", async () => {
    const t = convexApp();

    await expect(t.action(api.actions.generateWord, { term: "lucid" }))
      .rejects.toThrow(/Add the custom model and API key/);
  });
});

describe("Convex HTTP actions", () => {
  test("REST routes expose bootstrap, word CRUD, review, bad JSON, and CORS", async () => {
    const t = convexApp();

    const options = await t.fetch("/api/bootstrap", { method: "OPTIONS" });
    expect(options.status).toBe(204);
    expect(options.headers.get("access-control-allow-origin")).toBe("*");

    const bootstrap = await t.fetch("/api/bootstrap");
    expect(bootstrap.status).toBe(200);
    expect((await bootstrap.json()).app_name).toBe("WordForge");

    const badJson = await t.fetch("/api/profile", {
      method: "POST",
      body: "{bad json",
    });
    expect(badJson.status).toBe(400);
    expect((await badJson.json()).error.code).toBe("BAD_REQUEST");

    const create = await t.fetch("/api/words", {
      method: "POST",
      body: JSON.stringify({ card: makeCard("Meticulous"), source: { type: "manual", label: "HTTP test" } }),
    });
    expect(create.status).toBe(200);
    const created = await create.json();
    expect(created.word.term).toBe("Meticulous");
    expect(created.stats.total_words).toBe(1);

    const review = await t.fetch("/api/review", {
      method: "POST",
      body: JSON.stringify({ word_id: created.word.id, rating: "Good" }),
    });
    expect(review.status).toBe(200);
    expect((await review.json()).review_event.word_id).toBe(created.word.id);

    const update = await t.fetch(`/api/words/${created.word.id}`, {
      method: "PUT",
      body: JSON.stringify({ card: { ...makeCard("Meticulous"), nuances: "Extremely careful about details." } }),
    });
    expect(update.status).toBe(200);
    expect((await update.json()).word.nuances).toBe("Extremely careful about details.");

    const remove = await t.fetch(`/api/words/${created.word.id}`, { method: "DELETE" });
    expect(remove.status).toBe(200);
    const removed = await remove.json();
    expect(removed.deleted).toBe(true);
    expect(removed.stats.total_words).toBe(0);
  });
});

describe("Live Convex deployment smoke", () => {
  test.skipIf(process.env.WORDFORGE_LIVE_CONVEX_TESTS !== "1")("create, review, and delete a marked live test word", async () => {
    const convexUrl = process.env.CONVEX_URL || "https://small-scorpion-772.eu-west-1.convex.cloud";
    const httpUrl = process.env.CONVEX_HTTP_URL || "https://small-scorpion-772.eu-west-1.convex.site";
    const runId = `live-test-${Date.now()}`;
    const client = new ConvexHttpClient(convexUrl);
    let wordId = "";

    try {
      const created = await client.mutation(makeFunctionReference<"mutation">("data:saveWord"), {
        card: makeCard(runId),
        source: { type: "manual", label: runId },
      });
      wordId = created.id;
      expect(created.term).toBe(runId);

      const review = await client.mutation(makeFunctionReference<"mutation">("data:recordReview"), {
        word_id: wordId,
        rating: "Good",
      });
      expect(review.review_event.word_id).toBe(wordId);

      const bootstrapResponse = await fetch(`${httpUrl}/api/bootstrap`);
      expect(bootstrapResponse.status).toBe(200);
      const bootstrap = await bootstrapResponse.json();
      expect(bootstrap.words.some((word: any) => word.id === wordId)).toBe(true);
    } finally {
      if (wordId) {
        await client.mutation(makeFunctionReference<"mutation">("data:deleteWord"), { id: wordId });
      }
    }
  });
});
