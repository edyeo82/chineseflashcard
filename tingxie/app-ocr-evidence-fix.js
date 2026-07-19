'use strict';

function vocabularyEvidenceText(texts) {
  const lines = [];
  (texts || []).forEach(text => {
    String(text || '').split(/\r?\n/).forEach(line => {
      const trimmed = line.trim();
      const hanCount = (trimmed.match(/[\u3400-\u9fff]/g) || []).length;
      const numberedMarkers = trimmed.match(/(?:^|\s)\d{1,2}\s*[.、:：)）]/g) || [];
      const isSentenceNumber = /^(?:11|12)\s*[.、:：)）]/.test(trimmed);
      const isMoxie = /^(?:默写|默寫)/.test(trimmed);
      const hasSentencePunctuation = /[，,。！？；;]/.test(trimmed);
      if (isSentenceNumber || isMoxie) return;

      const isVocabularyRow = numberedMarkers.length >= 2 || (hanCount >= 1 && hanCount <= 7 && !hasSentencePunctuation);
      if (isVocabularyRow) lines.push(trimmed);
    });
  });
  return lines;
}

function numberedVocabularyHints(texts) {
  const hints = new Map();
  (texts || []).forEach(text => {
    String(text || '').split(/\r?\n/).forEach(line => {
      const matches = line.matchAll(/(?:^|\s)(\d{1,2})\s*[.、:：)）-]?\s*([\u3400-\u9fff]{1,7})/g);
      for (const match of matches) {
        const number = Number(match[1]);
        if (number >= 1 && number <= 10 && !hints.has(number)) hints.set(number, match[2]);
      }
    });
  });
  return hints;
}

chineseEvidenceScore = function vocabularyOnlyChineseEvidence(hanzi, texts) {
  const normalized = normalizeChinese(hanzi);
  const vocabularyLines = vocabularyEvidenceText(texts);
  const joined = vocabularyLines.map(line => normalizeChinese(line)).join('|');
  if (!joined) return 0;
  if (joined.includes(normalized)) return 0.28;
  const chars = Array.from(normalized);
  return chars.filter(char => joined.includes(char)).length / Math.max(chars.length, 1) * 0.09;
};

function plainPinyinRegions(text) {
  const regions = [];
  String(text || '').split(/\r?\n/).forEach((line, rowIndex) => {
    const chunks = line.trim().split(/\s{2,}|\t+/).map(chunk => chunk.trim()).filter(Boolean);
    if (chunks.length < 2) return;
    chunks.forEach((chunk, columnIndex) => {
      const pinyin = ocrNormalizePinyin(chunk);
      const syllables = pinyin ? pinyin.split(' ') : [];
      if (syllables.length < 1 || syllables.length > 5 || pinyin.replace(/\s/g, '').length < 3) return;
      regions.push({
        raw: chunk,
        pinyin,
        key: ocrPinyinKey(pinyin),
        syllables,
        left: columnIndex * 400,
        right: columnIndex * 400 + 250,
        top: rowIndex * 180
      });
    });
  });
  return regions;
}

function matchVocabularyRegions(regions, result) {
  const hints = numberedVocabularyHints(result.chineseTexts);
  const sorted = regions.slice().sort((a, b) => a.top - b.top || a.left - b.left);
  const matches = [];
  sorted.forEach((region, index) => {
    const hint = hints.get(index + 1);
    const evidenceTexts = hint ? [hint] : result.chineseTexts;
    const match = bestLexiconMatch(region, result.lexicon, evidenceTexts);
    if (match) matches.push({ ...region, hanzi: match.entry.hanzi, score: match.score, distance: match.distance, ordinal: index + 1 });
  });
  return matches;
}

function reliableOrderedMatches(matches, result) {
  const rowGroups = [];
  matches.sort((a, b) => a.top - b.top || a.left - b.left).forEach(match => {
    let group = rowGroups.find(item => Math.abs(item.top - match.top) <= Math.max(35, result.pinyinHeight * 0.065));
    if (!group) {
      group = { top: match.top, matches: [] };
      rowGroups.push(group);
    }
    group.matches.push(match);
    group.top = group.matches.reduce((sum, item) => sum + item.top, 0) / group.matches.length;
  });

  const reliableRows = rowGroups.filter(group => {
    const uniqueWords = new Set(group.matches.map(match => match.hanzi));
    const averageScore = group.matches.reduce((sum, match) => sum + match.score, 0) / Math.max(group.matches.length, 1);
    const highConfidenceCount = group.matches.filter(match => match.score <= 0.2 || match.distance <= 0.18).length;
    return (uniqueWords.size >= 2 && averageScore <= 0.45) || highConfidenceCount >= 1;
  }).sort((a, b) => a.top - b.top);

  const ordered = [];
  reliableRows.forEach(group => {
    group.matches.sort((a, b) => a.left - b.left).forEach(match => {
      if (!ordered.some(item => item.hanzi === match.hanzi)) ordered.push(match);
    });
  });
  return ordered;
}

