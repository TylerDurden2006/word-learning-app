function buildConvexSnapshot(raw, shared) {
  const source = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
  const profile = shared.normalizeProfile
    ? shared.normalizeProfile(source.profile)
    : { ...shared.DEFAULT_PROFILE, ...(source.profile || {}), accent: 'American English' };

  const words = Array.isArray(source.words)
    ? source.words.filter((word) => {
        if (!word || typeof word !== 'object' || !word.id) return false;
        const validation = shared.validateWordCard(word);
        return validation.ok;
      })
    : [];

  return {
    profile,
    words,
    review_events: Array.isArray(source.review_events) ? source.review_events.filter((event) => event?.id) : []
  };
}

module.exports = { buildConvexSnapshot };
