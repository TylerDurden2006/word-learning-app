const { createAppError, normalizeText, uniqueStrings } = require('./shared');

function extractGoogleDocId(input) {
  const value = String(input || '').trim();
  if (!value) {
    throw createAppError('BAD_REQUEST', 'Google Docs URL is required.', 400);
  }

  const match = value.match(/\/document\/d\/([a-zA-Z0-9_-]+)/);
  if (!match) {
    throw createAppError('BAD_REQUEST', 'Enter a valid Google Docs document URL.', 400);
  }

  return match[1];
}

function sanitizeImportedLine(line) {
  return String(line || '')
    .replace(/^[\s>*-]+/, '')
    .replace(/^\d+[\.\)]\s*/, '')
    .trim();
}

function splitCandidateLine(line) {
  const clean = sanitizeImportedLine(line);
  if (!clean) return [];

  if (clean.includes(',') && clean.split(',').every((part) => part.trim().split(/\s+/).length <= 4)) {
    return clean.split(',').map((part) => part.trim());
  }

  if (clean.includes(';') && clean.split(';').every((part) => part.trim().split(/\s+/).length <= 4)) {
    return clean.split(';').map((part) => part.trim());
  }

  return [clean];
}

function extractWordsFromText(text, limit = 25) {
  const rawLines = String(text || '').split(/\r?\n/);
  const candidates = [];

  for (const line of rawLines) {
    for (const item of splitCandidateLine(line)) {
      const trimmed = item.trim();
      if (!trimmed) continue;
      if (trimmed.split(/\s+/).length > 6) continue;
      if (normalizeText(trimmed).length < 2) continue;
      candidates.push(trimmed);
      if (candidates.length >= limit * 2) break;
    }
    if (candidates.length >= limit * 2) break;
  }

  return uniqueStrings(candidates, limit);
}

function mapGoogleDocImportError(status) {
  if (status === 401) {
    return createAppError('GOOGLE_DOC_AUTH_EXPIRED', 'Google authorization expired. Sign in with Google again and retry the import.', 401);
  }

  if (status === 403) {
    return createAppError('GOOGLE_DOC_PERMISSION_DENIED', 'Google denied access to that document. Make sure the selected account can read it.', 403);
  }

  if (status === 404) {
    return createAppError('GOOGLE_DOC_NOT_FOUND', 'That Google Doc could not be found.', 404);
  }

  return createAppError(
    'GOOGLE_DOC_IMPORT_FAILED',
    'Unable to read that Google Doc right now. Please try again in a moment.',
    status || 502
  );
}

async function fetchGoogleDocText(docUrl, accessToken) {
  const docId = extractGoogleDocId(docUrl);
  const token = String(accessToken || '').trim();
  if (!token) {
    throw createAppError('GOOGLE_OAUTH_REQUIRED', 'Authorize Google Docs access before starting the import.', 400);
  }

  const exportUrl = `https://www.googleapis.com/drive/v3/files/${docId}/export?mimeType=${encodeURIComponent('text/plain')}`;
  const response = await fetch(exportUrl, {
    headers: {
      authorization: `Bearer ${token}`
    },
    redirect: 'follow',
    signal: AbortSignal.timeout(30000)
  });

  if (!response.ok) {
    throw mapGoogleDocImportError(response.status);
  }

  return response.text();
}

module.exports = {
  extractGoogleDocId,
  extractWordsFromText,
  fetchGoogleDocText,
  mapGoogleDocImportError
};
