import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';

const LIVE_URL = 'https://edyeo82.github.io/chineseflashcard/tingxie/';
const SCREENSHOT = '/tmp/tingxie-live-pass.png';
const FAILURE_SCREENSHOT = '/tmp/tingxie-live-failure.png';
const FAILURE_LOG = '/tmp/tingxie-live-error.txt';

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

async function waitForDeployment() {
  const deadline = Date.now() + 10 * 60 * 1000;
  let last = 'not checked';
  while (Date.now() < deadline) {
    try {
      const stamp = Date.now();
      const [pageResponse, bootResponse, friendlyResponse, syncResponse] = await Promise.all([
        fetch(`${LIVE_URL}?live-friendly-build=${stamp}`, { headers: { 'cache-control': 'no-cache' } }),
        fetch(`${LIVE_URL}boot.js?live-friendly-build=${stamp}`, { headers: { 'cache-control': 'no-cache' } }),
        fetch(`${LIVE_URL}app-friendly-ux.js?live-friendly-build=${stamp}`, { headers: { 'cache-control': 'no-cache' } }),
        fetch(`${LIVE_URL}app-family-sync-simple.js?live-friendly-build=${stamp}`, { headers: { 'cache-control': 'no-cache' } })
      ]);
      const [html, boot, friendly, sync] = await Promise.all([
        pageResponse.text(), bootResponse.text(), friendlyResponse.text(), syncResponse.text()
      ]);
      const ready = html.includes('ux=20260810-1')
        && boot.includes("app-friendly-ux.js?v=20260810-1")
        && boot.includes("app-family-sync-simple.js?v=20260810-1")
        && friendly.includes("TINGXIE_FRIENDLY_UX_VERSION = '20260810-1'")
        && sync.includes("TINGXIE_SIMPLE_SYNC_VERSION = '20260810-1'");
      if (pageResponse.ok && bootResponse.ok && friendlyResponse.ok && syncResponse.ok && ready) return;
      last = `page=${pageResponse.status}, boot=${bootResponse.status}, friendly=${friendlyResponse.status}, sync=${syncResponse.status}, ready=${ready}`;
    } catch (error) {
      last = error.message;
    }
    await sleep(10000);
  }
  throw new Error(`Friendly Ting Xie deployment did not appear. Last result: ${last}`);
}

async function installSpeechStubs(context) {
  await context.addInitScript(() => {
    localStorage.setItem('hcl:saveMode', 'guest');
    localStorage.removeItem('hcl:simpleUsername');
    const voices = [
      { name: 'Singapore Female', lang: 'zh-SG', localService: true },
      { name: 'Ting-Ting', lang: 'zh-CN', localService: true }
    ];
    class FakeUtterance {
      constructor(text) {
        this.text = text;
        this.lang = 'zh-SG';
        this.rate = 1;
        this.pitch = 1;
        this.volume = 1;
        this.voice = null;
      }
    }
    Object.defineProperty(window, 'SpeechSynthesisUtterance', { value: FakeUtterance, configurable: true });
    Object.defineProperty(window, 'speechSynthesis', {
      configurable: true,
      value: {
        getVoices: () => voices,
        speak: utterance => setTimeout(() => { utterance.onstart?.(); utterance.onend?.(); }, 5),
        cancel: () => {},
        onvoiceschanged: null
      }
    });
  });
}