extractVocabFromPinyin = function extractReliableVocabularyWithFallback(result) {
  const tsvRegions = extractPinyinRegions(result.pinyinTsv, result.pinyinWidth, result.pinyinHeight);
  const tsvOrdered = reliableOrderedMatches(matchVocabularyRegions(tsvRegions, result), result);

  const textRegions = plainPinyinRegions(result.pinyinText);
  const textMatches = matchVocabularyRegions(textRegions, result)
    .filter(match => match.score <= 0.5 || match.distance <= 0.48)
    .sort((a, b) => a.ordinal - b.ordinal);
  const textOrdered = [];
  textMatches.forEach(match => {
    if (!textOrdered.some(item => item.hanzi === match.hanzi)) textOrdered.push(match);
  });

  const primary = textOrdered.length > tsvOrdered.length ? textOrdered : tsvOrdered;
  const secondary = primary === textOrdered ? tsvOrdered : textOrdered;
  const combined = primary.slice();
  secondary.forEach(match => {
    if (!combined.some(item => item.hanzi === match.hanzi)) combined.push(match);
  });

  return combined.slice(0, 20).map(item => item.hanzi);
};

extractSentenceItems = function extractOnlyActualSentences(chineseTexts) {
  const candidates = [];
  chineseTexts.forEach((text, passIndex) => {
    String(text || '').split(/\r?\n/).forEach((line, lineIndex) => {
      const numberedMarkers = line.match(/(?:^|\s)\d{1,2}\s*[.、:：)）]/g) || [];
      if (numberedMarkers.length >= 2) return;

      const cleaned = cleanSentenceLine(line);
      const hanziCount = (cleaned.match(/[\u3400-\u9fff]/g) || []).length;
      if (hanziCount < 8 || hanziCount > 40 || /^(听写|聽寫)/.test(cleaned)) return;

      const explicitlyNumberedSentence = /(?:^|\D)(?:11|12)(?:\D|$)/.test(line);
      const isMoxie = /默写|默寫/.test(line);
      const hadSentencePunctuation = /[，。！？]/.test(line);
      if (!explicitlyNumberedSentence && !isMoxie && !hadSentencePunctuation) return;

      const orderHint = /(?:^|\D)11(?:\D|$)/.test(line)
        ? 11
        : /(?:^|\D)12(?:\D|$)/.test(line)
          ? 12
          : isMoxie
            ? 13
            : 100 + lineIndex;
      candidates.push({ text: cleaned, passIndex, lineIndex, hanziCount, orderHint });
    });
  });

  const pinyinLines = extractLongPinyinLines(chineseTexts);
  const clusters = [];
  candidates.forEach(candidate => {
    const key = normalizeChinese(candidate.text);
    let cluster = clusters.find(item => ocrSimilarity(item.key, key) >= 0.58);
    if (!cluster) {
      cluster = { key, candidates: [], firstOrder: candidate.orderHint };
      clusters.push(cluster);
    }
    cluster.candidates.push(candidate);
    cluster.firstOrder = Math.min(cluster.firstOrder, candidate.orderHint);
  });

  clusters.sort((a, b) => a.firstOrder - b.firstOrder);
  const selected = clusters.map((cluster, index) => {
    const expected = pinyinLines[index]?.length || 0;
    return cluster.candidates.reduce((best, candidate) => {
      const score = sentenceQuality(candidate.text, expected);
      return !best || score > best.score ? { text: candidate.text, score } : best;
    }, null)?.text;
  }).filter(Boolean);

  return uniqueItems(selected).slice(0, 5);
};

window.__tingxieEvidenceFix = {
  vocabularyEvidenceText,
  numberedVocabularyHints,
  plainPinyinRegions,
  chineseEvidenceScore: (hanzi, texts) => chineseEvidenceScore(hanzi, texts),
  extractVocabFromPinyin: result => extractVocabFromPinyin(result),
  extractSentenceItems: texts => extractSentenceItems(texts)
};
