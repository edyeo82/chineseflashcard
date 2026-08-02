import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';

const PORT = 4180;
const LOCAL_BASE = `http://127.0.0.1:${PORT}/tingxie/`;
const BASE_URL = process.env.TINGXIE_BASE_URL || LOCAL_BASE;
const IS_LIVE = Boolean(process.env.TINGXIE_BASE_URL);
const FAILURE_LOG = '/tmp/tingxie-reader-mode-error.txt';
const WORDS = ['浪费', '组屋', '一份', '停车场'];

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
  throw new Error('Local reader-mode test server did not start.');
}

async function waitForLiveDeployment() {
  const deadline = Date.now() + 10 * 60 * 1000;
  let last = 'not checked';
  while (Date.now() < deadline) {
    try {
      const stamp = Date.now();
      const [pageResponse, scriptResponse] = await Promise.all([
        fetch(`${BASE_URL}?reader-deployment=${stamp}`, { headers: { 'cache-control': 'no-cache' } }),
        fetch(`${BASE_URL}app-reader-mode.js?reader-deployment=${stamp}`, { headers: { 'cache-control': 'no-cache' } })
      ]);
      const [pageHtml, script] = await Promise.all([pageResponse.text(), scriptResponse.text()]);
      const ready = pageHtml.includes('app-reader-mode.js?v=20260802-1') && script.includes("TINGXIE_READER_MODE_VERSION = '20260802-1'");
      if (pageResponse.ok && scriptResponse.ok && ready) return;
      last = `page=${pageResponse.status}, script=${scriptResponse.status}, version=${ready}`;
    } catch (error) {
      last = error.message;
    }
    await new Promise(resolve => setTimeout(resolve, 10000));
  }
  throw new Error(`Reader-mode deployment did not appear. Last result: ${last}`);
}

async function installBrowserStubs(context) {
  await context.addInitScript(() => {
    window.__spokenItems = [];
    const randomValues = [0.05, 0.82, 0.24, 0.61, 0.13, 0.76];
    let randomIndex = 0;
    Math.random = () => randomValues[randomIndex++ % randomValues.length];

    class FakeUtterance {
      constructor(text) {
        this.text = text;
        this.lang = 'zh-CN';
        this.rate = 1;
        this.pitch = 1;
        this.volume = 1;
      }
    }

    Object.defineProperty(window, 'SpeechSynthesisUtterance', {
      value: FakeUtterance,
      configurable: true
    });

    Object.defineProperty(window, 'speechSynthesis', {
      value: {
        getVoices: () => [{ name: 'Test Mandarin', lang: 'zh-CN', localService: true }],
        speak: utterance => {
          window.__spokenItems.push({ text: utterance.text, rate: utterance.rate });
          setTimeout(() => utterance.onend?.(), 8);
        },
        cancel: () => {},
        onvoiceschanged: null
      },
      configurable: true
    });
  });
}

