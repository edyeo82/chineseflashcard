import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';

const PORT = 4188;
const LOCAL_BASE = `http://127.0.0.1:${PORT}/tingxie/`;
const BASE_URL = process.env.TINGXIE_BASE_URL || LOCAL_BASE;
const IS_LIVE = Boolean(process.env.TINGXIE_BASE_URL);
const FAMILY = 'friendlyfamv2';
const FAILURE_LOG = '/tmp/tingxie-friendly-ux-v2-error.txt';
const REMOTE_KEY = `publicUsers/${FAMILY}/children/TingXie/profile/memory`;
const remote = new Map();
let server = null;

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

async function waitForLocalServer() {
  const deadline = Date.now() + 15000;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(LOCAL_BASE);
      if (response.ok) return;
    } catch {}
    await sleep(200);
  }
  throw new Error('Local friendly UX server did not start.');
}

async function waitForLiveDeployment() {
  const deadline = Date.now() + 10 * 60 * 1000;
  let last = 'not checked';
  while (Date.now() < deadline) {
    try {
      const stamp = Date.now();
      const [bootResponse, uxResponse, finalResponse, syncResponse] = await Promise.all([
        fetch(`${BASE_URL}boot.js?friendly-v2=${stamp}`, { headers: { 'cache-control': 'no-cache' } }),
        fetch(`${BASE_URL}app-friendly-ux.js?friendly-v2=${stamp}`, { headers: { 'cache-control': 'no-cache' } }),
        fetch(`${BASE_URL}app-friendly-final-polish.js?friendly-v2=${stamp}`, { headers: { 'cache-control': 'no-cache' } }),
        fetch(`${BASE_URL}app-family-sync-simple.js?friendly-v2=${stamp}`, { headers: { 'cache-control': 'no-cache' } })
      ]);
      const [boot, ux, finalPolish, sync] = await Promise.all([
        bootResponse.text(), uxResponse.text(), finalResponse.text(), syncResponse.text()
      ]);
      const ready = boot.includes("app-friendly-ux.js?v=20260810-1")
        && boot.includes("app-friendly-final-polish.js?v=20260810-1")
        && boot.includes("app-family-sync-simple.js?v=20260810-1")
        && ux.includes("TINGXIE_FRIENDLY_UX_VERSION = '20260810-1'")
        && finalPolish.includes("TINGXIE_FRIENDLY_FINAL_VERSION = '20260810-1'")
        && sync.includes("TINGXIE_SIMPLE_SYNC_VERSION = '20260810-1'");
      if (bootResponse.ok && uxResponse.ok && finalResponse.ok && syncResponse.ok && ready) return;
      last = `boot=${bootResponse.status}, ux=${uxResponse.status}, final=${finalResponse.status}, sync=${syncResponse.status}, ready=${ready}`;
    } catch (error) {
      last = error.message;
    }
    await sleep(10000);
  }
  throw new Error(`Friendly UX deployment did not appear. Last result: ${last}`);
}

async function waitUntil(label, predicate, timeout = 12000) {
  const deadline = Date.now() + timeout;
  let lastError = null;
  while (Date.now() < deadline) {
    try {
      if (await predicate()) return;
    } catch (error) {
      lastError = error;
    }
    await sleep(100);
  }
  throw new Error(`Timed out waiting for ${label}${lastError ? `: ${lastError.message}` : ''}`);
}

async function installStubs(context, startSynced = false) {
  await context.exposeFunction('__friendlyV2CloudRead', async path => {
    const value = remote.get(path.join('/'));
    return value ? structuredClone(value) : null;
  });
  await context.exposeFunction('__friendlyV2CloudWrite', async (path, payload) => {
    remote.set(path.join('/'), structuredClone(payload));
    return true;
  });

  await context.addInitScript(({ family, startSynced }) => {
    if (startSynced) {
      localStorage.setItem('hcl:saveMode', 'username');
      localStorage.setItem('hcl:simpleUsername', family);
    } else {
      localStorage.setItem('hcl:saveMode', 'guest');
      localStorage.removeItem('hcl:simpleUsername');
    }

    window.__nativePromptCalls = [];
    window.__nativeConfirmCalls = [];
    window.__shareCalls = [];
    window.prompt = (...args) => { window.__nativePromptCalls.push(args); return null; };
    window.confirm = (...args) => { window.__nativeConfirmCalls.push(args); return false; };
    Object.defineProperty(navigator, 'share', {
      configurable: true,
      value: async data => { window.__shareCalls.push(data); }
    });

    window.__tingxieCloudTestAdapter = {
      readDoc: path => window.__friendlyV2CloudRead(path),
      writeDoc: (path, payload) => window.__friendlyV2CloudWrite(path, payload)
    };

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
  }, { family: FAMILY, startSynced });
}

