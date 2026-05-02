const { createAppError, validateWordCard, withGeneratedIllustration } = require('./shared');

const OPENAI_DEFAULT_BASE_URL = 'https://api.openai.com/v1';
const ANTHROPIC_DEFAULT_BASE_URL = 'https://api.anthropic.com';

function mapProviderError(status, message) {
  if (status === 400) return createAppError('PROVIDER_BAD_REQUEST', message || 'Provider rejected the request.', 400);
  if (status === 401 || status === 403) return createAppError('INVALID_API_KEY', message || 'The supplied API key was rejected.', 401);
  if (status === 404) return createAppError('PROVIDER_NOT_FOUND', message || 'The provider endpoint was not found.', 404);
  if (status === 409) return createAppError('PROVIDER_CONFLICT', message || 'Provider request conflicted with current state.', 409);
  if (status === 429) return createAppError('QUOTA_EXCEEDED', message || 'Provider quota exceeded.', 429);
  if (status >= 500) return createAppError('PROVIDER_UNAVAILABLE', message || 'Provider is temporarily unavailable.', 503);
  return createAppError('PROVIDER_UNAVAILABLE', message || 'Provider request failed.', status || 502);
}

function extractJsonText(rawText) {
  const trimmed = String(rawText || '').trim();
  if (!trimmed) {
    throw createAppError('INVALID_AI_RESPONSE', 'Provider returned an empty response.', 422);
  }

  try {
    return JSON.parse(trimmed);
  } catch {
    const fenced = trimmed.match(/```json\s*([\s\S]*?)```/i) || trimmed.match(/```([\s\S]*?)```/i);
    if (fenced) {
      return JSON.parse(fenced[1].trim());
    }
    const firstBrace = trimmed.indexOf('{');
    const lastBrace = trimmed.lastIndexOf('}');
    if (firstBrace !== -1 && lastBrace !== -1 && lastBrace > firstBrace) {
      return JSON.parse(trimmed.slice(firstBrace, lastBrace + 1));
    }
    throw createAppError('INVALID_AI_RESPONSE', 'Provider did not return valid JSON.', 422);
  }
}

function buildWordGenerationMessages(term) {
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
    user: `Create a WordForge vocabulary card for: ${term}`
  };
}

function buildIllustrationMessages(card) {
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
American pronunciation: ${card.phonetics_us}`
  };
}

function normalizeOpenAICompatibleBaseUrl(baseUrl) {
  let url = String(baseUrl || '').trim().replace(/\/+$/, '');
  if (!url) {
    throw createAppError('BAD_REQUEST', 'Base URL is required.', 400);
  }

  if (!url.startsWith('http://') && !url.startsWith('https://')) {
    url = `https://${url}`;
  }

  if (!url.endsWith('/chat/completions')) {
    if (!url.includes('/v1')) {
      url += '/v1';
    }
    if (!url.endsWith('/chat/completions')) {
      url += '/chat/completions';
    }
  }

  return url;
}

function normalizeOpenAIBaseUrl(baseUrl) {
  const root = String(baseUrl || OPENAI_DEFAULT_BASE_URL).trim().replace(/\/+$/, '');
  if (!root.startsWith('http://') && !root.startsWith('https://')) {
    return `${OPENAI_DEFAULT_BASE_URL}/chat/completions`;
  }
  return root.endsWith('/chat/completions') ? root : `${root}/chat/completions`;
}

function normalizeOpenAIModelsUrl(baseUrl) {
  const root = String(baseUrl || OPENAI_DEFAULT_BASE_URL).trim().replace(/\/+$/, '');
  const prefixed = root.startsWith('http://') || root.startsWith('https://') ? root : OPENAI_DEFAULT_BASE_URL;
  const apiRoot = prefixed.endsWith('/chat/completions') ? prefixed.replace(/\/chat\/completions$/, '') : prefixed;
  return apiRoot.endsWith('/models') ? apiRoot : `${apiRoot}/models`;
}

