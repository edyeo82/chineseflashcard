import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';

const PORT = 4176;
const BASE_URL = `http://127.0.0.1:${PORT}`;
const FAILURE_LOG = '/tmp/tingxie-measured-pinyin-error.txt';
const EXPECTED = ['浪费', '组屋', '所以', '如果', '车辆', '一份', '尽力', '超市', '日用品', '停车场'];

function measuredTsv() {
  const header = 'level\tpage_num\tblock_num\tpar_num\tline_num\tword_num\tleft\ttop\twidth\theight\tconf\ttext';
  const words = [
    // Header noise.
    [32, 0, 593, 54, 20, 'LE'], [1297, 0, 127, 34, 28, 'OAR'], [1450, 0, 43, 46, 2, 'oF'],
    // First true pinyin row from the supplied photo.
    [210, 113, 63, 57, 71, 'lang'], [296, 116, 33, 32, 78, 'féi'],
    [629, 112, 33, 29, 57, 'zi.'], [693, 115, 42, 25, 70, 'wii'],
    [1082, 102, 54, 31, 67, 'sud'], [1163, 95, 30, 70, 91, 'yi'],
    [1534, 93, 30, 31, 72, 'rd'], [1594, 96, 58, 35, 76, 'gud'],
    // Handwriting row misread as Latin fragments.
    [189, 158, 216, 73, 36, '(eV'], [616, 154, 127, 59, 59, 'BE'],
    // Second true pinyin row.
    [205, 315, 53, 26, 93, 'ché'], [279, 309, 66, 38, 87, 'liang'],
    [631, 302, 25, 38, 73, 'yi'], [688, 301, 45, 32, 85, 'fen'],
    [1096, 306, 24, 19, 77, 'in'], [1165, 292, 14, 30, 69, 'li'],
    [1524, 290, 76, 26, 81, 'chao'], [1624, 280, 44, 61, 97, 'shi'],
    // More handwritten noise.
    [203, 353, 136, 63, 20, 'eee'], [390, 341, 147, 64, 38, 'VO'], [613, 317, 237, 98, 51, 'Sy'],
    [1055, 335, 162, 90, 55, 'hh'], [1274, 335, 59, 90, 43, 'SF'],
    // Third true pinyin row.
    [192, 482, 51, 28, 37, 'Tt'], [262, 474, 73, 61, 96, 'yong'], [352, 480, 46, 35, 97, 'pin'],
    [641, 474, 55, 39, 93, 'ting'], [717, 480, 52, 27, 92, 'ché'], [790, 476, 90, 36, 87, 'chang'],
    // Bottom handwriting fragments.
    [160, 499, 305, 104, 34, 'BAe'], [635, 517, 342, 70, 29, 'EY']
  ];
  return [header, ...words.map((word, index) => `5\t1\t1\t1\t1\t${index + 1}\t${word[0]}\t${word[1]}\t${word[2]}\t${word[3]}\t${word[4]}\t${word[5]}`)].join('\n');
}

const server = spawn('python3', ['-m', 'http.server', String(PORT), '--directory', '.'], {
  stdio: ['ignore', 'pipe', 'pipe']
});

async function waitForServer() {
  const deadline = Date.now() + 15000;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`${BASE_URL}/tingxie/`);
      if (response.ok) return;
    } catch {}
    await new Promise(resolve => setTimeout(resolve, 250));
  }
  throw new Error('Local server did not start.');
}

let browser;
let context;
let page;
try {
  await waitForServer();
  browser = await chromium.launch({ headless: true });
  context = await browser.newContext({ viewport: { width: 430, height: 932 } });
  page = await context.newPage();
  await page.goto(`${BASE_URL}/tingxie/?test=measured-pinyin`, { waitUntil: 'networkidle' });
  await page.waitForFunction(() => document.documentElement.dataset.tingxieOcrAccuracy === 'true');

  const result = await page.evaluate(tsv => {
    const normalize = window.__tingxieOcrAccuracy.normalizePinyin;
    const lexicon = window.__tingxieOcrAccuracy.builtinLexicon.map(([hanzi, pinyin]) => {
      const normalized = normalize(pinyin);
      return { hanzi, pinyin: normalized, key: normalized.replace(/\s/g, ''), syllables: normalized.split(' '), priority: 3 };
    });
    const input = {
      pinyinTsv: tsv,
      pinyinWidth: 1800,
      pinyinHeight: 700,
      lexicon,
      chineseTexts: ['浪费 组屋 所以 如果 车辆 一份 尽力 超市 日用品 停车场']
    };
    const regions = window.__tingxieRegionFix.extractPinyinRegions(tsv, 1800, 700);
    const targetRegion = regions.find(region => /zi|wii/i.test(region.raw)) || null;
    const trusted = targetRegion
      ? window.__tingxieTrustedFallback.trustedCuratedMatch(targetRegion, lexicon, input.chineseTexts)
      : null;
    const chosen = targetRegion
      ? window.__tingxieTrustedFallback.bestLexiconMatch(targetRegion, lexicon, input.chineseTexts)
      : null;
    const evidenceLines = window.__tingxieEvidenceFix.vocabularyEvidenceText(input.chineseTexts);
    return {
      actual: window.__tingxieRegionFix.extractVocabFromPinyin(input),
      debug: {
        targetRegion,
        trusted: trusted ? { hanzi: trusted.entry.hanzi, score: trusted.score, distance: trusted.distance, evidence: trusted.evidence } : null,
        chosen: chosen ? { hanzi: chosen.entry.hanzi, score: chosen.score, distance: chosen.distance, evidence: chosen.evidence } : null,
        evidenceLines,
        regions: regions.map(region => ({ raw: region.raw, pinyin: region.pinyin, top: region.top, left: region.left }))
      }
    };
  }, measuredTsv());

  assert.deepEqual(result.actual, EXPECTED, JSON.stringify(result.debug, null, 2));
  await page.locator('#wordList').fill(result.actual.join('\n'));
  await page.screenshot({ path: '/tmp/tingxie-measured-pinyin-pass.png', fullPage: true });
  console.log('TINGXIE_MEASURED_PINYIN_REGRESSION_PASS');
} catch (error) {
  await page?.screenshot({ path: '/tmp/tingxie-measured-pinyin-failure.png', fullPage: true }).catch(() => {});
  const detail = error.stack || String(error);
  await fs.writeFile(FAILURE_LOG, detail, 'utf8');
  console.error('TINGXIE_MEASURED_PINYIN_REGRESSION_FAILURE');
  console.error(detail);
  process.exitCode = 1;
} finally {
  await context?.close();
  await browser?.close();
  server.kill('SIGTERM');
}