async function openFriendlyPage(browser, startSynced = false, viewport = { width: 1055, height: 900 }) {
  const context = await browser.newContext({ viewport });
  await installStubs(context, startSynced);
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', error => errors.push(`pageerror: ${error.stack || error.message}`));
  page.on('console', message => { if (message.type() === 'error') errors.push(`console: ${message.text()}`); });
  page.on('requestfailed', request => {
    const text = request.failure()?.errorText || '';
    // A single ERR_ABORTED can be the intentional location.reload after applying cloud data.
    if (!/ERR_ABORTED/i.test(text)) errors.push(`requestfailed: ${request.url()} :: ${text}`);
  });

  await page.goto(`${BASE_URL}?test=friendly-ux&friendly-v2=${Date.now()}`, { waitUntil: 'domcontentloaded' });
  await waitUntil('friendly modules after any sync reload', async () => page.evaluate(() =>
    window.__tingxieFriendlyUx?.active === true
    && window.__tingxieFriendlyFinalPolish?.version === '20260810-1'
    && window.__tingxieSimpleFamilySync?.version === '20260810-1'
    && document.documentElement.dataset.tingxieProfileMemory === 'true'
  ), 18000);
  return { context, page, errors };
}

async function fillActionSheet(page, value) {
  await page.locator('#friendlyActionOverlay').waitFor({ state: 'visible', timeout: 5000 });
  await page.locator('#friendlyActionInput').fill(value);
  await page.locator('#friendlyActionConfirm').click();
  await page.locator('#friendlyActionOverlay').waitFor({ state: 'hidden', timeout: 5000 });
}

function wordRow(page, word) {
  return page.locator('.word-checklist-row').filter({ hasText: word }).first();
}

async function waitRemote(predicate, label, timeout = 8000) {
  await waitUntil(label, async () => predicate(remote.get(REMOTE_KEY)), timeout);
  return remote.get(REMOTE_KEY);
}

