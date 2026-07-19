'use strict';

const OCR_BASE_BEST_LEXICON_MATCH = bestLexiconMatch;

function trustedCuratedMatch(region, lexicon, chineseTexts) {
  let best = null;
  for (const entry of lexicon || []) {
    if ((entry.priority || 1) < 3) continue;
    if (entry.syllables?.length !== region.syllables?.length) continue;

    const distance = ocrEditDistance(region.key, entry.key) / Math.max(region.key.length, entry.key.length, 1);
    if (distance > 0.62) continue;

    const evidence = chineseEvidenceScore(entry.hanzi, chineseTexts);
    const score = distance - evidence - (entry.priority || 1) * 0.012;
    if (!best || score < best.score) best = { entry, score, distance, evidence };
  }
  return best;
}

// The broad Higher Chinese helper files improve recall, but a severe phone-OCR
// vowel error can make a less suitable general-dictionary word win before the
// curated worksheet word is considered. Always evaluate the small curated set
// as a tie-break, rather than using it only when the broad matcher returns null.
bestLexiconMatch = function bestLexiconMatchWithTrustedFallback(region, lexicon, chineseTexts) {
  const normalMatch = OCR_BASE_BEST_LEXICON_MATCH(region, lexicon, chineseTexts);
  const trustedMatch = trustedCuratedMatch(region, lexicon, chineseTexts);

  if (!trustedMatch) return normalMatch;
  if (!normalMatch) return trustedMatch;

  // An exact Chinese hit in a numbered vocabulary row is strong evidence. This
  // safely recovers cases such as "zi wii" → 组屋 while sentence text is excluded
  // from the evidence pool by app-ocr-evidence-fix.js.
  if (trustedMatch.evidence >= 0.27 && trustedMatch.distance <= 0.62) return trustedMatch;

  // Otherwise prefer the curated result only when it is clearly better after
  // the same distance/evidence scoring used by the normal matcher.
  if (trustedMatch.score + 0.08 < normalMatch.score) return trustedMatch;
  return normalMatch;
};

window.__tingxieTrustedFallback = {
  trustedCuratedMatch,
  bestLexiconMatch: (region, lexicon, texts) => bestLexiconMatch(region, lexicon, texts)
};
