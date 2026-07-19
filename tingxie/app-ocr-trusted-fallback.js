'use strict';

const OCR_BASE_BEST_LEXICON_MATCH = bestLexiconMatch;

function trustedPinyinVariants(region) {
  const variants = new Set([region.key]);
  const correctedTokens = (region.syllables || []).map(token => {
    if (/^z[i1l]$/.test(token)) return 'zu';
    if (/^w[i1l]{1,2}$/.test(token)) return 'wu';
    return token;
  });
  variants.add(correctedTokens.join(''));
  return Array.from(variants);
}

function trustedCuratedMatch(region, lexicon, chineseTexts) {
  const variants = trustedPinyinVariants(region);
  let best = null;
  for (const entry of lexicon || []) {
    if ((entry.priority || 1) < 3) continue;
    if (entry.syllables?.length !== region.syllables?.length) continue;

    const distance = Math.min(...variants.map(key => ocrEditDistance(key, entry.key) / Math.max(key.length, entry.key.length, 1)));
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
// as a tie-break, including safe OCR vowel variants such as "zi wii" → zǔ wū.
bestLexiconMatch = function bestLexiconMatchWithTrustedFallback(region, lexicon, chineseTexts) {
  let normalMatch = null;
  for (const key of trustedPinyinVariants(region)) {
    const candidateRegion = key === region.key ? region : { ...region, key };
    const candidate = OCR_BASE_BEST_LEXICON_MATCH(candidateRegion, lexicon, chineseTexts);
    if (candidate && (!normalMatch || candidate.score < normalMatch.score)) normalMatch = candidate;
  }
  const trustedMatch = trustedCuratedMatch(region, lexicon, chineseTexts);

  if (!trustedMatch) return normalMatch;
  if (!normalMatch) return trustedMatch;

  if (trustedMatch.evidence >= 0.27 && trustedMatch.distance <= 0.62) return trustedMatch;
  if (trustedMatch.score + 0.08 < normalMatch.score) return trustedMatch;
  return normalMatch;
};

window.__tingxieTrustedFallback = {
  trustedPinyinVariants,
  trustedCuratedMatch,
  bestLexiconMatch: (region, lexicon, texts) => bestLexiconMatch(region, lexicon, texts)
};
