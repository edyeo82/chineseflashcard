import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';

const PORT = 4181;
const LOCAL_BASE = `http://127.0.0.1:${PORT}/tingxie/`;
const BASE_URL = process.env.TINGXIE_BASE_URL || LOCAL_BASE;
const IS_LIVE = Boolean(process.env.TINGXIE_BASE_URL);
const FAILURE_LOG = '/tmp/tingxie-word-checklist-error.txt';
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
  throw new Error('Local word-checklist test server did not start.');
}

async function waitForLiveDeployment() {
  const deadline = Date.now() + 10 * 60 * 1000;
  let last = 'not checked';
  while (Date.now() < deadline) {
    try {
      const stamp = Date.now();
      const [pageResponse, bootResponse, scriptResponse] = await Promise.all([
        fetch(`${BASE_URL}?checklist-deployment=${stamp}`, { headers: { 'cache-control': 'no-cache' } }),
        fetch(`${BASE_URL}boot.js?checklist-deployment=${stamp}`, { headers: { 'cache-control': 'no-cache' } }),
        fetch(`${BASE_URL}app-word-checklist-voice.js?checklist-deployment=${stamp}`, { headers: { 'cache-control': 'no-cache' } })
      ]);
      const [pageHtml, boot, script] = await Promise.all([pageResponse.text(), bootResponse.text(), scriptResponse.text()]);
      const ready = pageHtml.includes('boot.js?v=20260802-3')
        && boot.includes("TINGXIE_BOOT_VERSION = '20260802-3'")
        && script.includes("TINGXIE_WORD_CHECKLIST_VERSION = '20260802-2'");
      if (pageResponse.ok && bootResponse.ok && scriptResponse.ok && ready) return;
      last = `page=${pageResponse.status}, boot=${bootResponse.status}, script=${scriptResponse.status}, version=${ready}`;
    } catch (error) {
      last = error.message;
    }
    await new Promise(resolve => setTimeout(resolve, 10000));
  }
  throw new Error(`Word-checklist deployment did not appear. Last result: ${last}`);
}

async function installBrowserStubs(context) {
  await context.addInitScript(() => {
    window.__spokenItems = [];
    const voices = [
      { name: 'Sin-Ji Cantonese', lang: 'zh-HK', localService: true },
      { name: 'Ting-Ting', lang: 'zh-CN', localService: true },
      { name: 'Cloud Mandarin', lang: 'zh-CN', localService: false },
      { name: 'Mei-Jia', lang: 'zh-TW', localService: true },
      { name: 'English Voice', lang: 'en-US', localService: true }
    ];

    class FakeUtterance {
      constructor(text) {
        this.text = text;
        this.lang = 'zh-CN';
        this.rate = 1;
        this.pitch = 1;
        this.volume = 1;
        this.voice = null;
      }
    }

    Object.defineProperty(window, 'SpeechSynthesisUtterance', {
      value: FakeUtterance,
      configurable: true
    });

    Object.defineProperty(window, 'speechSynthesis', {
      configurable: true,
      value: {
        getVoices: () => voices,
        speak: utterance => {
          window.__spokenItems.push({
            text: utterance.text,
            rate: utterance.rate,
            voiceName: utterance.voice?.name || '',
            lang: utterance.lang
          });
          setTimeout(() => {
            utterance.onstart?.();
            utterance.onend?.();
          }, 5);
        },
        cancel: () => {},
        onvoiceschanged: null
      }
    });
  });
}

function rowFor(page, word) {
  return page.locator('.word-checklist-row').filter({ hasText: word }).first();
}

