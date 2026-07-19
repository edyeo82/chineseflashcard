import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';

const PORT = 4175;
const BASE_URL = `http://127.0.0.1:${PORT}`;
const FAILURE_LOG = '/tmp/tingxie-exact-photo-error.txt';
const EXPECTED = [
  '浪费', '组屋', '所以', '如果', '车辆', '一份', '尽力', '超市', '日用品', '停车场',
  '我认为开着灯睡觉是不对的。',
  '读过的报纸，我们可以废物利用。',
  '妈妈购物时，都会用环保袋装东西。'
];

// These are the measured outputs from the original and enhanced OCR passes on
// the user's supplied worksheet photo. They intentionally retain the mistakes.
const ACTUAL_ORIGINAL_PASS = `听写
lang e          zi wi           sud yi           ra gud
ché lidng          yi fen             li            chao shi
ni yong pin           ting ché chiang
wd ran wéi kai zhe déng shui jido shi bu dui de
我认为开着灯睡党是不对的。
da gud de bdo zhi   wo men kg yi fei wi Ii yong
读过的报纸,我们可以废物利用。
ma ma gou wu shi    dou hui yong huGn bdo dai zhuGng dong xi
妈妈购物时，都会用环保做 装 东西。`;

const ACTUAL_ENHANCED_PASS = `听写(十一) 第十一课
lang fei          zu wi            sud vi          ri gud
ché lidn           i fen             in li            chao shi
yong pin           ting ché chang
wo ren wéi kai zhe déng shui jido shi bu dui de
11. 我认为开着灯有睡觉是不对的。
di gud de bdo zhi   wS men k& yi fei wi li yong
12. 读过的报纸，我们可以废物利用。
ma ma gou wd shi    ddu hui yong hudn bdo dai zhu@ng dong xi
默写：妈妈购物时，都会用环保袋 装 东西。`;

function makeMeasuredPinyinTsv() {
  const header = 'level\tpage_num\tblock_num\tpar_num\tline_num\tword_num\tleft\ttop\twidth\theight\tconf\ttext';
  const rows = [];
  let number = 0;
  const add = (tokens, startX, top, line) => {
    let left = startX;
    tokens.forEach(token => {
      number += 1;
      const width = Math.max(42, token.length * 30);
      rows.push(`5\t1\t1\t1\t${line}\t${number}\t${left}\t${top}\t${width}\t36\t82\t${token}`);
      left += width + 22;
    });
  };
  add(['lang', 'fei'], 100, 120, 1);
  add(['zi', 'wii'], 480, 120, 1);
  add(['sud', 'yi'], 850, 120, 1);
  add(['rd', 'gud'], 1240, 120, 1);
  add(['ché', 'liang'], 100, 340, 2);
  add(['yi', 'fen'], 480, 340, 2);
  add(['in', 'li'], 850, 340, 2);
  add(['chao', 'shi'], 1240, 340, 2);
  add(['Tt', 'yong', 'pin'], 180, 560, 3);
  add(['ting', 'ché', 'chang'], 980, 560, 3);
  return [header, ...rows].join('\n');
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
  const errors = [];
  page.on('pageerror', error => errors.push(error.stack || error.message));

  await page.goto(`${BASE_URL}/tingxie/?test=exact-photo-parser`, { waitUntil: 'networkidle' });
  await page.waitForFunction(() => document.documentElement.dataset.tingxieOcrAccuracy === 'true');

  const actual = await page.evaluate(({ original, enhanced, tsv }) => {
    const normalize = window.__tingxieOcrAccuracy.normalizePinyin;
    const lexicon = window.__tingxieOcrAccuracy.builtinLexicon.map(([hanzi, pinyin]) => {
      const normalized = normalize(pinyin);
      return {
        hanzi,
        pinyin: normalized,
        key: normalized.replace(/\s/g, ''),
        syllables: normalized.split(' '),
        priority: 3
      };
    });
    return window.__tingxieOcrAccuracy.extractItems({
      kind: 'tingxie-source-ocr-v2',
      chineseTexts: [original, enhanced],
      pinyinText: '',
      pinyinTsv: tsv,
      pinyinWidth: 1800,
      pinyinHeight: 760,
      lexicon
    });
  }, { original: ACTUAL_ORIGINAL_PASS, enhanced: ACTUAL_ENHANCED_PASS, tsv: makeMeasuredPinyinTsv() });

  assert.deepEqual(actual, EXPECTED);
  assert.deepEqual(errors, []);
  await page.locator('#wordList').fill(actual.join('\n'));
  await page.screenshot({ path: '/tmp/tingxie-exact-photo-pass.png', fullPage: true });
  console.log('TINGXIE_EXACT_PHOTO_REGRESSION_PASS');
} catch (error) {
  await page?.screenshot({ path: '/tmp/tingxie-exact-photo-failure.png', fullPage: true }).catch(() => {});
  const detail = error.stack || String(error);
  await fs.writeFile(FAILURE_LOG, detail, 'utf8');
  console.error('TINGXIE_EXACT_PHOTO_REGRESSION_FAILURE');
  console.error(detail);
  process.exitCode = 1;
} finally {
  await context?.close();
  await browser?.close();
  server.kill('SIGTERM');
}
