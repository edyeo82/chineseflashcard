'use strict';

const LEGACY_EXTRACT_ITEMS = extractItems;
const LEGACY_RUN_OCR = runOcr;

const OCR_LEXICON_URLS = [
  '../hcl-words/helpers.json',
  '../hcl-words/helpers-extra.json',
  '../hcl-words/helpers-metadata-clean-a.json',
  '../hcl-words/helpers-metadata-clean-b.json',
  '../hcl-words/helpers-metadata-clean-c.json',
  '../hcl-words/helpers-metadata-clean-d.json',
  '../hcl-words/helpers-metadata-clean-e.json',
  '../hcl-words/helpers-coverage.json'
];

const OCR_BUILTIN_LEXICON = [
  ['浪费', 'làng fèi'], ['组屋', 'zǔ wū'], ['所以', 'suǒ yǐ'], ['如果', 'rú guǒ'],
  ['车辆', 'chē liàng'], ['一份', 'yí fèn'], ['尽力', 'jìn lì'], ['超市', 'chāo shì'],
  ['日用品', 'rì yòng pǐn'], ['停车场', 'tíng chē chǎng'],
  ['认为', 'rèn wéi'], ['开着', 'kāi zhe'], ['睡觉', 'shuì jiào'], ['不对', 'bú duì'],
  ['读过', 'dú guò'], ['报纸', 'bào zhǐ'], ['我们', 'wǒ men'], ['可以', 'kě yǐ'],
  ['废物利用', 'fèi wù lì yòng'], ['妈妈', 'mā ma'], ['购物', 'gòu wù'], ['都会', 'dōu huì'],
  ['环保袋', 'huán bǎo dài'], ['装东西', 'zhuāng dōng xi'], ['东西', 'dōng xi']
];

let ocrLexiconPromise = null;
let ocrLexiconEntries = [];
let accurateSourceWorker = null;
let accurateSourceWorkerPromise = null;

async function getAccurateSourceWorker(prefix) {
  if (accurateSourceWorker) return accurateSourceWorker;
  if (accurateSourceWorkerPromise) return accurateSourceWorkerPromise;
  accurateSourceWorkerPromise = (async () => {
    const TesseractApi = await ensureTesseract(prefix);
    setOcrMessage(prefix, 'Loading the high-accuracy Chinese model…', 4);
    const worker = await withTimeout(
      TesseractApi.createWorker(['chi_sim', 'eng'], 1, {
        workerPath: 'https://cdn.jsdelivr.net/npm/tesseract.js@5/dist/worker.min.js',
        corePath: 'https://cdn.jsdelivr.net/npm/tesseract.js-core@5',
        langPath: 'https://tessdata.projectnaptha.com/4.0.0_best',
        logger: payload => setOcrProgress(prefix, payload),
        errorHandler: error => console.error('High-accuracy Ting Xie OCR worker error', error)
      }),
      90000,
      'The high-accuracy OCR model took too long to start.'
    );
    accurateSourceWorker = worker;
    return worker;
  })();
  try {
    return await accurateSourceWorkerPromise;
  } catch (error) {
    accurateSourceWorker = null;
    accurateSourceWorkerPromise = null;
    throw error;
  }
}

function ocrNormalizePinyin(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/ü/g, 'u')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[0-5]/g, '')
    .replace(/[^a-z]+/g, ' ')
    .trim()
    .replace(/\s+/g, ' ');
}

function ocrPinyinKey(value) {
  return ocrNormalizePinyin(value).replace(/\s/g, '');
}

