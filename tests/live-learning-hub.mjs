import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';

const LIVE_URL = 'https://edyeo82.github.io/chineseflashcard/';
const SCREENSHOT = '/tmp/learning-hub-live-pass.png';
const FAILURE_SCREENSHOT = '/tmp/learning-hub-live-failure.png';
const FAILURE_LOG = '/tmp/learning-hub-live-error.txt';
const sleep = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds));

async function waitForDeployment() {
  const deadline = Date.now() + 10 * 60 * 1000;
  let last = 'No response yet.';
  while (Date.now() < deadline) {
    try {
      const stamp = Date.now();
      const [hubResponse, flashcardsResponse, bootResponse] = await Promise.all([
        fetch(`${LIVE_URL}?hub-deployment=${stamp}`, { headers: { 'cache-control': 'no-cache' } }),
        fetch(`${LIVE_URL}flashcards/?hub-deployment=${stamp}`, { headers: { 'cache-control': 'no-cache' } }),
        fetch(`${LIVE_URL}tingxie/boot.js?hub-deployment=${stamp}`, { headers: { 'cache-control': 'no-cache' } })
      ]);
      const [hubText, flashcardsText, bootText] = await Promise.all([
        hubResponse.text(), flashcardsResponse.text(), bootResponse.text()
      ]);
      const ready = hubResponse.ok && flashcardsResponse.ok && bootResponse.ok
        && hubText.includes('KidoTree Learning Hub')
        && hubText.includes('data-app="flashcards"')
        && flashcardsText.includes('Higher Chinese Flashcards')
        && bootText.includes("TINGXIE_BOOT_VERSION = '20260719-8'");
      if (ready) return;
      last = `hub=${hubResponse.status}, flashcards=${flashcardsResponse.status}, boot=${bootResponse.status}, ready=${ready}`;
    } catch (error) {
      last = error.message;
    }
    console.log(`Waiting for learning hub deployment: ${last}`);
    await sleep(10000);
  }
  throw new Error(`The learning hub deployment did not appear within 10 minutes. Last result: ${last}`);
}

let browser;
let context;
let page;
const browserErrors = [];

try {
  await waitForDeployment();
  browser = await chromium.launch({ headless: true });
  context = await browser.newContext({ viewport: { width: 430, height: 932 } });
  await context.addInitScript(() => {
    class FakeUtterance {
      constructor(text) { this.text = text; this.lang = 'zh-CN'; this.rate = 1; }
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

  page = await context.newPage();
  page.on('pageerror', error => browserErrors.push(`pageerror: ${error.message}`));

  await page.goto(`${LIVE_URL}?hub-live=${Date.now()}`, { waitUntil: 'domcontentloaded' });
  assert.equal(await page.title(), 'KidoTree Learning Hub');
  assert.equal(await page.locator('.app-card').count(), 2);

  await page.locator('[data-app="flashcards"]').click();
  await page.waitForURL(/\/flashcards\/$/);
  assert.equal(await page.locator('h1').innerText(), 'Higher Chinese Flashcards');
  const helperResponse = await page.evaluate(async () => {
    const response = await fetch('hcl-words/helpers.json');
    return { ok: response.ok, status: response.status };
  });
  assert.deepEqual(helperResponse, { ok: true, status: 200 });

  await page.goto(`${LIVE_URL}tingxie/?hub-live=${Date.now()}`, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => document.documentElement.dataset.tingxieEventsBound === 'true');
  await page.waitForFunction(() => document.documentElement.dataset.tingxieHubLink === 'true');
  await page.locator('#learningHubLink').click();
  await page.waitForURL(new RegExp(`${LIVE_URL.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?:\\?.*)?$`));
  assert.equal(await page.title(), 'KidoTree Learning Hub');

  await page.screenshot({ path: SCREENSHOT, fullPage: true });
  console.log('LEARNING_HUB_LIVE_PASS');
} catch (error) {
  await page?.screenshot({ path: FAILURE_SCREENSHOT, fullPage: true }).catch(() => {});
  const state = await page?.evaluate(() => ({
    url: location.href,
    title: document.title,
    body: document.body?.innerText?.slice(0, 1200),
    tingxieReady: document.documentElement.dataset.tingxieEventsBound,
    hubLink: document.documentElement.dataset.tingxieHubLink
  })).catch(() => ({}));
  const detail = `${error.stack || error}\nBrowser errors:\n${browserErrors.join('\n')}\nPage state:\n${JSON.stringify(state, null, 2)}`;
  await fs.writeFile(FAILURE_LOG, detail, 'utf8');
  console.error('LEARNING_HUB_LIVE_FAILURE');
  console.error(detail);
  process.exitCode = 1;
} finally {
  await context?.close();
  await browser?.close();
}