async function runChecklistFlow(browser) {
  const context = await browser.newContext({ viewport: { width: 430, height: 932 } });
  await installBrowserStubs(context);
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', error => errors.push(`pageerror: ${error.stack || error.message}`));
  page.on('console', message => { if (message.type() === 'error') errors.push(`console: ${message.text()}`); });
  page.on('requestfailed', request => errors.push(`requestfailed: ${request.url()} :: ${request.failure()?.errorText}`));

  try {
    await page.goto(`${BASE_URL}?test=word-checklist&checklist=${Date.now()}`, { waitUntil: 'networkidle' });
    await page.waitForFunction(() => document.documentElement.dataset.tingxieWordChecklist === 'true');
    await page.waitForFunction(() => document.documentElement.dataset.tingxieProfileMemory === 'true');
    await page.waitForFunction(() => document.documentElement.dataset.tingxieHubLinkPlacement === 'top');

    assert.equal(await page.locator('#learningHubLink').innerText(), '← Learning apps');
    assert.equal(await page.locator('#learningHubLink').getAttribute('href'), '../');
    assert.equal(await page.locator('#learningHubLink').isVisible(), true);

    await page.locator('.settings-box').evaluate(element => { element.open = true; });
    const voiceLabels = await page.locator('#voiceSelect option').allInnerTexts();
    assert.equal(voiceLabels.some(label => /Sin-Ji|zh-HK/.test(label)), false);
    assert.match(voiceLabels[0], /Recommended.*Ting-Ting.*zh-CN.*device/i);
    assert.equal(voiceLabels.some(label => /Cloud Mandarin.*online/i.test(label)), true);

    await page.locator('#wordList').fill(WORDS.join('\n'));
    await page.waitForFunction(() => document.querySelectorAll('.word-checklist-row').length === 4);
    assert.equal(await page.locator('#wordCount').innerText(), '4 items');
    assert.equal(await page.locator('#wordChecklistSummary').innerText(), '4 active · 0 skipped');

    const onePortionRow = rowFor(page, '一份');
    const onePortionCheckbox = onePortionRow.locator('input[type="checkbox"]');
    await onePortionCheckbox.check();
    assert.equal(await onePortionCheckbox.isChecked(), true);
    assert.equal(await onePortionRow.evaluate(element => element.classList.contains('skipped')), true);
    assert.match(await onePortionRow.innerText(), /Skipped/);
    assert.equal(await page.locator('#wordChecklistSummary').innerText(), '3 active · 1 skipped');
    assert.equal((await page.locator('#wordList').inputValue()).includes('一份'), true);

    await page.locator('#saveMemoryListButton').click();
    await page.waitForFunction(() => window.__tingxieProfileMemory?.activeProfile?.().activeListId);
    const savedBeforeReload = await page.evaluate(() => window.__tingxieProfileMemory.activeProfile());
    assert.equal(savedBeforeReload.lists.length, 1);
    assert.equal(savedBeforeReload.lists[0].words.includes('一份'), true);

    await page.reload({ waitUntil: 'networkidle' });
    await page.waitForFunction(() => document.documentElement.dataset.tingxieWordChecklist === 'true');
    await page.waitForFunction(() => document.querySelectorAll('.word-checklist-row').length === 4);
    const reloadedRow = rowFor(page, '一份');
    assert.equal(await reloadedRow.locator('input[type="checkbox"]').isChecked(), true);
    assert.equal(await reloadedRow.evaluate(element => element.classList.contains('skipped')), true);
    assert.equal(await page.locator('#wordChecklistSummary').innerText(), '3 active · 1 skipped');
    assert.equal((await page.locator('#wordList').inputValue()).includes('一份'), true);

    await page.locator('.settings-box').evaluate(element => { element.open = true; });
    await page.locator('#recommendedVoiceButton').click();
    await page.waitForFunction(() => window.__spokenItems.length >= 1);
    const preview = await page.evaluate(() => window.__spokenItems.at(-1));
    assert.equal(preview.voiceName, 'Ting-Ting');
    assert.equal(preview.lang, 'zh-CN');
    assert.equal(preview.text, '浪费');

    await page.locator('#startDictationButton').click();
    await page.locator('#dictationPanel.active').waitFor();
    const firstSession = await page.evaluate(() => window.__tingxieReaderMode.snapshot());
    assert.deepEqual(firstSession.words, ['浪费', '组屋', '停车场']);
    assert.equal(firstSession.words.includes('一份'), false);

    await page.locator('#exitDictationButton').click();
    await page.locator('#setupPanel.active').waitFor();
    await rowFor(page, '一份').locator('input[type="checkbox"]').uncheck();
    assert.equal(await page.locator('#wordChecklistSummary').innerText(), '4 active · 0 skipped');
    await page.locator('#startDictationButton').click();
    await page.locator('#dictationPanel.active').waitFor();
    const secondSession = await page.evaluate(() => window.__tingxieReaderMode.snapshot());
    assert.deepEqual(secondSession.words, WORDS);

    assert.deepEqual(errors, []);
    await page.screenshot({ path: '/tmp/tingxie-word-checklist-pass.png', fullPage: true });
  } catch (error) {
    await page.screenshot({ path: '/tmp/tingxie-word-checklist-failure.png', fullPage: true }).catch(() => {});
    const state = await page.evaluate(() => ({
      ready: document.documentElement.dataset.tingxieWordChecklist,
      words: document.querySelector('#wordList')?.value,
      summary: document.querySelector('#wordChecklistSummary')?.textContent,
      count: document.querySelector('#wordCount')?.textContent,
      rows: Array.from(document.querySelectorAll('.word-checklist-row')).map(row => ({
        text: row.textContent,
        checked: row.querySelector('input')?.checked,
        skipped: row.classList.contains('skipped')
      })),
      voices: Array.from(document.querySelectorAll('#voiceSelect option')).map(option => option.textContent),
      selectedVoice: document.querySelector('#voiceSelect')?.selectedOptions[0]?.textContent,
      spoken: window.__spokenItems,
      memory: window.__tingxieProfileMemory?.snapshot?.(),
      context: window.__tingxieWordChecklist?.context?.(),
      hubText: document.querySelector('#learningHubLink')?.textContent
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
  await runChecklistFlow(browser);
  console.log(IS_LIVE ? 'TINGXIE_LIVE_WORD_CHECKLIST_PASS' : 'TINGXIE_WORD_CHECKLIST_PASS');
} catch (error) {
  const detail = error.stack || String(error);
  await fs.writeFile(FAILURE_LOG, detail, 'utf8');
  console.error(IS_LIVE ? 'TINGXIE_LIVE_WORD_CHECKLIST_FAILURE' : 'TINGXIE_WORD_CHECKLIST_FAILURE');
  console.error(detail);
  process.exitCode = 1;
} finally {
  await browser?.close();
  server?.kill('SIGTERM');
}
