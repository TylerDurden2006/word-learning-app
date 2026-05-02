export const REVIEW_RATING_ORDER = ['Again', 'Hard', 'Good', 'Easy'];

export function createEmptyProviderForms() {
  return {
    active_provider: 'custom',
    providers: {
      custom: { model: '', api_key: '' },
      openai: { model: '', api_key: '' },
      anthropic: { model: '', api_key: '' }
    }
  };
}

export function clearSensitiveSettings(settingsForm) {
  const next = structuredClone(settingsForm);
  for (const provider of Object.values(next.providers || {})) {
    provider.api_key = '';
  }
  return next;
}

export function getNavMarker(isActive) {
  return isActive ? '*' : 'o';
}
