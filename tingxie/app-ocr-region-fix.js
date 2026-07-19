'use strict';

// Real phone photos produce uneven pinyin word heights. Keep a wide Latin-token
// range, then reject noisy handwritten rows by the quality and consistency of
// their lexicon matches.
extractPinyinRegions = function extractPinyinRegionsFromPhonePhoto(tsv, imageWidth, imageHeight) {
  const words = parseOcrTsv(tsv).filter(word => {
    const normalized = ocrNormalizePinyin(word.text);
    return normalized && word.confidence > 0 && word.top > imageHeight * 0.08 && word.top < imageHeight * 0.95;
  });
  if (!words.length) return [];

  const heights = words.map(word => word.height).filter(height => height > 5).sort((a, b) => a - b);
  const typicalHeight = heights[Math.floor(heights.length * 0.55)] || imageHeight * 0.055;
  const maximumHeight = Math.max(typicalHeight * 2.15, imageHeight * 0.09);
  const filtered = words.filter(word => word.height <= maximumHeight);

  const clusters = [];
  filtered.sort((a, b) => (a.top + a.height / 2) - (b.top + b.height / 2) || a.left - b.left).forEach(word => {
    const center = word.top + word.height / 2;
    let cluster = clusters.find(item => Math.abs(item.center - center) <= Math.max(18, typicalHeight * 0.8));
    if (!cluster) {
      cluster = { center, words: [] };
      clusters.push(cluster);
    }
    cluster.words.push(word);
    cluster.center = cluster.words.reduce((sum, item) => sum + item.top + item.height / 2, 0) / cluster.words.length;
  });

  const regions = [];
  clusters.sort((a, b) => a.center - b.center).forEach(cluster => {
    const row = cluster.words.sort((a, b) => a.left - b.left);
    const widths = row.map(word => word.width).sort((a, b) => a - b);
    const medianWidth = widths[Math.floor(widths.length / 2)] || 30;

    // Pinyin syllables inside one answer have a small normal-space gap, while
    // worksheet columns have a much larger gap. Cap the word-width influence so
    // long syllables do not accidentally merge several numbered answers.
    const splitGap = Math.max(imageWidth * 0.04, Math.min(medianWidth * 1.35, imageWidth * 0.075), typicalHeight * 2.2);
    let current = [];

    const flush = () => {
      if (!current.length) return;
      const raw = current.map(word => word.text).join(' ');
      const pinyin = ocrNormalizePinyin(raw);
      const syllables = pinyin ? pinyin.split(' ') : [];
      const alphabeticLength = pinyin.replace(/\s/g, '').length;
      if (syllables.length >= 1 && syllables.length <= 5 && alphabeticLength >= 3) {
        regions.push({
          raw,
          pinyin,
          key: ocrPinyinKey(pinyin),
          syllables,
          left: current[0].left,
          top: Math.min(...current.map(word => word.top)),
          right: Math.max(...current.map(word => word.left + word.width))
        });
      }
      current = [];
    };

    row.forEach(word => {
      const previous = current[current.length - 1];
      if (previous && word.left - (previous.left + previous.width) > splitGap) flush();
      current.push(word);
    });
    flush();
  });
  return regions;
};

function vocabularyOnlyChineseEvidence(texts) {
  const lines = [];
  (texts || []).forEach(text => String(text || '').split(/\r?\n/).forEach(line => {
    const hanCount = (line.match(/[\u3400-\u9fff]/g) || []).length;
    // Short worksheet rows are useful evidence for the first ten answers.
    // Exclude full sentences so words such as 读过 in sentence 12 cannot steal
    // an ambiguous pinyin match intended for 如果 in the vocabulary grid.
    if (hanCount >= 1 && hanCount <= 7) lines.push(line);
  }));
  return lines;
}

extractVocabFromPinyin = function extractReliableVocabRows(result) {
  const regions = extractPinyinRegions(result.pinyinTsv, result.pinyinWidth, result.pinyinHeight);
  const vocabularyEvidence = vocabularyOnlyChineseEvidence(result.chineseTexts);
  const matches = [];
  regions.forEach(region => {
    const match = bestLexiconMatch(region, result.lexicon, vocabularyEvidence);
    if (match) matches.push({ ...region, hanzi: match.entry.hanzi, score: match.score });
  });

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
    return uniqueWords.size >= 2 && averageScore <= 0.58;
  }).sort((a, b) => a.top - b.top);

  const ordered = [];
  reliableRows.forEach(group => {
    group.matches.sort((a, b) => a.left - b.left).forEach(match => {
      if (!ordered.some(item => item.hanzi === match.hanzi)) ordered.push(match);
    });
  });
  return ordered.slice(0, 20).map(item => item.hanzi);
};

window.__tingxieRegionFix = {
  extractPinyinRegions: (tsv, width, height) => extractPinyinRegions(tsv, width, height),
  extractVocabFromPinyin: result => extractVocabFromPinyin(result)
};
