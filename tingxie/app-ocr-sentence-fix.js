'use strict';

const OCR_EXTRACT_ITEMS_BEFORE_SENTENCE_FIX = extractItems;

function sentenceHanPositions(text) {
  const positions = [];
  Array.from(String(text || '')).forEach((character, index) => {
    if (/[\u3400-\u9fff]/.test(character)) positions.push({ character, index });
  });
  return positions;
}

function sentenceCharacterOverlap(left, right) {
  const a = Array.from(String(left || ''));
  const b = Array.from(String(right || ''));
  let shared = 0;
  const remaining = b.slice();
  a.forEach(character => {
    const index = remaining.indexOf(character);
    if (index >= 0) {
      shared += 1;
      remaining.splice(index, 1);
    }
  });
  return shared / Math.max(a.length, b.length, 1);
}

function correctSentenceUsingPinyin(sentence, syllables, lexicon) {
  const positions = sentenceHanPositions(sentence);
  if (!positions.length || !syllables?.length || positions.length !== syllables.length) return sentence;

  const candidates = [];
  const entries = (lexicon || []).filter(entry => {
    const length = Array.from(entry.hanzi || '').length;
    return length >= 2 && length <= 5 && entry.syllables?.length === length;
  });

  for (const entry of entries) {
    const length = entry.syllables.length;
    for (let start = 0; start <= syllables.length - length; start += 1) {
      const spokenKey = ocrPinyinKey(syllables.slice(start, start + length).join(' '));
      const pinyinScore = ocrSimilarity(spokenKey, entry.key);
      if (pinyinScore < 0.84) continue;

      const written = positions.slice(start, start + length).map(item => item.character).join('');
      if (written === entry.hanzi) continue;
      const overlap = sentenceCharacterOverlap(written, entry.hanzi);
      if (overlap < 0.5) continue;
      if ((entry.priority || 1) < 2 && pinyinScore < 0.95) continue;

      candidates.push({
        start,
        length,
        replacement: entry.hanzi,
        score: pinyinScore + overlap * 0.28 + (entry.priority || 1) * 0.025
      });
    }
  }

  const selected = [];
  candidates.sort((left, right) => right.score - left.score).forEach(candidate => {
    const overlaps = selected.some(existing => candidate.start < existing.start + existing.length && existing.start < candidate.start + candidate.length);
    if (!overlaps) selected.push(candidate);
  });
  if (!selected.length) return sentence;

  const characters = Array.from(sentence);
  selected.sort((left, right) => left.start - right.start).forEach(candidate => {
    Array.from(candidate.replacement).forEach((character, offset) => {
      const target = positions[candidate.start + offset];
      if (target) characters[target.index] = character;
    });
  });
  return characters.join('');
}

function looksLikeNaturalSentence(item) {
  const hanCount = sentenceHanPositions(item).length;
  if (hanCount < 8) return true;
  if (/[，！？；]/.test(item)) return true;

  // OCR may concatenate a whole numbered vocabulary row into an 8–10 character
  // string. Genuine school spelling sentences normally contain pronouns,
  // particles or verb constructions; the concatenated grids do not.
  return /(我|我们|妈妈|的|是|不|可以|都会|认为|开着|睡觉|读过|购物|时候|时)/.test(item);
}

extractItems = function extractItemsWithSentencePinyinFix(input) {
  const items = OCR_EXTRACT_ITEMS_BEFORE_SENTENCE_FIX(input);
  if (!input || typeof input === 'string' || input.kind !== 'tingxie-source-ocr-v2') return items;

  const filteredItems = items.filter(looksLikeNaturalSentence);
  const longPinyinLines = extractLongPinyinLines(input.chineseTexts).filter(syllables => syllables.length >= 10);
  let sentenceIndex = 0;
  return filteredItems.map(item => {
    const hanCount = sentenceHanPositions(item).length;
    if (hanCount < 8) return item;
    const syllables = longPinyinLines[sentenceIndex] || null;
    sentenceIndex += 1;
    return correctSentenceUsingPinyin(item, syllables, input.lexicon);
  });
};

window.__tingxieSentenceFix = {
  correctSentenceUsingPinyin,
  looksLikeNaturalSentence,
  extractItems: input => extractItems(input)
};
