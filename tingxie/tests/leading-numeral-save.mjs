import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';

const PORT = 4179;
const LOCAL_BASE = `http://127.0.0.1:${PORT}/tingxie/`;
const BASE_URL = process.env.TINGXIE_BASE_URL || LOCAL_BASE;
const IS_LIVE = Boolean(process.env.TINGXIE_BASE_URL);
const FAILURE_LOG = '/tmp/tingxie-leading-numeral-save-error.txt';

const USER_LIST = [
  '浪费',
  '组屋',
  '所以',
  '如果',
  '车辆',
  '一份',
  '尽力',
  '超市',
  '日用品',
  '停车场',
  '我认为开着灯睡觉是不对的。',
  '读过的报纸，我们可以废物利用。',
  '妈妈购物时，都会用环保袋装东西。'
];

const UPDATED_LIST = [...USER_LIST, '一座山', '五颗星'];
let server = null;

async function waitForLocalServer() {
  const deadline = Date.now() + 15000;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(LOCAL_BASE);
      if (response.ok) return;
    } catch {}
    await new Promise(resolve => setTimeout(resolve, 250));
  }
  throw new Error('Local list-save test server did not start.');
}

async function waitForLiveDeployment() {
  const deadline = Date.now() + 10 * 60 * 1000;
  let last = 'not checked';
  while (Date.now() < deadline) {
    try {
      const stamp = Date.now();
      const [bootResponse, parserResponse, saveResponse] = await Promise.all([
        fetch(`${BASE_URL}boot.js?save-deployment=${stamp}`, { headers: { 'cache-control': 'no-cache' } }),
        fetch(`${BASE_URL}app-list-parser-fix.js?save-deployment=${stamp}`, { headers: { 'cache-control': 'no-cache' } }),
        fetch(`${BASE_URL}app-memory-save-button.js?save-deployment=${stamp}`, { headers: { 'cache-control': 'no-cache' } })
      ]);
      const [boot, parser, save] = await Promise.all([bootResponse.text(), parserResponse.text(), saveResponse.text()]);
      const ready = boot.includes('20260722-2') && parser.includes('20260722-2') && save.includes('20260722-2');
      if (bootResponse.ok && parserResponse.ok && saveResponse.ok && ready) return;
      last = `boot=${bootResponse.status}, parser=${parserResponse.status}, save=${saveResponse.status}, version=${ready}`;
    } catch (error) {
      last = error.message;
    }
    await new Promise(resolve => setTimeout(resolve, 10000));
  }
  throw new Error(`List-save deployment did not appear. Last result: ${last}`);
}

async function installSpeechStubs(context) {
  await context.addInitScript(() => {
    class FakeUtterance {
      constructor(text) {
        this.text = text;
        this.lang = 'zh-CN';
        this.rate = 1;
      }
    }
    Object.defineProperty(window, 'SpeechSynthesisUtterance', { value: FakeUtterance, configurable: true });
    Object.defineProperty(window, 'speechSynthesis', {
      value: {
        getVoices: () => [{ name: 'Test Mandarin', lang: 'zh-CN', localService: true }],
        speak: utterance => setTimeout(() => utterance.onend?.(), 5),
        cancel: () => {},
        onvoiceschanged: null
      },
      configurable: true
    });
  });
}

