import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';

const PORT = 4178;
const LOCAL_BASE = `http://127.0.0.1:${PORT}/tingxie/`;
const BASE_URL = process.env.TINGXIE_BASE_URL || LOCAL_BASE;
const IS_LIVE = Boolean(process.env.TINGXIE_BASE_URL);
const FAILURE_LOG = '/tmp/tingxie-profile-memory-error.txt';
const LIST_WORDS = [
  '老虎', '狮子', '旗子', '华族', '兴奋', '弯月',
  '国庆日', '亮晶晶', '五颗星', '一座山', '世界地图'
];

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
  throw new Error('Local profile-memory test server did not start.');
}

async function waitForLiveDeployment() {
  const deadline = Date.now() + 10 * 60 * 1000;
  let last = 'not checked';
  while (Date.now() < deadline) {
    try {
      const stamp = Date.now();
      const [bootResponse, memoryResponse] = await Promise.all([
        fetch(`${BASE_URL}boot.js?memory-deployment=${stamp}`, { headers: { 'cache-control': 'no-cache' } }),
        fetch(`${BASE_URL}app-profile-memory.js?memory-deployment=${stamp}`, { headers: { 'cache-control': 'no-cache' } })
      ]);
      const [boot, memory] = await Promise.all([bootResponse.text(), memoryResponse.text()]);
      const ready = boot.includes('20260722-1') && memory.includes("TINGXIE_MEMORY_VERSION = '20260722-1'");
      if (bootResponse.ok && memoryResponse.ok && ready) return;
      last = `boot=${bootResponse.status}, memory=${memoryResponse.status}, version=${ready}`;
    } catch (error) {
      last = error.message;
    }
    await new Promise(resolve => setTimeout(resolve, 10000));
  }
  throw new Error(`Profile-memory deployment did not appear. Last result: ${last}`);
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
    Object.defineProperty(window, 'SpeechSynthesisUtterance', {
      value: FakeUtterance,
      configurable: true
    });
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

async function openFreshPage(browser) {
  const context = await browser.newContext({ viewport: { width: 430, height: 932 } });
  await installSpeechStubs(context);
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', error => errors.push(`pageerror: ${error.stack || error.message}`));
  page.on('console', message => { if (message.type() === 'error') errors.push(`console: ${message.text()}`); });
  page.on('requestfailed', request => errors.push(`requestfailed: ${request.url()} :: ${request.failure()?.errorText}`));
  await page.goto(`${BASE_URL}?test=deterministic&profile-memory=${Date.now()}`, { waitUntil: 'networkidle' });
  await page.waitForFunction(() => document.documentElement.dataset.tingxieProfileMemory === 'true');
  return { context, page, errors };
}

async function saveOneList(page, word) {
  await page.locator('#wordList').fill(word);
  await page.locator('#startDictationButton').click();
  await page.locator('#dictationPanel.active').waitFor();
  await page.locator('#exitDictationButton').click();
  await page.locator('#setupPanel.active').waitFor();
}

async function addNamedProfile(page, name) {
  page.once('dialog', dialog => dialog.accept(name));
  await page.locator('#addProfileButton').click();
  await page.waitForFunction(expected => document.querySelector('#memoryProfileSelect')?.selectedOptions[0]?.textContent === expected, name);
}

async function runProfileMemoryFlow(browser) {
  const { context, page, errors } = await openFreshPage(browser);
  try {
    assert.equal(await page.locator('#memoryProfileSelect').inputValue(), (await page.evaluate(() => window.__tingxieProfileMemory.activeProfile())).id);
    assert.equal(await page.locator('#memoryProfileSelect option:checked').innerText(), 'Child 1');
    assert.equal(await page.locator('#memoryListCount').innerText(), '0/10 saved');

    for (let index = 0; index < LIST_WORDS.length; index += 1) {
      await saveOneList(page, LIST_WORDS[index]);
      if (index < LIST_WORDS.length - 1) {
        await page.locator('#newMemoryListButton').click();
        await page.locator('#wordList').waitFor();
        assert.equal(await page.locator('#wordList').inputValue(), '');
      }
    }

    assert.equal(await page.locator('#memoryListCount').innerText(), '10/10 saved');
    const childOneSnapshot = await page.evaluate(() => window.__tingxieProfileMemory.activeProfile());
    assert.equal(childOneSnapshot.lists.length, 10);
    assert.equal(childOneSnapshot.lists.some(list => list.words.includes('老虎')), false);
    assert.equal(childOneSnapshot.lists.some(list => list.words.includes('世界地图')), true);

    await addNamedProfile(page, 'Child 2');
    assert.equal(await page.locator('#wordList').inputValue(), '');
    assert.equal(await page.locator('#memoryListCount').innerText(), '0/10 saved');

    await saveOneList(page, '苹果\n香蕉');
    await page.evaluate(() => {
      saveHistory({
        date: new Date().toISOString(),
        mode: 'full',
        correct: 1,
        total: 2,
        mistakes: ['香蕉']
      });
      renderHistory();
    });
    assert.match(await page.locator('#historyList').innerText(), /1\/2/);

    await page.locator('#memoryProfileSelect').selectOption({ label: 'Child 1' });
    await page.waitForFunction(() => document.querySelector('#memoryProfileSelect')?.selectedOptions[0]?.textContent === 'Child 1');
    assert.equal(await page.locator('#memoryListCount').innerText(), '10/10 saved');
    assert.match(await page.locator('#historyList').innerText(), /No saved practice sessions for Child 1/);

    await page.locator('#memoryProfileSelect').selectOption({ label: 'Child 2' });
    await page.waitForFunction(() => document.querySelector('#memoryProfileSelect')?.selectedOptions[0]?.textContent === 'Child 2');
    assert.equal(await page.locator('#memoryListCount').innerText(), '1/10 saved');
    assert.equal(await page.locator('#wordList').inputValue(), '苹果\n香蕉');
    assert.match(await page.locator('#historyList').innerText(), /1\/2/);

    await page.reload({ waitUntil: 'networkidle' });
    await page.waitForFunction(() => document.documentElement.dataset.tingxieProfileMemory === 'true');
    assert.equal(await page.locator('#memoryProfileSelect option:checked').innerText(), 'Child 2');
    assert.equal(await page.locator('#wordList').inputValue(), '苹果\n香蕉');
    assert.equal(await page.locator('#memoryListCount').innerText(), '1/10 saved');

    await addNamedProfile(page, 'Child 3');
    await addNamedProfile(page, 'Child 4');
    await addNamedProfile(page, 'Child 5');
    assert.equal(await page.locator('#addProfileButton').isDisabled(), true);
    const snapshot = await page.evaluate(() => window.__tingxieProfileMemory.snapshot());
    assert.equal(snapshot.profiles.length, 5);

    assert.deepEqual(errors, []);
    await page.screenshot({ path: '/tmp/tingxie-profile-memory-pass.png', fullPage: true });
  } catch (error) {
    await page.screenshot({ path: '/tmp/tingxie-profile-memory-failure.png', fullPage: true }).catch(() => {});
    const state = await page.evaluate(() => ({
      memoryReady: document.documentElement.dataset.tingxieProfileMemory,
      selectedProfile: document.querySelector('#memoryProfileSelect')?.selectedOptions[0]?.textContent,
      selectedList: document.querySelector('#memoryListSelect')?.selectedOptions[0]?.textContent,
      listCount: document.querySelector('#memoryListCount')?.textContent,
      words: document.querySelector('#wordList')?.value,
      status: document.querySelector('#profileMemoryStatus')?.textContent,
      memory: window.__tingxieProfileMemory?.snapshot?.()
    })).catch(() => ({}));
    throw new Error(`${error.stack || error}\nBrowser errors:\n${errors.join('\n')}\nPage state:\n${JSON.stringify(state, null, 2)}`);
  } finally {
    await context.close();
  }
}

async function runLegacyMigration(browser) {
  const { context, page, errors } = await openFreshPage(browser);
  try {
    await page.evaluate(() => {
      localStorage.clear();
      localStorage.setItem('tingxie:profile:v1', 'Legacy Child');
      localStorage.setItem('tingxie:lastList:v1', JSON.stringify({
        profile: 'Legacy Child',
        words: ['浪费', '组屋'],
        savedAt: '2026-07-01T00:00:00.000Z'
      }));
      localStorage.setItem('tingxie:history:v1', JSON.stringify([{
        profile: 'Legacy Child',
        date: '2026-07-02T00:00:00.000Z',
        mode: 'full',
        correct: 2,
        total: 2,
        mistakes: []
      }]));
    });
    await page.reload({ waitUntil: 'networkidle' });
    await page.waitForFunction(() => document.documentElement.dataset.tingxieProfileMemory === 'true');
    assert.equal(await page.locator('#memoryProfileSelect option:checked').innerText(), 'Legacy Child');
    assert.equal(await page.locator('#wordList').inputValue(), '浪费\n组屋');
    assert.equal(await page.locator('#memoryListCount').innerText(), '1/10 saved');
    assert.match(await page.locator('#historyList').innerText(), /2\/2/);
    assert.deepEqual(errors, []);
    await page.screenshot({ path: '/tmp/tingxie-profile-memory-migration-pass.png', fullPage: true });
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
  await runProfileMemoryFlow(browser);
  await runLegacyMigration(browser);
  console.log(IS_LIVE ? 'TINGXIE_LIVE_PROFILE_MEMORY_PASS' : 'TINGXIE_PROFILE_MEMORY_PASS');
} catch (error) {
  const detail = error.stack || String(error);
  await fs.writeFile(FAILURE_LOG, detail, 'utf8');
  console.error(IS_LIVE ? 'TINGXIE_LIVE_PROFILE_MEMORY_FAILURE' : 'TINGXIE_PROFILE_MEMORY_FAILURE');
  console.error(detail);
  process.exitCode = 1;
} finally {
  await browser?.close();
  server?.kill('SIGTERM');
}
