import { v } from "convex/values";
import { makeFunctionReference } from "convex/server";
import { action } from "./_generated/server";
import {
  appError,
  cardValidator,
  normalizeText,
  publicSettings,
  uniqueStrings,
  validateWordCard,
  withGeneratedIllustration,
} from "./lib";

declare const process: { env: Record<string, string | undefined> };

const OPENAI_DEFAULT_BASE_URL = "https://api.openai.com/v1";
const ANTHROPIC_DEFAULT_BASE_URL = "https://api.anthropic.com";
const getPrivateSettingsRef = makeFunctionReference<"query">("data:getPrivateSettings");
const getBootstrapRef = makeFunctionReference<"query">("data:getBootstrap");
const listWordsRef = makeFunctionReference<"query">("data:listWords");
const saveSettingsRef = makeFunctionReference<"mutation">("data:saveSettings");
const saveWordRef = makeFunctionReference<"mutation">("data:saveWord");
const addImportLogRef = makeFunctionReference<"mutation">("data:addImportLog");

function mapProviderError(status: number, message?: string) {
  if (status === 400) throw appError("PROVIDER_BAD_REQUEST", message || "Provider rejected the request.", 400);
  if (status === 401 || status === 403) throw appError("INVALID_API_KEY", message || "The supplied API key was rejected.", 401);
  if (status === 404) throw appError("PROVIDER_NOT_FOUND", message || "The provider endpoint was not found.", 404);
  if (status === 409) throw appError("PROVIDER_CONFLICT", message || "Provider request conflicted with current state.", 409);
  if (status === 429) throw appError("QUOTA_EXCEEDED", message || "Provider quota exceeded.", 429);
  if (status >= 500) throw appError("PROVIDER_UNAVAILABLE", message || "Provider is temporarily unavailable.", 503);
  throw appError("PROVIDER_UNAVAILABLE", message || "Provider request failed.", status || 502);
}

function extractJsonText(rawText: string) {
  const trimmed = String(rawText || "").trim();
  if (!trimmed) throw appError("INVALID_AI_RESPONSE", "Provider returned an empty response.", 422);
  try {
    return JSON.parse(trimmed);
  } catch {
    const fenced = trimmed.match(/```json\s*([\s\S]*?)```/i) || trimmed.match(/```([\s\S]*?)```/i);
    if (fenced) return JSON.parse(fenced[1].trim());
    const firstBrace = trimmed.indexOf("{");
    const lastBrace = trimmed.lastIndexOf("}");
    if (firstBrace !== -1 && lastBrace !== -1 && lastBrace > firstBrace) {
      return JSON.parse(trimmed.slice(firstBrace, lastBrace + 1));
    }
    throw appError("INVALID_AI_RESPONSE", "Provider did not return valid JSON.", 422);
  }
}

function normalizeOpenAICompatibleBaseUrl(baseUrl: string) {
  let url = String(baseUrl || "").trim().replace(/\/+$/, "");
  if (!url) throw appError("BAD_REQUEST", "Base URL is required.", 400);
  if (!url.startsWith("http://") && !url.startsWith("https://")) url = `https://${url}`;
  if (!url.endsWith("/chat/completions")) {
    if (!url.includes("/v1")) url += "/v1";
    if (!url.endsWith("/chat/completions")) url += "/chat/completions";
  }
  return url;
}

function normalizeOpenAIBaseUrl(baseUrl?: string) {
  const root = String(baseUrl || OPENAI_DEFAULT_BASE_URL).trim().replace(/\/+$/, "");
  if (!root.startsWith("http://") && !root.startsWith("https://")) return `${OPENAI_DEFAULT_BASE_URL}/chat/completions`;
  return root.endsWith("/chat/completions") ? root : `${root}/chat/completions`;
}