async function verifyLivePage(browser) {
  const context = await browser.newContext({ viewport: { width: 430, height: 932 } });
  await installSpeechStubs(context);
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', error => errors.push(`pageerror: ${error.stack || error.message}`));
  page.on('console', message => { if (message.type() === 'error') errors.push(`console: ${message.text()}`); });
  page.on('requestfailed', request => {
    const text = request.failure()?.errorText || '';
    if (!/ERR_ABORTED/i.test(text)) errors.push(`requestfailed: ${request.url()} :: ${text}`);
  });

  try {
    await page.goto(`${LIVE_URL}?live-friendly-check=${Date.now()}`, { waitUntil: 'networkidle' });
    await page.waitForFunction(() =>
      window.__tingxieFriendlyUx?.active === true
      && window.__tingxieFriendlyFinalPolish?.version === '20260810-1'
      && window.__tingxieSimpleFamilySync?.version === '20260810-1',
      null,
      { timeout: 20000 }
    );

    assert.equal(await page.locator('html').getAttribute('data-tingxie-browser-ocr'), 'retired');
    assert.equal(await page.locator('html').getAttribute('data-tingxie-ocr-accuracy'), null);
    assert.equal(await page.locator('label[for="sourceImage"]').isVisible(), false);
    assert.equal(await page.locator('#scanSourceButton').isVisible(), false);
    assert.equal(await page.locator('.in-browser-camera-button:visible').count(), 0);
    assert.equal(await page.evaluate(() => Boolean(document.querySelector('script[data-tingxie-ocr-accuracy]'))), false);

    const sync = page.locator('#tingxieCloudSyncBox');
    assert.equal(await sync.getAttribute('open'), '');
    const syncText = await sync.innerText();
    assert.match(syncText, /Family username/i);
    assert.match(syncText, /save automatically/i);
    assert.doesNotMatch(syncText, /Google|Sign in|Create account|Copy this browser|Reload from cloud/i);

    const hub = page.locator('#learningHubLink');
    assert.equal(await hub.innerText(), '← Learning apps');
    assert.equal(await hub.evaluate(element => getComputedStyle(element).position), 'static');

    assert.equal(await page.locator('.word-checklist-heading strong').innerText(), 'Words your child has learned');
    assert.match(await page.locator('.word-checklist-heading p').innerText(), /Tick a word after your child knows it/i);
    assert.equal(await page.locator('#pasteListButton').innerText(), '📋 Paste list from ChatGPT');

    await page.locator('#wordList').fill('浪费\n一份');
    await page.waitForFunction(() => document.querySelectorAll('.word-checklist-row').length === 2);
    const learned = page.locator('.word-checklist-row').filter({ hasText: '一份' }).first();
    await learned.locator('input[type="checkbox"]').check();
    await page.waitForFunction(() => {
      const row = [...document.querySelectorAll('.word-checklist-row')].find(item => item.textContent.includes('一份'));
      return row?.classList.contains('learned')
        && row.querySelector('.word-checklist-status')?.textContent.includes('Learned')
        && Number.parseFloat(getComputedStyle(row).opacity) < 0.8;
    });
    assert.equal(await page.locator('#wordChecklistSummary').innerText(), '1 learned · 1 to practise');

    await page.locator('#startDictationButton').click();
    await page.locator('#dictationPanel.active').waitFor({ timeout: 10000 });
    const session = await page.evaluate(() => window.__tingxieReaderMode?.snapshot?.());
    assert.deepEqual(session.words, ['浪费']);
    await page.locator('#exitDictationButton').click();
    await page.locator('#setupPanel.active').waitFor({ timeout: 10000 });

    assert.deepEqual(errors, []);
    console.log('TINGXIE_LIVE_MILESTONE: friendly-production-flow-pass');
    await page.screenshot({ path: SCREENSHOT, fullPage: true });
  } catch (error) {
    await page.screenshot({ path: FAILURE_SCREENSHOT, fullPage: true }).catch(() => {});
    const state = await page.evaluate(() => ({
      url: location.href,
      ready: document.documentElement.dataset.tingxieEventsBound,
      friendly: document.documentElement.dataset.tingxieFriendlyUx,
      browserOcr: document.documentElement.dataset.tingxieBrowserOcr,
      accuracy: document.documentElement.dataset.tingxieOcrAccuracy,
      sync: document.querySelector('#tingxieCloudSyncBox')?.textContent,
      checklist: document.querySelector('#wordChecklistSummary')?.textContent,
      words: document.querySelector('#wordList')?.value
    })).catch(() => ({}));
    throw new Error(`${error.stack || error}\nBrowser errors:\n${errors.join('\n')}\nPage state:\n${JSON.stringify(state, null, 2)}`);
  } finally {
    await context.close();
  }
}

let browser;
try {
  await waitForDeployment();
  browser = await chromium.launch({ headless: true });
  await verifyLivePage(browser);
  await fs.access(SCREENSHOT);
  console.log('TINGXIE_LIVE_PASS');
} catch (error) {
  const detail = error.stack || String(error);
  await fs.writeFile(FAILURE_LOG, detail, 'utf8');
  console.error('TINGXIE_LIVE_FAILURE');
  console.error(detail);
  process.exitCode = 1;
} finally {
  await browser?.close();
}
