'use strict';

const OCR_BASE_BEST_LEXICON_MATCH = bestLexiconMatch;

// The Higher Chinese built-in words are curated and receive priority 3. Allow a
// controlled fallback for severe but common phone-OCR vowel confusions such as
// "zi wii" for zǔ wū. This only applies when the syllable count is exact and the
// normalized edit distance remains within 0.62.
bestLexiconMatch = function bestLexiconMatchWithTrustedFallback(region, lexicon, chineseTexts) {
  const normalMatch = OCR_BASE_BEST_LEXICON_MATCH(region, lexicon, chineseTexts);
  if (normalMatch) return normalMatch;

  let best = null;
  for (const entry of lexicon || []) {
    if ((entry.priority || 1) < 3) continue;
    if (entry.syllables?.length !== region.syllables?.length) continue;
    const distance = ocrEditDistance(region.key, entry.key) / Math.max(region.key.length, entry.key.length, 1);
    if (distance > 0.62) continue;
    const evidence = chineseEvidenceScore(entry.hanzi, chineseTexts);
    const score = distance - evidence - (entry.priority || 1) * 0.012;
    if (!best || score < best.score) best = { entry, score, distance };
  }
  return best;
};

window.__tingxieTrustedFallback = {
  bestLexiconMatch: (region, lexicon, texts) => bestLexiconMatch(region, lexicon, texts)
};