function normalizeOpenAIModelsUrl(baseUrl?: string) {
  const root = String(baseUrl || OPENAI_DEFAULT_BASE_URL).trim().replace(/\/+$/, "");
  const prefixed = root.startsWith("http://") || root.startsWith("https://") ? root : OPENAI_DEFAULT_BASE_URL;
  const apiRoot = prefixed.endsWith("/chat/completions") ? prefixed.replace(/\/chat\/completions$/, "") : prefixed;
  return apiRoot.endsWith("/models") ? apiRoot : `${apiRoot}/models`;
}

function normalizeAnthropicBaseUrl(baseUrl?: string) {
  const root = String(baseUrl || ANTHROPIC_DEFAULT_BASE_URL).trim().replace(/\/+$/, "");
  const prefixed = root.startsWith("http://") || root.startsWith("https://") ? root : `https://${root}`;
  return prefixed.endsWith("/v1/messages") ? prefixed : `${prefixed}/v1/messages`;
}

function normalizeAnthropicModelsUrl(baseUrl?: string) {
  const root = String(baseUrl || ANTHROPIC_DEFAULT_BASE_URL).trim().replace(/\/+$/, "");
  const prefixed = root.startsWith("http://") || root.startsWith("https://") ? root : ANTHROPIC_DEFAULT_BASE_URL;
  const apiRoot = prefixed.endsWith("/v1/messages") ? prefixed.replace(/\/v1\/messages$/, "") : prefixed;
  return apiRoot.endsWith("/v1/models") ? apiRoot : `${apiRoot}/v1/models`;
}

function normalizeModelList(models: any[]) {
  const seen = new Set<string>();
  return models
    .map((model) => String(model?.id || model || "").trim())
    .filter((id) => {
      if (!id || seen.has(id)) return false;
      seen.add(id);
      return true;
    })
    .sort((left, right) => left.localeCompare(right));
}

