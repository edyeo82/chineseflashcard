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
      const [hubResponse, flashcardsResponse, bootResponse, checklistResponse, cloudResponse, classPackResponse] = await Promise.all([
        fetch(`${LIVE_URL}?hub-deployment=${stamp}`, { headers: { 'cache-control': 'no-cache' } }),
        fetch(`${LIVE_URL}flashcards/?hub-deployment=${stamp}`, { headers: { 'cache-control': 'no-cache' } }),
        fetch(`${LIVE_URL}tingxie/boot.js?hub-deployment=${stamp}`, { headers: { 'cache-control': 'no-cache' } }),
        fetch(`${LIVE_URL}tingxie/app-word-checklist-voice.js?hub-deployment=${stamp}`, { headers: { 'cache-control': 'no-cache' } }),
        fetch(`${LIVE_URL}tingxie/app-cloud-sync.js?hub-deployment=${stamp}`, { headers: { 'cache-control': 'no-cache' } }),
        fetch(`${LIVE_URL}tingxie/app-class-pack.js?hub-deployment=${stamp}`, { headers: { 'cache-control': 'no-cache' } })
      ]);
      const [hubText, flashcardsText, bootText, checklistText, cloudText, classPackText] = await Promise.all([
        hubResponse.text(), flashcardsResponse.text(), bootResponse.text(), checklistResponse.text(), cloudResponse.text(), classPackResponse.text()
      ]);
      const ready = hubResponse.ok && flashcardsResponse.ok && bootResponse.ok && checklistResponse.ok && cloudResponse.ok && classPackResponse.ok
        && hubText.includes('KidoTree Learning Hub')
        && hubText.includes('href="flashcards/"')
        && hubText.includes('href="tingxie/"')
        && hubText.includes('href="spelling/"')
        && flashcardsText.includes('Higher Chinese Flashcards')
        && bootText.includes("TINGXIE_BOOT_VERSION = '20260802-3'")
        && checklistText.includes("TINGXIE_WORD_CHECKLIST_VERSION = '20260802-2'")
        && cloudText.includes("TINGXIE_CLOUD_SYNC_VERSION = '20260802-3'")
        && classPackText.includes("TINGXIE_CLASS_PACK_VERSION = '20260809-1'");
      if (ready) return;
      last = `hub=${hubResponse.status}, flashcards=${flashcardsResponse.status}, boot=${bootResponse.status}, checklist=${checklistResponse.status}, cloud=${cloudResponse.status}, classPack=${classPackResponse.status}, ready=${ready}`;
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
  assert.equal(await page.locator('.card').count(), 3);
  assert.equal(await page.locator('.card.flash').getAttribute('href'), 'flashcards/');
  assert.equal(await page.locator('.card.ting').getAttribute('href'), 'tingxie/');
  assert.equal(await page.locator('.card.spell').getAttribute('href'), 'spelling/');

  await page.locator('.card.flash').click();
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
  await page.waitForFunction(() => document.documentElement.dataset.tingxieWordChecklist === 'true');
  await page.waitForFunction(() => document.documentElement.dataset.tingxieCloudSync === 'true');
  await page.waitForFunction(() => document.documentElement.dataset.tingxieHubLinkPlacement === 'top');
  await page.waitForFunction(() => document.documentElement.dataset.tingxieRateScale === 'true');
  await page.waitForFunction(() => window.__tingxieClassPack?.version === '20260809-1');
  const hubLink = page.locator('#learningHubLink');
  assert.equal(await hubLink.innerText(), '← Learning apps');
  assert.equal(await hubLink.getAttribute('href'), '../');
  assert.equal(await hubLink.isVisible(), true);
  assert.equal(await hubLink.evaluate(element => getComputedStyle(element).position), 'static');
  assert.equal(await hubLink.evaluate(element => element.parentElement?.matches('.app-header > div')), true);
  await hubLink.click();
  await page.waitForURL(new RegExp(`${LIVE_URL.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?:\\?.*)?$`));
  assert.equal(await page.title(), 'KidoTree Learning Hub');
  assert.equal(await page.locator('.card').count(), 3);

  await page.screenshot({ path: SCREENSHOT, fullPage: true });
  console.log('LEARNING_HUB_LIVE_PASS');
} catch (error) {
  await page?.screenshot({ path: FAILURE_SCREENSHOT, fullPage: true }).catch(() => {});
  const state = await page?.evaluate(() => ({
    url: location.href,
    title: document.title,
    body: document.body?.innerText?.slice(0, 1200),
    tingxieReady: document.documentElement.dataset.tingxieEventsBound,
    hubLink: document.documentElement.dataset.tingxieHubLink,
    hubPlacement: document.documentElement.dataset.tingxieHubLinkPlacement,
    rateScale: document.documentElement.dataset.tingxieRateScale,
    checklist: document.documentElement.dataset.tingxieWordChecklist,
    cloud: document.documentElement.dataset.tingxieCloudSync,
    classPack: window.__tingxieClassPack?.version
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