let browser;
let context;
let page;
const errors = [];
try {
  if (IS_LIVE) {
    await waitForLiveDeployment();
  } else {
    server = spawn('python3', ['-m', 'http.server', String(PORT), '--directory', '.'], {
      stdio: ['ignore', 'pipe', 'pipe']
    });
    await waitForLocalServer();
  }

  browser = await chromium.launch({ headless: true });
  context = await browser.newContext({ viewport: { width: 430, height: 932 } });
  await installSpeechStubs(context);
  page = await context.newPage();
  page.on('pageerror', error => errors.push(`pageerror: ${error.stack || error.message}`));
  page.on('console', message => { if (message.type() === 'error') errors.push(`console: ${message.text()}`); });
  page.on('requestfailed', request => errors.push(`requestfailed: ${request.url()} :: ${request.failure()?.errorText}`));

  await page.goto(`${BASE_URL}?test=deterministic&leading-numeral=${Date.now()}`, { waitUntil: 'networkidle' });
  await page.waitForFunction(() => (
    document.documentElement.dataset.tingxieProfileMemory === 'true' &&
    document.documentElement.dataset.tingxieListParserFix === 'true' &&
    document.documentElement.dataset.tingxieMemorySaveButton === 'true'
  ));

  const parserResult = await page.evaluate(() => window.__tingxieListParserFix.parse('一份\n一座山\n五颗星\n1. 浪费\n二、组屋'));
  assert.deepEqual(parserResult, ['一份', '一座山', '五颗星', '浪费', '组屋']);

  await page.locator('#wordList').fill(USER_LIST.join('\n'));
  assert.equal(await page.locator('#wordCount').innerText(), '13 items');
  await page.locator('#saveMemoryListButton').click();
  await page.waitForFunction(() => document.querySelector('#profileMemoryStatus')?.textContent.startsWith('Saved “'));

  let active = await page.evaluate(() => window.__tingxieProfileMemory.activeProfile());
  assert.equal(active.lists.length, 1);
  assert.deepEqual(active.lists[0].words, USER_LIST);
  assert.equal(active.lists[0].words[5], '一份');

  await page.locator('#wordList').fill(UPDATED_LIST.join('\n'));
  await page.locator('#saveMemoryListButton').click();
  await page.waitForFunction(() => document.querySelector('#wordCount')?.textContent === '15 items');

  active = await page.evaluate(() => window.__tingxieProfileMemory.activeProfile());
  assert.equal(active.lists.length, 1);
  assert.deepEqual(active.lists[0].words, UPDATED_LIST);
  assert.equal(active.lists[0].words.includes('一份'), true);
  assert.equal(active.lists[0].words.includes('一座山'), true);
  assert.equal(active.lists[0].words.includes('五颗星'), true);

  await page.reload({ waitUntil: 'networkidle' });
  await page.waitForFunction(() => document.documentElement.dataset.tingxieMemorySaveButton === 'true');
  assert.equal(await page.locator('#wordList').inputValue(), UPDATED_LIST.join('\n'));
  assert.equal(await page.locator('#wordCount').innerText(), '15 items');

  const reloaded = await page.evaluate(() => window.__tingxieProfileMemory.activeProfile());
  assert.deepEqual(reloaded.lists[0].words, UPDATED_LIST);
  assert.deepEqual(errors, []);

  await page.screenshot({ path: '/tmp/tingxie-leading-numeral-save-pass.png', fullPage: true });
  console.log(IS_LIVE ? 'TINGXIE_LIVE_LEADING_NUMERAL_SAVE_PASS' : 'TINGXIE_LEADING_NUMERAL_SAVE_PASS');
} catch (error) {
  await page?.screenshot({ path: '/tmp/tingxie-leading-numeral-save-failure.png', fullPage: true }).catch(() => {});
  const state = await page?.evaluate(() => ({
    parserReady: document.documentElement.dataset.tingxieListParserFix,
    memoryReady: document.documentElement.dataset.tingxieProfileMemory,
    saveReady: document.documentElement.dataset.tingxieMemorySaveButton,
    words: document.querySelector('#wordList')?.value,
    count: document.querySelector('#wordCount')?.textContent,
    status: document.querySelector('#profileMemoryStatus')?.textContent,
    memory: window.__tingxieProfileMemory?.snapshot?.()
  })).catch(() => ({}));
  const detail = `${error.stack || error}\nBrowser errors:\n${errors.join('\n')}\nPage state:\n${JSON.stringify(state, null, 2)}`;
  await fs.writeFile(FAILURE_LOG, detail, 'utf8');
  console.error(IS_LIVE ? 'TINGXIE_LIVE_LEADING_NUMERAL_SAVE_FAILURE' : 'TINGXIE_LEADING_NUMERAL_SAVE_FAILURE');
  console.error(detail);
  process.exitCode = 1;
} finally {
  await context?.close();
  await browser?.close();
  server?.kill('SIGTERM');
}