function normalizeAnthropicBaseUrl(baseUrl) {
  const root = String(baseUrl || ANTHROPIC_DEFAULT_BASE_URL).trim().replace(/\/+$/, '');
  if (!root) return `${ANTHROPIC_DEFAULT_BASE_URL}/v1/messages`;
  const prefixed = root.startsWith('http://') || root.startsWith('https://') ? root : `https://${root}`;
  return prefixed.endsWith('/v1/messages') ? prefixed : `${prefixed}/v1/messages`;
}

function normalizeAnthropicModelsUrl(baseUrl) {
  const root = String(baseUrl || ANTHROPIC_DEFAULT_BASE_URL).trim().replace(/\/+$/, '');
  const prefixed = root.startsWith('http://') || root.startsWith('https://') ? root : ANTHROPIC_DEFAULT_BASE_URL;
  const apiRoot = prefixed.endsWith('/v1/messages') ? prefixed.replace(/\/v1\/messages$/, '') : prefixed;
  return apiRoot.endsWith('/v1/models') ? apiRoot : `${apiRoot}/v1/models`;
}

function normalizeModelList(models) {
  const seen = new Set();
  return models
    .map((model) => String(model?.id || model || '').trim())
    .filter((id) => {
      if (!id || seen.has(id)) return false;
      seen.add(id);
      return true;
    })
    .sort((left, right) => left.localeCompare(right));
}

async function listOpenAIStyleModels({ endpoint, apiKey }) {
  const response = await fetch(endpoint, {
    method: 'GET',
    headers: {
      authorization: `Bearer ${apiKey}`,
      'content-type': 'application/json'
    },
    signal: AbortSignal.timeout(30000)
  });

  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw mapProviderError(response.status, payload?.error?.message || payload?.message);
  }

  return normalizeModelList(Array.isArray(payload?.data) ? payload.data : []);
}

async function listAnthropicModels({ endpoint, apiKey }) {
  const response = await fetch(endpoint, {
    method: 'GET',
    headers: {
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
      'content-type': 'application/json'
    },
    signal: AbortSignal.timeout(30000)
  });

  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw mapProviderError(response.status, payload?.error?.message || payload?.message);
  }

  return normalizeModelList(Array.isArray(payload?.data) ? payload.data : []);
}

async function listProviderModels(providerConfig) {
  const { provider, baseUrl, apiKey } = providerConfig;

  if (!provider || !apiKey) {
    throw createAppError('BAD_REQUEST', 'Provider and API key are required.', 400);
  }

  if (provider === 'anthropic') {
    return listAnthropicModels({
      endpoint: normalizeAnthropicModelsUrl(baseUrl),
      apiKey
    });
  }

  if (provider === 'openai' || provider === 'custom') {
    return listOpenAIStyleModels({
      endpoint: provider === 'custom' ? normalizeOpenAIModelsUrl(baseUrl) : normalizeOpenAIModelsUrl(baseUrl),
      apiKey
    });
  }

  throw createAppError('BAD_REQUEST', 'Unsupported provider.', 400);
}

