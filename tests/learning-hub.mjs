import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';

const PORT = 4177;
const BASE_URL = `http://127.0.0.1:${PORT}`;
const FAILURE_LOG = '/tmp/learning-hub-error.txt';
const SCREENSHOT = '/tmp/learning-hub-pass.png';
const FAILURE_SCREENSHOT = '/tmp/learning-hub-failure.png';

const helperPaths = [
  'helpers.json',
  'helpers-extra.json',
  'helpers-metadata-clean-a.json',
  'helpers-metadata-clean-b.json',
  'helpers-metadata-clean-c.json',
  'helpers-metadata-clean-d.json',
  'helpers-metadata-clean-e.json',
  'helpers-coverage.json',
  'helper-overrides.json'
];

const server = spawn('python3', ['-m', 'http.server', String(PORT), '--directory', '.'], {
  stdio: ['ignore', 'pipe', 'pipe']
});

async function waitForServer() {
  const deadline = Date.now() + 15000;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(BASE_URL);
      if (response.ok) return;
    } catch {}
    await new Promise(resolve => setTimeout(resolve, 250));
  }
  throw new Error('Local test server did not start.');
}

let browser;
let context;
let page;
const browserErrors = [];

try {
  await waitForServer();
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

  await page.goto(`${BASE_URL}/`, { waitUntil: 'domcontentloaded' });
  assert.equal(await page.title(), 'KidoTree Learning Hub');
  assert.match(await page.locator('h1').innerText(), /Choose a learning app/);
  assert.equal(await page.locator('[data-app="flashcards"]').getAttribute('href'), 'flashcards/');
  assert.equal(await page.locator('[data-app="tingxie"]').getAttribute('href'), 'tingxie/');
  assert.equal(await page.locator('.app-card').count(), 2);

  await page.locator('[data-app="flashcards"]').click();
  await page.waitForURL(`${BASE_URL}/flashcards/`);
  assert.equal(await page.locator('h1').innerText(), 'Higher Chinese Flashcards');

  const helperStatuses = await page.evaluate(async paths => {
    return Promise.all(paths.map(async path => {
      const response = await fetch(`hcl-words/${path}`);
      return { path, status: response.status, ok: response.ok };
    }));
  }, helperPaths);
  assert.deepEqual(helperStatuses.filter(item => !item.ok), []);

  await page.goto(`${BASE_URL}/`, { waitUntil: 'domcontentloaded' });
  await page.locator('[data-app="tingxie"]').click();
  await page.waitForURL(`${BASE_URL}/tingxie/`);
  await page.waitForFunction(() => document.documentElement.dataset.tingxieEventsBound === 'true');
  await page.waitForFunction(() => document.documentElement.dataset.tingxieHubLink === 'true');
  const hubLink = page.locator('#learningHubLink');
  assert.equal(await hubLink.innerText(), '← All learning apps');
  assert.equal(await hubLink.getAttribute('href'), '../');

  await hubLink.click();
  await page.waitForURL(`${BASE_URL}/`);
  assert.equal(await page.title(), 'KidoTree Learning Hub');
  await page.screenshot({ path: SCREENSHOT, fullPage: true });

  console.log('LEARNING_HUB_LOCAL_PASS');
} catch (error) {
  await page?.screenshot({ path: FAILURE_SCREENSHOT, fullPage: true }).catch(() => {});
  const state = await page?.evaluate(() => ({
    url: location.href,
    title: document.title,
    text: document.body?.innerText?.slice(0, 1200),
    tingxieReady: document.documentElement.dataset.tingxieEventsBound,
    hubLink: document.documentElement.dataset.tingxieHubLink
  })).catch(() => ({}));
  const detail = `${error.stack || error}\nBrowser errors:\n${browserErrors.join('\n')}\nPage state:\n${JSON.stringify(state, null, 2)}`;
  await fs.writeFile(FAILURE_LOG, detail, 'utf8');
  console.error('LEARNING_HUB_LOCAL_FAILURE');
  console.error(detail);
  process.exitCode = 1;
} finally {
  await context?.close();
  await browser?.close();
  server.kill('SIGTERM');
}