async function runFirstDevice(browser) {
  console.log('FRIENDLY_V2_FIRST_DEVICE_START');
  const { context, page, errors } = await openFriendlyPage(browser, false);
  try {
    assert.equal(await page.locator('label[for="sourceImage"]').isVisible(), false);
    assert.equal(await page.locator('#scanSourceButton').isVisible(), false);
    assert.equal(await page.locator('.in-browser-camera-button:visible').count(), 0);
    assert.equal(await page.evaluate(() => Boolean(document.querySelector('script[data-tingxie-ocr-accuracy]'))), false);
    assert.equal(await page.evaluate(() => document.documentElement.dataset.tingxieBrowserOcr), 'retired');

    const hub = page.locator('#learningHubLink');
    assert.equal(await hub.innerText(), '← Learning apps');
    assert.equal(await hub.evaluate(element => getComputedStyle(element).position), 'static');

    const syncText = await page.locator('#tingxieCloudSyncBox').innerText();
    assert.match(syncText, /Family username/i);
    assert.match(syncText, /save automatically/i);
    assert.doesNotMatch(syncText, /Google|Sign in|Create account|Copy this browser|Reload from cloud/i);
    assert.equal(await page.locator('#tingxieCloudSyncBox').getAttribute('open'), '');

    await page.locator('#renameProfileButton').click();
    await fillActionSheet(page, 'Dave');

    await page.locator('#wordList').fill(['浪费', '组屋', '一份', '停车场'].join('\n'));
    await waitUntil('four learned-word rows', async () => page.locator('.word-checklist-row').count().then(count => count === 4));
    assert.equal(await page.locator('.word-checklist-heading strong').innerText(), 'Words your child has learned');
    assert.match(await page.locator('.word-checklist-heading p').innerText(), /Tick a word after your child knows it/i);
    assert.equal(await page.locator('#enableAllWordsButton').innerText(), 'Practise all');
    assert.equal(await page.locator('#skipAllWordsButton').innerText(), 'Mark all learned');

    const learned = wordRow(page, '一份');
    await learned.locator('input[type="checkbox"]').check();
    await waitUntil('learned grey state', async () => learned.evaluate(row =>
      row.classList.contains('learned')
      && row.querySelector('.word-checklist-status')?.textContent.includes('Learned')
      && Number.parseFloat(getComputedStyle(row).opacity) < 0.8
    ));
    assert.equal(await page.locator('#wordChecklistSummary').innerText(), '1 learned · 3 to practise');

    await page.locator('#saveMemoryListButton').click();
    await waitUntil('saved Dave list', async () => page.evaluate(() => window.__tingxieProfileMemory?.activeProfile?.().lists?.length === 1));

    await page.locator('#tingxieUsernameInput').fill(FAMILY);
    await page.locator('#tingxieUsernameMode').click();
    await waitUntil('family username mode', async () => page.evaluate(() => window.__tingxieSimpleFamilySync?.mode?.() === 'username'));
    let cloud = await waitRemote(value => value?.memory?.profiles?.some(profile => profile.name === 'Dave'), 'initial automatic family upload');
    assert.equal(Object.keys(cloud.checklist || {}).length > 0, true);

    await page.locator('#addProfileButton').click();
    await fillActionSheet(page, 'Kate');
    await waitRemote(value => value?.memory?.profiles?.length === 2, 'automatic upload after adding Kate');

    await page.locator('#memoryProfileSelect').selectOption({ label: 'Dave' });
    await waitUntil('Dave selected', async () => page.locator('#memoryProfileSelect option:checked').innerText().then(text => text === 'Dave'));
    await page.locator('#shareClassPackButton').click();
    await waitUntil('class pack share', async () => page.evaluate(() => window.__shareCalls.length === 1));
    const share = await page.evaluate(() => window.__shareCalls[0]);
    assert.match(share.url, /#classpack=/);

    await page.locator('#memoryProfileSelect').selectOption({ label: 'Kate' });
    await page.locator('#deleteProfileButton').click();
    await page.locator('#friendlyActionOverlay').waitFor({ state: 'visible', timeout: 5000 });
    await page.locator('#friendlyActionConfirm').click();
    await page.locator('#friendlyActionOverlay').waitFor({ state: 'hidden', timeout: 5000 });
    cloud = await waitRemote(value => value?.memory?.profiles?.length === 1 && value.memory.profiles[0].name === 'Dave', 'automatic upload after deleting Kate');
    assert.equal(cloud.memory.profiles[0].lists.length, 1);

    const nativeDialogs = await page.evaluate(() => ({ prompt: window.__nativePromptCalls, confirm: window.__nativeConfirmCalls }));
    assert.deepEqual(nativeDialogs.prompt, []);
    assert.deepEqual(nativeDialogs.confirm, []);
    assert.deepEqual(errors, []);
    await page.screenshot({ path: '/tmp/tingxie-friendly-v2-first-pass.png', fullPage: true });
    console.log('FRIENDLY_V2_FIRST_DEVICE_PASS');
  } finally {
    await context.close();
  }
}

async function runSecondDevice(browser) {
  console.log('FRIENDLY_V2_SECOND_DEVICE_START');
  const { context, page, errors } = await openFriendlyPage(browser, true, { width: 430, height: 932 });
  try {
    await waitUntil('Dave loaded from family cloud', async () => page.evaluate(() =>
      window.__tingxieProfileMemory?.snapshot?.().profiles?.some(profile => profile.name === 'Dave')
    ), 18000);
    await page.locator('#memoryProfileSelect').selectOption({ label: 'Dave' });
    await waitUntil('Dave words loaded', async () => page.locator('#wordList').inputValue().then(value => value.includes('一份')));
    const learned = wordRow(page, '一份');
    await waitUntil('learned tick loaded on second device', async () => learned.locator('input[type="checkbox"]').isChecked());
    assert.match(await learned.innerText(), /Learned/);
    assert.equal(await page.locator('#memoryListCount').innerText(), '1/10 saved');
    assert.equal(await page.locator('#tingxieCloudModeBadge').innerText(), `Family: ${FAMILY}`);
    assert.equal(await page.locator('.in-browser-camera-button:visible').count(), 0);
    assert.equal(await page.locator('#learningHubLink').evaluate(element => getComputedStyle(element).position), 'static');
    assert.deepEqual(errors, []);
    await page.screenshot({ path: '/tmp/tingxie-friendly-v2-second-pass.png', fullPage: true });
    console.log('FRIENDLY_V2_SECOND_DEVICE_PASS');
  } finally {
    await context.close();
  }
}

let browser;
try {
  if (IS_LIVE) {
    await waitForLiveDeployment();
  } else {
    server = spawn('python3', ['-m', 'http.server', String(PORT), '--directory', '.'], { stdio: ['ignore', 'pipe', 'pipe'] });
    await waitForLocalServer();
  }
  browser = await chromium.launch({ headless: true });
  await runFirstDevice(browser);
  await runSecondDevice(browser);
  console.log(IS_LIVE ? 'TINGXIE_LIVE_FRIENDLY_UX_V2_PASS' : 'TINGXIE_FRIENDLY_UX_V2_PASS');
} catch (error) {
  const detail = error.stack || String(error);
  await fs.writeFile(FAILURE_LOG, detail, 'utf8');
  console.error(IS_LIVE ? 'TINGXIE_LIVE_FRIENDLY_UX_V2_FAILURE' : 'TINGXIE_FRIENDLY_UX_V2_FAILURE');
  console.error(detail);
  process.exitCode = 1;
} finally {
  await browser?.close();
  server?.kill('SIGTERM');
}