async function callOpenAIStyle({ endpoint, apiKey, model, system, user, maxTokens = 1400, structured = false }) {
  const body = {
    model,
    messages: [
      { role: 'system', content: system },
      { role: 'user', content: user }
    ],
    max_tokens: maxTokens,
    temperature: 0.7
  };

  if (structured) {
    body.response_format = { type: 'json_object' };
  }

  const response = await fetch(endpoint, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${apiKey}`,
      'content-type': 'application/json'
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(45000)
  });

  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw mapProviderError(response.status, payload?.error?.message || payload?.message);
  }

  return {
    rawText: String(payload?.choices?.[0]?.message?.content || '').trim(),
    usage: payload?.usage
      ? {
          input_tokens: payload.usage.prompt_tokens || 0,
          output_tokens: payload.usage.completion_tokens || 0,
          total_tokens: payload.usage.total_tokens || 0
        }
      : { input_tokens: 0, output_tokens: 0, total_tokens: 0 },
    model: payload?.model || model
  };
}

async function callAnthropic({ endpoint, apiKey, model, system, user, maxTokens = 1400 }) {
  const response = await fetch(endpoint, {
    method: 'POST',
    headers: {
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
      'content-type': 'application/json'
    },
    body: JSON.stringify({
      model,
      system,
      max_tokens: maxTokens,
      temperature: 0.7,
      messages: [{ role: 'user', content: user }]
    }),
    signal: AbortSignal.timeout(45000)
  });

  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw mapProviderError(response.status, payload?.error?.message || payload?.message);
  }

  const rawText = Array.isArray(payload?.content)
    ? payload.content.filter((item) => item?.type === 'text').map((item) => item.text).join('\n').trim()
    : '';

  return {
    rawText,
    usage: payload?.usage
      ? {
          input_tokens: payload.usage.input_tokens || 0,
          output_tokens: payload.usage.output_tokens || 0,
          total_tokens: (payload.usage.input_tokens || 0) + (payload.usage.output_tokens || 0)
        }
      : { input_tokens: 0, output_tokens: 0, total_tokens: 0 },
    model: payload?.model || model
  };
}

async function callProvider(providerConfig, request) {
  const { provider, baseUrl, apiKey, model } = providerConfig;

  if (!provider || !model || !apiKey) {
    throw createAppError('BAD_REQUEST', 'Provider, model, and API key are required.', 400);
  }

  if (provider === 'custom') {
    return callOpenAIStyle({
      endpoint: baseUrl ? normalizeOpenAICompatibleBaseUrl(baseUrl) : normalizeOpenAIBaseUrl(baseUrl),
      apiKey,
      model,
      ...request
    });
  }

  if (provider === 'openai') {
    return callOpenAIStyle({
      endpoint: normalizeOpenAIBaseUrl(baseUrl),
      apiKey,
      model,
      ...request
    });
  }

  if (provider === 'anthropic') {
    return callAnthropic({
      endpoint: normalizeAnthropicBaseUrl(baseUrl),
      apiKey,
      model,
      ...request
    });
  }

  throw createAppError('BAD_REQUEST', 'Unsupported provider.', 400);
}

async function testProviderConnection(providerConfig) {
  const models = await listProviderModels(providerConfig);
  if (!models.length) {
    throw createAppError('PROVIDER_NO_MODELS', 'The API key is valid, but no models were returned.', 422);
  }

  return {
    status: 'connected',
    provider: providerConfig.provider,
    base_url: providerConfig.baseUrl || '',
    model: providerConfig.model || models[0],
    models
  };
}

async function generateIllustrationSvg(providerConfig, card) {
  const messages = buildIllustrationMessages(card);

  try {
    const response = await callProvider(providerConfig, {
      system: messages.system,
      user: messages.user,
      maxTokens: 1200
    });

    return response.rawText.includes('<svg') ? response.rawText : null;
  } catch {
    return null;
  }
}

async function generateWordCardWithAI(providerConfig, term) {
  if (!providerConfig?.provider || !providerConfig?.model || !providerConfig?.apiKey) {
    throw createAppError('BAD_REQUEST', 'Configure your AI connection in Settings before generating cards.', 400);
  }

  const messages = buildWordGenerationMessages(term);
  const response = await callProvider(providerConfig, {
    system: messages.system,
    user: messages.user,
    maxTokens: 2200,
    structured: providerConfig.provider !== 'anthropic'
  });

  const parsed = extractJsonText(response.rawText);
  const validation = validateWordCard(parsed);
  if (!validation.ok) {
    throw createAppError('INVALID_AI_RESPONSE', validation.error, 422);
  }

  const card = validation.value;
  const imageSvg = await generateIllustrationSvg(providerConfig, card);

  return {
    card: withGeneratedIllustration({ ...card, image_svg: imageSvg }),
    usage: response.usage,
    model: response.model,
    provider: providerConfig.provider
  };
}

module.exports = {
  mapProviderError,
  extractJsonText,
  normalizeOpenAICompatibleBaseUrl,
  listProviderModels,
  testProviderConnection,
  generateWordCardWithAI
};