async function runReaderFlow(browser) {
  const context = await browser.newContext({ viewport: { width: 430, height: 932 } });
  await installBrowserStubs(context);
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', error => errors.push(`pageerror: ${error.stack || error.message}`));
  page.on('console', message => { if (message.type() === 'error') errors.push(`console: ${message.text()}`); });
  page.on('requestfailed', request => errors.push(`requestfailed: ${request.url()} :: ${request.failure()?.errorText}`));

  try {
    await page.goto(`${BASE_URL}?test=reader-mode&reader-check=${Date.now()}`, { waitUntil: 'networkidle' });
    await page.waitForFunction(() => document.documentElement.dataset.tingxieReaderMode === 'true');
    await page.waitForFunction(() => document.documentElement.dataset.tingxieEventsBound === 'true');

    assert.equal(await page.locator('.app-header .subtitle').innerText(), 'Prepare → Listen → Repeat');
    assert.equal(await page.locator('#setupTitle').innerText(), 'Prepare the reading list');
    assert.equal(await page.locator('#startDictationButton').innerText(), 'Start reading aloud');
    assert.equal(await page.locator('.step[data-step="marking"]').isHidden(), true);
    assert.equal(await page.locator('.step[data-step="review"]').isHidden(), true);
    assert.equal(await page.locator('#markingPanel').isHidden(), true);
    assert.equal(await page.locator('#reviewPanel').isHidden(), true);

    const rateOptions = await page.locator('#rateSelect option').evaluateAll(options => options.map(option => ({ text: option.textContent, value: option.value })));
    assert.deepEqual(rateOptions, [
      { text: 'Very slow', value: '0.38' },
      { text: 'Slow', value: '0.48' },
      { text: 'Normal', value: '0.65' },
      { text: 'Fast', value: '0.82' }
    ]);

    await page.locator('.settings-box summary').click();
    await page.locator('#rateSelect').selectOption('0.48');
    await page.locator('#wordList').fill(WORDS.join('\n'));
    await page.locator('#startDictationButton').click();
    await page.locator('#dictationPanel.active').waitFor();
    await page.waitForFunction(() => window.__spokenItems.length >= 1);

    const firstSpeech = await page.evaluate(() => window.__spokenItems[0]);
    assert.deepEqual(firstSpeech, { text: '浪费', rate: 0.48 });
    assert.equal(await page.locator('#shuffleReaderButton').isVisible(), true);
    assert.equal(await page.locator('#restartReaderButton').isVisible(), true);
    assert.equal(await page.locator('#sessionLabel').innerText(), 'Original order');

    await page.locator('#nextButton').click();
    await page.locator('#nextButton').click();
    await page.waitForFunction(() => window.__tingxieReaderMode.snapshot().currentIndex === 2);
    assert.equal(await page.locator('#dictationProgressText').innerText(), '3 of 4');

    const speechCountBeforeRestart = await page.evaluate(() => window.__spokenItems.length);
    await page.locator('#restartReaderButton').click();
    await page.waitForFunction(count => window.__spokenItems.length > count, speechCountBeforeRestart);
    assert.equal(await page.locator('#dictationProgressText').innerText(), '1 of 4');
    assert.equal((await page.evaluate(() => window.__tingxieReaderMode.snapshot())).currentIndex, 0);
    const restartedSpeech = await page.evaluate(() => window.__spokenItems.at(-1));
    assert.equal(restartedSpeech.text, '浪费');
    assert.equal(restartedSpeech.rate, 0.48);

    const originalOrder = (await page.evaluate(() => window.__tingxieReaderMode.snapshot())).words;
    const speechCountBeforeShuffle = await page.evaluate(() => window.__spokenItems.length);
    await page.locator('#shuffleReaderButton').click();
    await page.waitForFunction(count => window.__spokenItems.length > count, speechCountBeforeShuffle);
    const shuffledState = await page.evaluate(() => window.__tingxieReaderMode.snapshot());
    assert.equal(shuffledState.currentIndex, 0);
    assert.equal(shuffledState.shuffled, true);
    assert.notDeepEqual(shuffledState.words, originalOrder);
    assert.deepEqual([...shuffledState.words].sort(), [...WORDS].sort());
    assert.equal(await page.locator('#sessionLabel').innerText(), 'Shuffled order');

    while ((await page.evaluate(() => window.__tingxieReaderMode.snapshot())).currentIndex < WORDS.length - 1) {
      await page.locator('#nextButton').click();
    }
    assert.equal(await page.locator('#nextButton').innerText(), 'Finish ✓');
    await page.locator('#nextButton').click();
    await page.locator('#setupPanel.active').waitFor();
    assert.equal(await page.locator('#markingPanel').isHidden(), true);
    assert.equal((await page.evaluate(() => window.__tingxieReaderMode.snapshot())).panel, 'setup');
    assert.doesNotMatch(await page.locator('body').innerText(), /Mark the completed 听写/);

    assert.deepEqual(errors, []);
    await page.screenshot({ path: '/tmp/tingxie-reader-mode-pass.png', fullPage: true });
  } catch (error) {
    await page.screenshot({ path: '/tmp/tingxie-reader-mode-failure.png', fullPage: true }).catch(() => {});
    const state = await page.evaluate(() => ({
      readerReady: document.documentElement.dataset.tingxieReaderMode,
      panel: window.__tingxieReaderMode?.snapshot?.(),
      spoken: window.__spokenItems,
      rateOptions: Array.from(document.querySelectorAll('#rateSelect option')).map(option => ({ text: option.textContent, value: option.value })),
      visibleText: document.body.innerText
    })).catch(() => ({}));
    throw new Error(`${error.stack || error}\nBrowser errors:\n${errors.join('\n')}\nPage state:\n${JSON.stringify(state, null, 2)}`);
  } finally {
    await context.close();
  }
}

let browser;
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
  await runReaderFlow(browser);
  console.log(IS_LIVE ? 'TINGXIE_LIVE_READER_MODE_PASS' : 'TINGXIE_READER_MODE_PASS');
} catch (error) {
  const detail = error.stack || String(error);
  await fs.writeFile(FAILURE_LOG, detail, 'utf8');
  console.error(IS_LIVE ? 'TINGXIE_LIVE_READER_MODE_FAILURE' : 'TINGXIE_READER_MODE_FAILURE');
  console.error(detail);
  process.exitCode = 1;
} finally {
  await browser?.close();
  server?.kill('SIGTERM');
}