function ocrEditDistance(left, right) {
  const a = Array.from(String(left || ''));
  const b = Array.from(String(right || ''));
  const previous = Array.from({ length: b.length + 1 }, (_, index) => index);
  for (let i = 1; i <= a.length; i += 1) {
    const current = [i];
    for (let j = 1; j <= b.length; j += 1) {
      current[j] = Math.min(current[j - 1] + 1, previous[j] + 1, previous[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
    for (let j = 0; j < current.length; j += 1) previous[j] = current[j];
  }
  return previous[b.length];
}

function ocrSimilarity(left, right) {
  const a = String(left || '');
  const b = String(right || '');
  if (!a && !b) return 1;
  return 1 - ocrEditDistance(a, b) / Math.max(a.length, b.length, 1);
}

function collectOcrLexicon(value, entries, priority = 1) {
  if (!value) return;
  if (Array.isArray(value)) {
    if (value.length >= 2 && typeof value[0] === 'string' && typeof value[1] === 'string' && /[\u3400-\u9fff]/.test(value[0]) && /[A-Za-zāáǎàēéěèīíǐìōóǒòūúǔùǖǘǚǜü]/.test(value[1])) {
      entries.push({ hanzi: value[0].trim(), pinyin: value[1].trim(), priority });
      return;
    }
    value.forEach(item => collectOcrLexicon(item, entries, priority));
    return;
  }
  if (typeof value !== 'object') return;
  const hanzi = value.hanzi || value.word || value.text || value.chars || value.phrase;
  const pinyin = value.pinyin || value.py || value.pronunciation;
  if (typeof hanzi === 'string' && typeof pinyin === 'string' && /[\u3400-\u9fff]/.test(hanzi)) entries.push({ hanzi: hanzi.trim(), pinyin: pinyin.trim(), priority });
}

async function loadOcrLexicon() {
  if (ocrLexiconEntries.length) return ocrLexiconEntries;
  if (ocrLexiconPromise) return ocrLexiconPromise;
  ocrLexiconPromise = (async () => {
    const rawEntries = [];
    OCR_BUILTIN_LEXICON.forEach(entry => rawEntries.push({ hanzi: entry[0], pinyin: entry[1], priority: 3 }));
    const results = await Promise.allSettled(OCR_LEXICON_URLS.map(async url => {
      const response = await fetch(url, { cache: 'force-cache' });
      if (!response.ok) throw new Error(`Lexicon download failed: ${response.status}`);
      return response.json();
    }));
    results.forEach(result => { if (result.status === 'fulfilled') collectOcrLexicon(result.value, rawEntries, 1); });
    const seen = new Set();
    ocrLexiconEntries = rawEntries.map(entry => {
      const hanzi = String(entry.hanzi || '').replace(/\s+/g, '').trim();
      const pinyin = ocrNormalizePinyin(entry.pinyin);
      return { hanzi, pinyin, key: ocrPinyinKey(pinyin), syllables: pinyin ? pinyin.split(' ') : [], priority: entry.priority || 1 };
    }).filter(entry => {
      if (!entry.hanzi || !entry.key || entry.hanzi.length > 14) return false;
      const id = `${entry.hanzi}|${entry.key}`;
      if (seen.has(id)) return false;
      seen.add(id);
      return true;
    });
    return ocrLexiconEntries;
  })();
  return ocrLexiconPromise;
}

function loadBitmap(file) {
  if (window.createImageBitmap) return createImageBitmap(file);
  return new Promise((resolve, reject) => {
    const image = new Image();
    const url = URL.createObjectURL(file);
    image.onload = () => { URL.revokeObjectURL(url); resolve(image); };
    image.onerror = () => { URL.revokeObjectURL(url); reject(new Error('The selected photo could not be opened.')); };
    image.src = url;
  });
}

function findWorksheetBounds(imageData, width, height) {
  const rowCounts = new Uint32Array(height);
  const colCounts = new Uint32Array(width);
  const data = imageData.data;
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const index = (y * width + x) * 4;
      const gray = (data[index] * 77 + data[index + 1] * 150 + data[index + 2] * 29) >> 8;
      if (gray < 165) { rowCounts[y] += 1; colCounts[x] += 1; }
    }
  }
  const startSearchY = Math.floor(height * 0.08);
  const borderRowThreshold = width * 0.22;
  let top = -1;
  let bottom = -1;
  for (let y = startSearchY; y < height; y += 1) { if (rowCounts[y] > borderRowThreshold) { top = y; break; } }
  for (let y = height - 1; y > startSearchY; y -= 1) { if (rowCounts[y] > borderRowThreshold) { bottom = y; break; } }
  if (top < 0 || bottom <= top + height * 0.2) {
    const contentThreshold = Math.max(4, width * 0.008);
    for (let y = startSearchY; y < height; y += 1) { if (rowCounts[y] > contentThreshold) { top = y; break; } }
    for (let y = height - 1; y > startSearchY; y -= 1) { if (rowCounts[y] > contentThreshold) { bottom = y; break; } }
  }
  const usableHeight = Math.max(1, bottom - top);
  const borderColThreshold = usableHeight * 0.28;
  let left = -1;
  let right = -1;
  for (let x = 0; x < width; x += 1) { if (colCounts[x] > borderColThreshold) { left = x; break; } }
  for (let x = width - 1; x >= 0; x -= 1) { if (colCounts[x] > borderColThreshold) { right = x; break; } }
  if (left < 0 || right <= left + width * 0.3) {
    const contentThreshold = Math.max(4, usableHeight * 0.01);
    for (let x = 0; x < width; x += 1) { if (colCounts[x] > contentThreshold) { left = x; break; } }
    for (let x = width - 1; x >= 0; x -= 1) { if (colCounts[x] > contentThreshold) { right = x; break; } }
  }
  if (top < 0 || bottom < 0 || left < 0 || right < 0) return { left: 0, top: 0, width, height };
  const marginX = Math.round((right - left) * 0.015);
  const marginY = Math.round((bottom - top) * 0.02);
  left = Math.max(0, left - marginX); top = Math.max(0, top - marginY);
  right = Math.min(width - 1, right + marginX); bottom = Math.min(height - 1, bottom + marginY);
  return { left, top, width: right - left + 1, height: bottom - top + 1 };
}

function adaptiveThresholdCanvas(sourceCanvas) {
  const width = sourceCanvas.width;
  const height = sourceCanvas.height;
  const sourceContext = sourceCanvas.getContext('2d', { willReadFrequently: true });
  const imageData = sourceContext.getImageData(0, 0, width, height);
  const gray = new Uint8Array(width * height);
  const integral = new Uint32Array((width + 1) * (height + 1));
  for (let y = 0; y < height; y += 1) {
    let rowSum = 0;
    for (let x = 0; x < width; x += 1) {
      const sourceIndex = (y * width + x) * 4;
      const value = (imageData.data[sourceIndex] * 77 + imageData.data[sourceIndex + 1] * 150 + imageData.data[sourceIndex + 2] * 29) >> 8;
      gray[y * width + x] = value;
      rowSum += value;
      integral[(y + 1) * (width + 1) + x + 1] = integral[y * (width + 1) + x + 1] + rowSum;
    }
  }
  const output = new ImageData(width, height);
  const radius = Math.max(12, Math.round(width / 55));
  const offset = 13;
  for (let y = 0; y < height; y += 1) {
    const y1 = Math.max(0, y - radius);
    const y2 = Math.min(height - 1, y + radius);
    for (let x = 0; x < width; x += 1) {
      const x1 = Math.max(0, x - radius);
      const x2 = Math.min(width - 1, x + radius);
      const area = (x2 - x1 + 1) * (y2 - y1 + 1);
      const sum = integral[(y2 + 1) * (width + 1) + x2 + 1] - integral[y1 * (width + 1) + x2 + 1] - integral[(y2 + 1) * (width + 1) + x1] + integral[y1 * (width + 1) + x1];
      const value = gray[y * width + x] < sum / area - offset ? 0 : 255;
      const outputIndex = (y * width + x) * 4;
      output.data[outputIndex] = value; output.data[outputIndex + 1] = value; output.data[outputIndex + 2] = value; output.data[outputIndex + 3] = 255;
    }
  }
  const canvas = document.createElement('canvas');
  canvas.width = width; canvas.height = height;
  canvas.getContext('2d').putImageData(output, 0, 0);
  return canvas;
}

async function prepareSourceOcrImages(file) {
  const bitmap = await loadBitmap(file);
  const naturalWidth = bitmap.width || bitmap.naturalWidth;
  const naturalHeight = bitmap.height || bitmap.naturalHeight;
  const sampleScale = Math.min(1, 1500 / Math.max(naturalWidth, naturalHeight));
  const sample = document.createElement('canvas');
  sample.width = Math.max(1, Math.round(naturalWidth * sampleScale));
  sample.height = Math.max(1, Math.round(naturalHeight * sampleScale));
  const sampleContext = sample.getContext('2d', { alpha: false, willReadFrequently: true });
  sampleContext.fillStyle = '#fff'; sampleContext.fillRect(0, 0, sample.width, sample.height);
  sampleContext.drawImage(bitmap, 0, 0, sample.width, sample.height);
  const bounds = findWorksheetBounds(sampleContext.getImageData(0, 0, sample.width, sample.height), sample.width, sample.height);
  const targetWidth = 1800;
  const scale = targetWidth / bounds.width;
  const page = document.createElement('canvas');
  page.width = targetWidth; page.height = Math.max(1, Math.round(bounds.height * scale));
  const pageContext = page.getContext('2d', { alpha: false });
  pageContext.fillStyle = '#fff'; pageContext.fillRect(0, 0, page.width, page.height);
  pageContext.imageSmoothingEnabled = true; pageContext.imageSmoothingQuality = 'high';
  pageContext.drawImage(sample, bounds.left, bounds.top, bounds.width, bounds.height, 0, 0, page.width, page.height);
  const threshold = adaptiveThresholdCanvas(page);
  const pinyin = document.createElement('canvas');
  pinyin.width = page.width; pinyin.height = Math.max(1, Math.round(page.height * 0.52));
  const pinyinContext = pinyin.getContext('2d', { alpha: false });
  pinyinContext.fillStyle = '#fff'; pinyinContext.fillRect(0, 0, pinyin.width, pinyin.height);
  pinyinContext.drawImage(page, 0, Math.round(page.height * 0.06), page.width, pinyin.height, 0, 0, pinyin.width, pinyin.height);
  if (bitmap.close) bitmap.close();
  return { page, threshold, pinyin };
}

function parseOcrTsv(tsv) {
  if (!tsv) return [];
  const lines = String(tsv).trim().split(/\r?\n/);
  if (lines.length < 2) return [];
  const header = lines[0].split('\t');
  const index = Object.fromEntries(header.map((name, position) => [name, position]));
  return lines.slice(1).map(line => {
    const columns = line.split('\t');
    return { level: Number(columns[index.level]), left: Number(columns[index.left]), top: Number(columns[index.top]), width: Number(columns[index.width]), height: Number(columns[index.height]), confidence: Number(columns[index.conf]), text: String(columns[index.text] || '').trim() };
  }).filter(word => word.level === 5 && word.text);
}

function extractPinyinRegions(tsv, imageWidth, imageHeight) {
  const words = parseOcrTsv(tsv).filter(word => {
    const normalized = ocrNormalizePinyin(word.text);
    return normalized && word.confidence > 5 && word.top > imageHeight * 0.08 && word.top < imageHeight * 0.95;
  });
  if (!words.length) return [];
  const heights = words.map(word => word.height).sort((a, b) => a - b);
  const smallHeight = heights[Math.floor(heights.length * 0.42)] || imageHeight * 0.06;
  const filtered = words.filter(word => word.height <= Math.max(smallHeight * 1.45, imageHeight * 0.045));
  const clusters = [];
  filtered.sort((a, b) => (a.top + a.height / 2) - (b.top + b.height / 2) || a.left - b.left).forEach(word => {
    const center = word.top + word.height / 2;
    let cluster = clusters.find(item => Math.abs(item.center - center) <= Math.max(13, smallHeight * 0.72));
    if (!cluster) { cluster = { center, words: [] }; clusters.push(cluster); }
    cluster.words.push(word);
    cluster.center = cluster.words.reduce((sum, item) => sum + item.top + item.height / 2, 0) / cluster.words.length;
  });
  const regions = [];
  clusters.sort((a, b) => a.center - b.center).forEach(cluster => {
    const row = cluster.words.sort((a, b) => a.left - b.left);
    const medianWidth = row.map(word => word.width).sort((a, b) => a - b)[Math.floor(row.length / 2)] || 30;
    const splitGap = Math.max(imageWidth * 0.075, medianWidth * 2.6);
    let current = [];
    const flush = () => {
      if (!current.length) return;
      const raw = current.map(word => word.text).join(' ');
      const pinyin = ocrNormalizePinyin(raw);
      const syllables = pinyin ? pinyin.split(' ') : [];
      if (syllables.length >= 1 && syllables.length <= 5 && pinyin.replace(/\s/g, '').length >= 3) regions.push({ raw, pinyin, key: ocrPinyinKey(pinyin), syllables, left: current[0].left, top: Math.min(...current.map(word => word.top)), right: Math.max(...current.map(word => word.left + word.width)) });
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
}

function chineseEvidenceScore(hanzi, texts) {
  const normalized = normalizeChinese(hanzi);
  const joined = texts.map(text => normalizeChinese(text)).join('|');
  if (joined.includes(normalized)) return 0.28;
  const chars = Array.from(normalized);
  return chars.filter(char => joined.includes(char)).length / Math.max(chars.length, 1) * 0.07;
}

function bestLexiconMatch(region, lexicon, chineseTexts) {
  let best = null;
  for (const entry of lexicon) {
    if (Math.abs(entry.syllables.length - region.syllables.length) > 1) continue;
    if (Math.abs(entry.key.length - region.key.length) > Math.max(4, Math.round(entry.key.length * 0.48))) continue;
    const distance = ocrEditDistance(region.key, entry.key) / Math.max(region.key.length, entry.key.length, 1);
    const syllablePenalty = Math.abs(entry.syllables.length - region.syllables.length) * 0.09;
    const evidence = chineseEvidenceScore(entry.hanzi, chineseTexts);
    const score = distance + syllablePenalty - evidence - entry.priority * 0.012;
    if (!best || score < best.score) best = { entry, score, distance };
  }
  if (!best) return null;
  const threshold = chineseEvidenceScore(best.entry.hanzi, chineseTexts) > 0.2 ? 0.52 : 0.43;
  if (best.score > threshold && best.distance > 0.48) return null;
  return best;
}

function extractVocabFromPinyin(result) {
  const regions = extractPinyinRegions(result.pinyinTsv, result.pinyinWidth, result.pinyinHeight);
  const matches = [];
  regions.forEach(region => {
    const match = bestLexiconMatch(region, result.lexicon, result.chineseTexts);
    if (match) matches.push({ ...region, hanzi: match.entry.hanzi, score: match.score });
  });
  const ordered = [];
  matches.sort((a, b) => a.top - b.top || a.left - b.left).forEach(match => {
    const duplicate = ordered.find(item => item.hanzi === match.hanzi && Math.abs(item.top - match.top) < result.pinyinHeight * 0.08);
    if (!duplicate) ordered.push(match); else if (match.score < duplicate.score) Object.assign(duplicate, match);
  });
  return ordered.slice(0, 20).map(item => item.hanzi);
}

function cleanSentenceLine(line) {
  let value = removeHanSpaces(String(line || '')).replace(/^.*?(?=[\u3400-\u9fff])/, '').replace(/^[\s\d.、:：)）-]+/, '').replace(/[^\u3400-\u9fff，。！？、；：“”‘’]/g, '').replace(/^默写[:：]?/, '').trim();
  if (!/[。！？]$/.test(value) && /[\u3400-\u9fff]$/.test(value)) value += '。';
  return value;
}

function sentenceQuality(text, expectedSyllables = 0) {
  const hanzi = Array.from(text).filter(char => /[\u3400-\u9fff]/.test(char));
  let score = hanzi.length;
  if (/[。！？]$/.test(text)) score += 2;
  if (/[，、]/.test(text)) score += 0.8;
  if (expectedSyllables) score -= Math.abs(hanzi.length - expectedSyllables) * 2.4;
  return score;
}

function extractLongPinyinLines(texts) {
  const result = [];
  texts.forEach(text => String(text || '').split(/\r?\n/).forEach(line => {
    const normalized = ocrNormalizePinyin(line);
    const syllables = normalized ? normalized.split(' ') : [];
    if (syllables.length >= 7 && syllables.length <= 30) result.push(syllables);
  }));
  const unique = [];
  result.forEach(syllables => { const key = syllables.join(''); if (!unique.some(item => ocrSimilarity(item.join(''), key) > 0.82)) unique.push(syllables); });
  return unique.slice(0, 6);
}

function extractSentenceItems(chineseTexts) {
  const candidates = [];
  chineseTexts.forEach((text, passIndex) => {
    String(text || '').split(/\r?\n/).forEach((line, lineIndex) => {
      const cleaned = cleanSentenceLine(line);
      const hanziCount = (cleaned.match(/[\u3400-\u9fff]/g) || []).length;
      if (hanziCount >= 8 && hanziCount <= 40 && !/^(听写|聽寫)/.test(cleaned)) {
        const orderHint = /(?:^|\D)11(?:\D|$)/.test(line) ? 11 : /(?:^|\D)12(?:\D|$)/.test(line) ? 12 : /默写|默寫/.test(line) ? 13 : 100 + lineIndex;
        candidates.push({ text: cleaned, passIndex, lineIndex, hanziCount, orderHint });
      }
    });
  });
  const pinyinLines = extractLongPinyinLines(chineseTexts);
  const clusters = [];
  candidates.forEach(candidate => {
    const key = normalizeChinese(candidate.text);
    let cluster = clusters.find(item => ocrSimilarity(item.key, key) >= 0.58);
    if (!cluster) { cluster = { key, candidates: [], firstOrder: candidate.orderHint }; clusters.push(cluster); }
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
}

extractItems = function accurateExtractItems(input) {
  if (!input || typeof input === 'string') return LEGACY_EXTRACT_ITEMS(input);
  if (input.kind !== 'tingxie-source-ocr-v2') return LEGACY_EXTRACT_ITEMS(String(input.text || ''));
  return uniqueItems([...extractVocabFromPinyin(input), ...extractSentenceItems(input.chineseTexts)]);
};

runOcr = async function accurateRunOcr(file, prefix) {
  if (prefix !== 'source') return LEGACY_RUN_OCR(file, prefix);
  if (!file) throw new Error('Choose or take a photo first.');
  setOcrMessage(prefix, 'Preparing and straightening the worksheet…', 1);
  const [worker, lexicon, images] = await Promise.all([getAccurateSourceWorker(prefix), loadOcrLexicon(), prepareSourceOcrImages(file)]);
  try {
    await worker.setParameters({ tessedit_char_whitelist: '', tessedit_pageseg_mode: '3', preserve_interword_spaces: '1', user_defined_dpi: '300' });
    setOcrMessage(prefix, 'Reading the original photo…', 15);
    const original = await withTimeout(worker.recognize(file, {}, { text: true }), 90000, 'The first OCR pass took too long.');
    await worker.setParameters({ tessedit_char_whitelist: '', tessedit_pageseg_mode: '6', preserve_interword_spaces: '1', user_defined_dpi: '300' });
    setOcrMessage(prefix, 'Reading the enhanced Chinese text…', 48);
    const enhanced = await withTimeout(worker.recognize(images.threshold, {}, { text: true, tsv: true }), 90000, 'The enhanced OCR pass took too long.');
    await worker.setParameters({ tessedit_char_whitelist: 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZāáǎàēéěèīíǐìōóǒòūúǔùǖǘǚǜü0123456789 .', tessedit_pageseg_mode: '6', preserve_interword_spaces: '1', user_defined_dpi: '300' });
    setOcrMessage(prefix, 'Using pinyin to correct unclear words…', 76);
    const pinyin = await withTimeout(worker.recognize(images.pinyin, {}, { text: true, tsv: true }), 90000, 'The pinyin correction pass took too long.');
    await worker.setParameters({ tessedit_char_whitelist: '', tessedit_pageseg_mode: '6' });
    $(`${prefix}ProgressBar`).style.width = '100%';
    $(`${prefix}ProgressText`).textContent = 'Finished. Pinyin and Chinese results were combined.';
    return { kind: 'tingxie-source-ocr-v2', chineseTexts: [original?.data?.text || '', enhanced?.data?.text || ''], pinyinText: pinyin?.data?.text || '', pinyinTsv: pinyin?.data?.tsv || '', pinyinWidth: images.pinyin.width, pinyinHeight: images.pinyin.height, lexicon };
  } catch (error) {
    console.error('Accurate Ting Xie OCR failed', error);
    throw new Error(error?.message || 'The worksheet could not be read. Try a brighter, straighter photo.');
  }
};

window.__tingxieOcrAccuracy = { normalizePinyin: ocrNormalizePinyin, bestLexiconMatch, extractPinyinRegions, extractSentenceItems, extractItems: input => extractItems(input), builtinLexicon: OCR_BUILTIN_LEXICON };

window.addEventListener('pagehide', () => {
  if (accurateSourceWorker) {
    accurateSourceWorker.terminate().catch(() => {});
    accurateSourceWorker = null;
    accurateSourceWorkerPromise = null;
  }
});
