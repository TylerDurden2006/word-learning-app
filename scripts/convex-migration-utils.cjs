function buildConvexSnapshot(raw, shared) {
  const source = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
  const profile = source.profile && typeof source.profile === 'object'
    ? { ...shared.DEFAULT_PROFILE, ...source.profile, accent: 'American English' }
    : { ...shared.DEFAULT_PROFILE };

  const words = Array.isArray(source.words)
    ? source.words.filter((word) => {
        if (!word || typeof word !== 'object' || !word.id) return false;
        const validation = shared.validateWordCard(word);
        return validation.ok;
      })
    : [];

  return {
    settings: shared.normalizeSettings(source.settings),
    profile,
    words,
    review_events: Array.isArray(source.review_events) ? source.review_events.filter((event) => event?.id) : [],
    imports: Array.isArray(source.imports) ? source.imports.filter((item) => item?.id) : []
  };
}

module.exports = { buildConvexSnapshot };
