import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';

const PORT = 4182;
const LOCAL_BASE = `http://127.0.0.1:${PORT}/tingxie/`;
const BASE_URL = process.env.TINGXIE_BASE_URL || LOCAL_BASE;
const IS_LIVE = Boolean(process.env.TINGXIE_BASE_URL);
const FAILURE_LOG = '/tmp/tingxie-rate-scale-error.txt';
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
  throw new Error('Local rate-scale test server did not start.');
}

async function waitForLiveDeployment() {
  const deadline = Date.now() + 10 * 60 * 1000;
  let last = 'not checked';
  while (Date.now() < deadline) {
    try {
      const stamp = Date.now();
      const [pageResponse, bootResponse, rateResponse] = await Promise.all([
        fetch(`${BASE_URL}?rate-deployment=${stamp}`, { headers: { 'cache-control': 'no-cache' } }),
        fetch(`${BASE_URL}boot.js?rate-deployment=${stamp}`, { headers: { 'cache-control': 'no-cache' } }),
        fetch(`${BASE_URL}app-rate-scale-fix.js?rate-deployment=${stamp}`, { headers: { 'cache-control': 'no-cache' } })
      ]);
      const [page, boot, rate] = await Promise.all([pageResponse.text(), bootResponse.text(), rateResponse.text()]);
      const ready = page.includes('boot.js?v=20260802-3')
        && boot.includes("TINGXIE_BOOT_VERSION = '20260802-3'")
        && rate.includes("TINGXIE_RATE_SCALE_VERSION = '20260802-3'");
      if (pageResponse.ok && bootResponse.ok && rateResponse.ok && ready) return;
      last = `page=${pageResponse.status}, boot=${bootResponse.status}, rate=${rateResponse.status}, ready=${ready}`;
    } catch (error) {
      last = error.message;
    }
    await new Promise(resolve => setTimeout(resolve, 10000));
  }
  throw new Error(`Rate-scale deployment did not appear. Last result: ${last}`);
}

async function installStubs(context) {
  await context.addInitScript(() => {
    localStorage.setItem('tingxie:settings:v1', JSON.stringify({ rate: '0.48', repeat: '1', commandLanguage: 'en-SG' }));
    localStorage.setItem('tingxie:readerRateScale:v2', '1');
    localStorage.removeItem('tingxie:readerRateScale:v3');
    window.__spokenRates = [];

    class FakeUtterance {
      constructor(text) {
        this.text = text;
        this.lang = 'zh-CN';
        this.rate = 1;
        this.pitch = 1;
        this.volume = 1;
      }
    }
    Object.defineProperty(window, 'SpeechSynthesisUtterance', { value: FakeUtterance, configurable: true });
    Object.defineProperty(window, 'speechSynthesis', {
      configurable: true,
      value: {
        getVoices: () => [{ name: 'Test Mandarin', lang: 'zh-CN', localService: true }],
        speak: utterance => {
          window.__spokenRates.push({ text: utterance.text, rate: utterance.rate });
          setTimeout(() => utterance.onend?.(), 5);
        },
        cancel: () => {},
        onvoiceschanged: null
      }
    });
  });
}

async function runRateTest(browser) {
  const context = await browser.newContext({ viewport: { width: 430, height: 932 } });
  await installStubs(context);
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', error => errors.push(`pageerror: ${error.stack || error.message}`));
  page.on('console', message => { if (message.type() === 'error') errors.push(`console: ${message.text()}`); });
  page.on('requestfailed', request => errors.push(`requestfailed: ${request.url()} :: ${request.failure()?.errorText}`));

  try {
    await page.goto(`${BASE_URL}?test=rate-scale&rate=${Date.now()}`, { waitUntil: 'networkidle' });
    await page.waitForFunction(() => document.documentElement.dataset.tingxieRateScale === 'true');
    await page.waitForFunction(() => document.documentElement.dataset.tingxieHubLinkPlacement === 'top');

    const options = await page.locator('#rateSelect option').evaluateAll(items => items.map(item => ({ text: item.textContent, value: item.value })));
    assert.deepEqual(options, [
      { text: 'Very slow', value: '0.24' },
      { text: 'Slow', value: '0.32' },
      { text: 'Normal', value: '0.48' },
      { text: 'Fast', value: '0.65' }
    ]);
    assert.equal(await page.locator('#rateSelect').inputValue(), '0.32');

    const hubLink = page.locator('#learningHubLink');
    assert.equal(await hubLink.innerText(), '🏠 Learning apps');
    assert.equal(await hubLink.evaluate(element => getComputedStyle(element).position), 'static');
    assert.equal(await hubLink.evaluate(element => element.parentElement?.matches('.app-header > div')), true);

    await page.locator('.settings-box summary').click();
    await page.locator('#rateSelect').selectOption('0.32');
    await page.locator('#wordList').fill('浪费\n组屋');
    await page.locator('#startDictationButton').click();
    await page.locator('#dictationPanel.active').waitFor();
    await page.waitForFunction(() => window.__spokenRates.length > 0);
    assert.deepEqual(await page.evaluate(() => window.__spokenRates[0]), { text: '浪费', rate: 0.32 });

    assert.deepEqual(errors, []);
    await page.screenshot({ path: '/tmp/tingxie-rate-scale-pass.png', fullPage: true });
  } catch (error) {
    await page.screenshot({ path: '/tmp/tingxie-rate-scale-failure.png', fullPage: true }).catch(() => {});
    const state = await page.evaluate(() => ({
      rateReady: document.documentElement.dataset.tingxieRateScale,
      hubPlacement: document.documentElement.dataset.tingxieHubLinkPlacement,
      options: Array.from(document.querySelectorAll('#rateSelect option')).map(option => ({ text: option.textContent, value: option.value })),
      selected: document.querySelector('#rateSelect')?.value,
      spoken: window.__spokenRates,
      status: document.querySelector('#tingxieCloudStatus')?.textContent
    })).catch(() => ({}));
    throw new Error(`${error.stack || error}\nBrowser errors:\n${errors.join('\n')}\nPage state:\n${JSON.stringify(state, null, 2)}`);
  } finally {
    await context.close();
  }
}

let browser;
try {
  if (IS_LIVE) await waitForLiveDeployment();
  else {
    server = spawn('python3', ['-m', 'http.server', String(PORT), '--directory', '.'], { stdio: ['ignore', 'pipe', 'pipe'] });
    await waitForLocalServer();
  }
  browser = await chromium.launch({ headless: true });
  await runRateTest(browser);
  console.log(IS_LIVE ? 'TINGXIE_LIVE_RATE_SCALE_PASS' : 'TINGXIE_RATE_SCALE_PASS');
} catch (error) {
  const detail = error.stack || String(error);
  await fs.writeFile(FAILURE_LOG, detail, 'utf8');
  console.error(IS_LIVE ? 'TINGXIE_LIVE_RATE_SCALE_FAILURE' : 'TINGXIE_RATE_SCALE_FAILURE');
  console.error(detail);
  process.exitCode = 1;
} finally {
  await browser?.close();
  server?.kill('SIGTERM');
}
