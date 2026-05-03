export const REVIEW_RATING_ORDER = ['Again', 'Hard', 'Good', 'Easy'];

export function createEmptyWordEditor() {
  return {
    term: '',
    definition: '',
    nuances: '',
    phonetics_us: '',
    part_of_speech: '',
    synonyms_text: '',
    antonyms_text: '',
    examples_text: '',
    visual_cue: '',
    image_asset: ''
  };
}

export function splitCommaList(value) {
  const seen = new Set();
  return String(value || '')
    .split(',')
    .map((item) => item.trim())
    .filter((item) => {
      const key = item.toLowerCase();
      if (!key || seen.has(key)) return false;
      seen.add(key);
      return true;
    });
}

export function splitExampleList(value) {
  return String(value || '')
    .split(/\r?\n/)
    .map((item) => item.trim())
    .filter(Boolean);
}

export function getNavMarker(isActive) {
  return isActive ? '*' : 'o';
}