async function listOpenAIStyleModels(endpoint: string, apiKey: string) {
  const response = await fetch(endpoint, {
    method: "GET",
    headers: { authorization: `Bearer ${apiKey}`, "content-type": "application/json" },
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) mapProviderError(response.status, payload?.error?.message || payload?.message);
  return normalizeModelList(Array.isArray(payload?.data) ? payload.data : []);
}

async function listAnthropicModels(endpoint: string, apiKey: string) {
  const response = await fetch(endpoint, {
    method: "GET",
    headers: {
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
      "content-type": "application/json",
    },
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) mapProviderError(response.status, payload?.error?.message || payload?.message);
  return normalizeModelList(Array.isArray(payload?.data) ? payload.data : []);
}

async function listProviderModels(providerConfig: any) {
  if (!providerConfig.provider || !providerConfig.apiKey) {
    throw appError("BAD_REQUEST", "Provider and API key are required.", 400);
  }
  if (providerConfig.provider === "anthropic") {
    return listAnthropicModels(normalizeAnthropicModelsUrl(providerConfig.baseUrl), providerConfig.apiKey);
  }
  return listOpenAIStyleModels(normalizeOpenAIModelsUrl(providerConfig.baseUrl), providerConfig.apiKey);
}

async function callOpenAIStyle({ endpoint, apiKey, model, system, user, maxTokens = 1400, structured = false }: any) {
  const body: any = {
    model,
    messages: [{ role: "system", content: system }, { role: "user", content: user }],
    max_tokens: maxTokens,
    temperature: 0.7,
  };
  if (structured) body.response_format = { type: "json_object" };
  const response = await fetch(endpoint, {
    method: "POST",
    headers: { authorization: `Bearer ${apiKey}`, "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) mapProviderError(response.status, payload?.error?.message || payload?.message);
  return {
    rawText: String(payload?.choices?.[0]?.message?.content || "").trim(),
    usage: payload?.usage
      ? {
          input_tokens: payload.usage.prompt_tokens || 0,
          output_tokens: payload.usage.completion_tokens || 0,
          total_tokens: payload.usage.total_tokens || 0,
        }
      : { input_tokens: 0, output_tokens: 0, total_tokens: 0 },
    model: payload?.model || model,
  };
}

async function callAnthropic({ endpoint, apiKey, model, system, user, maxTokens = 1400 }: any) {
  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
      "content-type": "application/json",
    },
    body: JSON.stringify({
      model,
      system,
      max_tokens: maxTokens,
      temperature: 0.7,
      messages: [{ role: "user", content: user }],
    }),
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) mapProviderError(response.status, payload?.error?.message || payload?.message);
  const rawText = Array.isArray(payload?.content)
    ? payload.content.filter((item: any) => item?.type === "text").map((item: any) => item.text).join("\n").trim()
    : "";
  return {
    rawText,
    usage: payload?.usage
      ? {
          input_tokens: payload.usage.input_tokens || 0,
          output_tokens: payload.usage.output_tokens || 0,
          total_tokens: (payload.usage.input_tokens || 0) + (payload.usage.output_tokens || 0),
        }
      : { input_tokens: 0, output_tokens: 0, total_tokens: 0 },
    model: payload?.model || model,
  };
}

async function callProvider(providerConfig: any, request: any) {
  if (!providerConfig.provider || !providerConfig.model || !providerConfig.apiKey) {
    throw appError("BAD_REQUEST", "Provider, model, and API key are required.", 400);
  }
  if (providerConfig.provider === "custom") {
    return callOpenAIStyle({
      endpoint: providerConfig.baseUrl ? normalizeOpenAICompatibleBaseUrl(providerConfig.baseUrl) : normalizeOpenAIBaseUrl(providerConfig.baseUrl),
      apiKey: providerConfig.apiKey,
      model: providerConfig.model,
      ...request,
    });
  }
  if (providerConfig.provider === "openai") {
    return callOpenAIStyle({
      endpoint: normalizeOpenAIBaseUrl(providerConfig.baseUrl),
      apiKey: providerConfig.apiKey,
      model: providerConfig.model,
      ...request,
    });
  }
  if (providerConfig.provider === "anthropic") {
    return callAnthropic({
      endpoint: normalizeAnthropicBaseUrl(providerConfig.baseUrl),
      apiKey: providerConfig.apiKey,
      model: providerConfig.model,
      ...request,
    });
  }
  throw appError("BAD_REQUEST", "Unsupported provider.", 400);
}

function buildWordGenerationMessages(term: string) {
  return {
    system: `You create premium vocabulary cards for an app called WordForge. Teach only American English pronunciation and usage.
Return ONLY valid JSON with this exact structure:
{
  "term": "headword or phrase",
  "definition": "a concise but precise definition in plain English",
  "nuances": "subtle shades of meaning, register, and when to use it",
  "phonetics_us": "/General American IPA/",
  "part_of_speech": "noun, verb, adjective, etc.",
  "synonyms": ["3 to 6 synonyms"],
  "antonyms": ["2 to 5 antonyms"],
  "examples": ["exactly 10 advanced, natural, complex example sentences"],
  "image_prompt": "a vivid visual scene that would help a learner picture the word"
}
Rules:
- Use American English only.
- Examples must be advanced, natural, and varied in tone and syntax.
- Keep the definition and nuances useful for learning, not dictionary jargon.
- Return exactly 10 examples.
- Do not include markdown.`,
    user: `Create a WordForge vocabulary card for: ${term}`,
  };
}

function buildIllustrationMessages(card: any) {
  return {
    system: `You create compact SVG illustrations for vocabulary cards. Return ONLY raw SVG markup, no markdown, no explanation.
Rules:
- Width 720 and height 480 or equivalent viewBox.
- No scripts, no external URLs, no fonts from the web.
- Use simple shapes, gradients, and composition to suggest the meaning.
- No text in the SVG.
- Keep it visually elegant and easy to render.`,
    user: `Create an SVG illustration for this vocabulary word:
Term: ${card.term}
Definition: ${card.definition}
Nuances: ${card.nuances}
Visual scene: ${card.image_prompt}
Part of speech: ${card.part_of_speech}
American pronunciation: ${card.phonetics_us}`,
  };
}

async function generateIllustrationSvg(providerConfig: any, card: any) {
  try {
    const messages = buildIllustrationMessages(card);
    const response = await callProvider(providerConfig, { system: messages.system, user: messages.user, maxTokens: 1200 });
    return response.rawText.includes("<svg") ? response.rawText : null;
  } catch {
    return null;
  }
}

async function generateWordCardWithAI(providerConfig: any, term: string) {
  const messages = buildWordGenerationMessages(term);
  const response = await callProvider(providerConfig, {
    system: messages.system,
    user: messages.user,
    maxTokens: 2200,
    structured: providerConfig.provider !== "anthropic",
  });
  const parsed = extractJsonText(response.rawText);
  const validation = validateWordCard(parsed);
  if (!validation.ok) throw appError("INVALID_AI_RESPONSE", validation.error, 422);
  const imageSvg = await generateIllustrationSvg(providerConfig, validation.value);
  return {
    card: withGeneratedIllustration({ ...validation.value, image_svg: imageSvg }),
    usage: response.usage,
    model: response.model,
    provider: providerConfig.provider,
  };
}

function bytesToBase64(bytes: Uint8Array) {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function base64ToBytes(value: string) {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return bytes;
}

async function masterKey() {
  const secret = process.env.APP_MASTER_KEY;
  if (!secret) throw appError("SERVER_CONFIG_MISSING", "Set APP_MASTER_KEY in Convex environment variables before saving provider keys.", 500);
  return await crypto.subtle.digest("SHA-256", new TextEncoder().encode(secret));
}

async function encryptSecret(plainText: string) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const key = await crypto.subtle.importKey("raw", await masterKey(), "AES-GCM", false, ["encrypt"]);
  const encrypted = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, new TextEncoder().encode(plainText));
  return `${bytesToBase64(iv)}.${bytesToBase64(new Uint8Array(encrypted))}`;
}

async function decryptSecret(payload: string) {
  const [ivBase64, encryptedBase64] = String(payload || "").split(".");
  if (!ivBase64 || !encryptedBase64) {
    throw appError("INVALID_API_KEY", "Stored API key could not be decrypted.", 500);
  }
  const key = await crypto.subtle.importKey("raw", await masterKey(), "AES-GCM", false, ["decrypt"]);
  const decrypted = await crypto.subtle.decrypt({ name: "AES-GCM", iv: base64ToBytes(ivBase64) }, key, base64ToBytes(encryptedBase64));
  return new TextDecoder().decode(decrypted);
}

async function resolveProviderPayload(ctx: any, body: any, options: any = {}) {
  const currentSettings = await ctx.runQuery(getPrivateSettingsRef, {});
  const provider = String(body.provider || body.active_provider || currentSettings.active_provider || "custom").trim();
  const activeProvider = body.active_provider === undefined ? currentSettings.active_provider : String(body.active_provider || "").trim();
  const savedProvider = currentSettings.providers[provider];
  if (!savedProvider) throw appError("BAD_REQUEST", "Unknown provider selected.", 400);
  const baseUrl = String(body.base_url === undefined ? savedProvider.base_url || "" : body.base_url || "").trim();
  const model = String(body.model === undefined ? savedProvider.model || "" : body.model || "").trim();
  const typedKey = String(body.api_key || "").trim();
  const apiKey = typedKey || (savedProvider.encrypted_api_key ? await decryptSecret(savedProvider.encrypted_api_key) : "");
  if (!model && options.requireModel !== false) throw appError("BAD_REQUEST", "Model is required.", 400);
  if (!apiKey) throw appError("BAD_REQUEST", "API key is required.", 400);
  if (options.requireTypedKey && !typedKey) throw appError("BAD_REQUEST", "Enter an API key to save this provider.", 400);
  return { provider, activeProvider, baseUrl, model, apiKey, typedKey };
}

export const testSettings = action({
  args: { body: v.any() },
  handler: async (ctx, args) => {
    const resolved = await resolveProviderPayload(ctx, args.body, { requireModel: false });
    const models = await listProviderModels({
      provider: resolved.provider,
      baseUrl: resolved.baseUrl,
      model: resolved.model,
      apiKey: resolved.apiKey,
    });
    if (!models.length) throw appError("PROVIDER_NO_MODELS", "The API key is valid, but no models were returned.", 422);
    return {
      status: "connected",
      provider: resolved.provider,
      base_url: resolved.baseUrl,
      model: resolved.model || models[0],
      models,
      persisted: false,
    };
  },
});

export const saveSettings = action({
  args: { body: v.any() },
  handler: async (ctx, args) => {
    const resolved = await resolveProviderPayload(ctx, args.body);
    const models = await listProviderModels({
      provider: resolved.provider,
      baseUrl: resolved.baseUrl,
      model: resolved.model,
      apiKey: resolved.apiKey,
    });
    if (!models.includes(resolved.model)) {
      throw appError("BAD_REQUEST", "Choose one of the models detected for this API key before saving.", 400);
    }
    const encrypted = resolved.typedKey ? await encryptSecret(resolved.typedKey) : undefined;
    const settings = await ctx.runMutation(saveSettingsRef, {
      provider: resolved.provider,
      active_provider: resolved.activeProvider,
      base_url: resolved.baseUrl,
      model: resolved.model,
      encrypted_api_key: encrypted,
      connection_status: "connected",
      last_tested_at: new Date().toISOString(),
    });
    return {
      settings,
      verification: {
        ok: true,
        message: `Settings saved and verified. Detected ${models.length} available models.`,
        models,
      },
    };
  },
});

export const generateWord = action({
  args: { term: v.string() },
  handler: async (ctx, args) => {
    const term = String(args.term || "").trim();
    if (!term) throw appError("BAD_REQUEST", "Enter a word or phrase to generate.", 400);
    const settings = await ctx.runQuery(getPrivateSettingsRef, {});
    const provider = settings.active_provider;
    const providerSettings = settings.providers[provider];
    if (!providerSettings.model || !providerSettings.encrypted_api_key) {
      throw appError("INVALID_API_KEY", `Add the ${provider} model and API key in Settings first.`, 400);
    }
    return generateWordCardWithAI({
      provider,
      baseUrl: providerSettings.base_url,
      model: providerSettings.model,
      apiKey: await decryptSecret(providerSettings.encrypted_api_key),
    }, term);
  },
});

function extractGoogleDocId(input: string) {
  const match = String(input || "").trim().match(/\/document\/d\/([a-zA-Z0-9_-]+)/);
  if (!match) throw appError("BAD_REQUEST", "Enter a valid Google Docs document URL.", 400);
  return match[1];
}

function extractWordsFromText(text: string, limit = 25) {
  const candidates: string[] = [];
  for (const line of String(text || "").split(/\r?\n/)) {
    const clean = line.replace(/^[\s>*-]+/, "").replace(/^\d+[\.)]\s*/, "").trim();
    const parts = clean.includes(",") && clean.split(",").every((part) => part.trim().split(/\s+/).length <= 4)
      ? clean.split(",")
      : clean.includes(";") && clean.split(";").every((part) => part.trim().split(/\s+/).length <= 4)
        ? clean.split(";")
        : [clean];
    for (const part of parts) {
      const trimmed = part.trim();
      if (!trimmed || trimmed.split(/\s+/).length > 6 || normalizeText(trimmed).length < 2) continue;
      candidates.push(trimmed);
      if (candidates.length >= limit * 2) break;
    }
    if (candidates.length >= limit * 2) break;
  }
  return uniqueStrings(candidates, limit);
}

async function fetchGoogleDocText(docUrl: string, accessToken: string) {
  const token = String(accessToken || "").trim();
  if (!token) throw appError("GOOGLE_OAUTH_REQUIRED", "Authorize Google Docs access before starting the import.", 400);
  const docId = extractGoogleDocId(docUrl);
  const exportUrl = `https://www.googleapis.com/drive/v3/files/${docId}/export?mimeType=${encodeURIComponent("text/plain")}`;
  const response = await fetch(exportUrl, { headers: { authorization: `Bearer ${token}` }, redirect: "follow" });
  if (response.status === 401) throw appError("GOOGLE_DOC_AUTH_EXPIRED", "Google authorization expired. Sign in with Google again and retry the import.", 401);
  if (response.status === 403) throw appError("GOOGLE_DOC_PERMISSION_DENIED", "Google denied access to that document. Make sure the selected account can read it.", 403);
  if (response.status === 404) throw appError("GOOGLE_DOC_NOT_FOUND", "That Google Doc could not be found.", 404);
  if (!response.ok) throw appError("GOOGLE_DOC_IMPORT_FAILED", "Unable to read that Google Doc right now. Please try again in a moment.", response.status || 502);
  return response.text();
}

export const importGoogleDoc = action({
  args: { url: v.string(), access_token: v.string() },
  handler: async (ctx, args) => {
    const settings = await ctx.runQuery(getPrivateSettingsRef, {});
    const provider = settings.active_provider;
    const providerSettings = settings.providers[provider];
    const credentials = {
      provider,
      baseUrl: providerSettings.base_url,
      model: providerSettings.model,
      apiKey: await decryptSecret(providerSettings.encrypted_api_key),
    };

    let text = "";
    try {
      text = await fetchGoogleDocText(args.url, args.access_token);
    } catch (error: any) {
      const data = error?.data || error;
      if (String(data?.code || "").startsWith("GOOGLE_DOC") || data?.code === "GOOGLE_OAUTH_REQUIRED") {
        const bootstrap = await ctx.runQuery(getBootstrapRef, {});
        return { requested_terms: [], imported: [], skipped: [], failed: [], import_error: data, stats: bootstrap.stats };
      }
      throw error;
    }

    const terms = extractWordsFromText(text, 25);
    if (!terms.length) {
      const bootstrap = await ctx.runQuery(getBootstrapRef, {});
      return {
        requested_terms: [],
        imported: [],
        skipped: [],
        failed: [],
        import_error: { code: "GOOGLE_DOC_NO_TERMS", message: "The Google Doc was readable, but no importable words were found." },
        stats: bootstrap.stats,
      };
    }

    const imported: any[] = [];
    const skipped: any[] = [];
    const failed: any[] = [];
    const current = await ctx.runQuery(listWordsRef, {});
    const existingTerms = new Set(current.words.map((word: any) => normalizeText(word.term)));

    for (const term of terms) {
      if (existingTerms.has(normalizeText(term))) {
        skipped.push({ term, reason: "Already in library" });
        continue;
      }
      try {
        const generated = await generateWordCardWithAI(credentials, term);
        const saved = await ctx.runMutation(saveWordRef, {
          card: generated.card,
          source: { type: "google-doc", label: args.url },
        });
        existingTerms.add(normalizeText(saved.term));
        imported.push(saved);
      } catch (error: any) {
        failed.push({ term, reason: error?.data?.message || error?.message || "Import failed" });
      }
    }

    await ctx.runMutation(addImportLogRef, {
      source_url: args.url,
      requested_terms: terms,
      imported_count: imported.length,
      skipped_count: skipped.length,
      failed_count: failed.length,
    });
    const bootstrap = await ctx.runQuery(getBootstrapRef, {});
    return { requested_terms: terms, imported, skipped, failed, import_error: null, stats: bootstrap.stats };
  },
});

export const saveCardFromHttp = action({
  args: {
    card: cardValidator,
    source: v.optional(v.any()),
  },
  handler: async (ctx, args) => {
    const word = await ctx.runMutation(saveWordRef, { card: args.card, source: args.source || {} });
    const bootstrap = await ctx.runQuery(getBootstrapRef, {});
    return { word, stats: bootstrap.stats };
  },
});
