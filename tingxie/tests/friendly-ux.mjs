import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';

const PORT = 4187;
const LOCAL_BASE = `http://127.0.0.1:${PORT}/tingxie/`;
const BASE_URL = process.env.TINGXIE_BASE_URL || LOCAL_BASE;
const IS_LIVE = Boolean(process.env.TINGXIE_BASE_URL);
const FAILURE_LOG = '/tmp/tingxie-friendly-ux-error.txt';
const FAMILY = 'friendlyfam';
const remote = new Map();

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
  throw new Error('Local friendly-UX test server did not start.');
}

async function waitForLiveDeployment() {
  const deadline = Date.now() + 10 * 60 * 1000;
  let last = 'not checked';
  while (Date.now() < deadline) {
    try {
      const stamp = Date.now();
      const [bootResponse, uxResponse, finalResponse, syncResponse] = await Promise.all([
        fetch(`${BASE_URL}boot.js?friendly-deployment=${stamp}`, { headers: { 'cache-control': 'no-cache' } }),
        fetch(`${BASE_URL}app-friendly-ux.js?friendly-deployment=${stamp}`, { headers: { 'cache-control': 'no-cache' } }),
        fetch(`${BASE_URL}app-friendly-final-polish.js?friendly-deployment=${stamp}`, { headers: { 'cache-control': 'no-cache' } }),
        fetch(`${BASE_URL}app-family-sync-simple.js?friendly-deployment=${stamp}`, { headers: { 'cache-control': 'no-cache' } })
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
    await new Promise(resolve => setTimeout(resolve, 10000));
  }
  throw new Error(`Friendly UX deployment did not appear. Last result: ${last}`);
}

async function installStubs(context, options = {}) {
  await context.exposeFunction('__friendlyCloudRead', async path => {
    const key = path.join('/');
    return remote.has(key) ? structuredClone(remote.get(key)) : null;
  });
  await context.exposeFunction('__friendlyCloudWrite', async (path, payload) => {
    const key = path.join('/');
    remote.set(key, structuredClone(payload));
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
      readDoc: path => window.__friendlyCloudRead(path),
      writeDoc: (path, payload) => window.__friendlyCloudWrite(path, payload)
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
  }, { family: FAMILY, startSynced: Boolean(options.startSynced) });
}

async function openPage(browser, options = {}) {
  const context = await browser.newContext({ viewport: options.viewport || { width: 1055, height: 900 } });
  await installStubs(context, options);
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', error => errors.push(`pageerror: ${error.stack || error.message}`));
  page.on('console', message => { if (message.type() === 'error') errors.push(`console: ${message.text()}`); });
  page.on('requestfailed', request => errors.push(`requestfailed: ${request.url()} :: ${request.failure()?.errorText}`));
  await page.goto(`${BASE_URL}?test=friendly-ux&friendly=${Date.now()}`, { waitUntil: 'networkidle' });
  await page.waitForFunction(() => window.__tingxieFriendlyUx?.active === true);
  await page.waitForFunction(() => window.__tingxieFriendlyFinalPolish?.version === '20260810-1');
  await page.waitForFunction(() => window.__tingxieSimpleFamilySync?.version === '20260810-1');
  await page.waitForFunction(() => document.documentElement.dataset.tingxieProfileMemory === 'true');
  return { context, page, errors };
}

async function completeFriendlyTextDialog(page, value) {
  const overlay = page.locator('#friendlyActionOverlay');
  await overlay.waitFor({ state: 'visible' });
  const input = page.locator('#friendlyActionInput');
  await input.fill(value);
  await page.locator('#friendlyActionConfirm').click();
  await overlay.waitFor({ state: 'hidden' });
}

function rowFor(page, word) {
  return page.locator('.word-checklist-row').filter({ hasText: word }).first();
}

async function waitForRemoteProfileCount(count) {
  const key = `publicUsers/${FAMILY}/children/TingXie/profile/memory`;
  const deadline = Date.now() + 8000;
  while (Date.now() < deadline) {
    const value = remote.get(key);
    if (value?.memory?.profiles?.length === count) return value;
    await new Promise(resolve => setTimeout(resolve, 150));
  }
  throw new Error(`Remote profile count did not reach ${count}. Current: ${JSON.stringify(remote.get(key))}`);
}

async function runPrimaryFamilyFlow(browser) {
  const { context, page, errors } = await openPage(browser);
  try {
    // The browser OCR workflow is gone from the parent-facing production UI.
    assert.equal(await page.locator('label[for="sourceImage"]').isVisible(), false);
    assert.equal(await page.locator('#scanSourceButton').isVisible(), false);
    assert.equal(await page.locator('#appReadyStatus').isVisible(), false);
    assert.equal(await page.locator('.in-browser-camera-button:visible').count(), 0);
    assert.equal(await page.getByText('Take photo in browser', { exact: false }).filter({ visible: true }).count().catch(() => 0), 0);
    assert.equal(await page.evaluate(() => Boolean(document.querySelector('script[data-tingxie-ocr-accuracy]'))), false);
    assert.equal(await page.evaluate(() => document.documentElement.dataset.tingxieBrowserOcr), 'retired');

    // The navigation back to the app hub stays a quiet normal link at the top.
    const hubLink = page.locator('#learningHubLink');
    assert.equal(await hubLink.innerText(), '← Learning apps');
    assert.equal(await hubLink.evaluate(element => getComputedStyle(element).position), 'static');
    assert.equal(await page.evaluate(() => document.documentElement.dataset.tingxieHubLinkPlacement), 'top');

    // Sync is intentionally one simple username flow: no accounts and no manual cloud buttons.
    const sync = page.locator('#tingxieCloudSyncBox');
    assert.equal(await sync.getAttribute('open'), '');
    const syncText = await sync.innerText();
    assert.match(syncText, /Family sync/i);
    assert.match(syncText, /Family username/i);
    assert.match(syncText, /save automatically|sync automatically/i);
    assert.doesNotMatch(syncText, /Google|Sign in|Create account|Copy this browser|Reload from cloud/i);
    assert.equal(await page.locator('#tingxieGoogleSignIn').count(), 0);
    assert.equal(await page.locator('#tingxieCopyLocalToCloud').count(), 0);
    assert.equal(await page.locator('#tingxieRefreshCloud').count(), 0);

    // No browser prompt()/confirm() dialogs: child management uses the in-page action sheet.
    await page.locator('#renameProfileButton').click();
    await completeFriendlyTextDialog(page, 'Dave');
    assert.equal(await page.locator('#memoryProfileSelect option:checked').innerText(), 'Dave');

    await page.locator('#wordList').fill(['浪费', '组屋', '一份', '停车场'].join('\n'));
    await page.waitForFunction(() => document.querySelectorAll('.word-checklist-row').length === 4);
    assert.equal(await page.locator('.word-checklist-heading strong').innerText(), 'Words your child has learned');
    assert.match(await page.locator('.word-checklist-heading p').innerText(), /Tick a word after your child knows it/i);
    assert.equal(await page.locator('#enableAllWordsButton').innerText(), 'Practise all');
    assert.equal(await page.locator('#skipAllWordsButton').innerText(), 'Mark all learned');

    const learnedRow = rowFor(page, '一份');
    await learnedRow.locator('input[type="checkbox"]').check();
    assert.match(await learnedRow.innerText(), /Learned/);
    assert.equal(await learnedRow.evaluate(element => getComputedStyle(element).opacity), '0.58');
    assert.equal(await page.locator('#wordChecklistSummary').innerText(), '1 learned · 3 to practise');

    await page.locator('#saveMemoryListButton').click();
    await page.waitForFunction(() => window.__tingxieProfileMemory?.activeProfile?.().lists?.length === 1);

    // A family username automatically uploads this browser when the family is new.
    await page.locator('#tingxieUsernameInput').fill(FAMILY);
    await page.locator('#tingxieUsernameMode').click();
    await page.waitForFunction(() => window.__tingxieSimpleFamilySync?.mode?.() === 'username');
    await page.waitForFunction(() => /Synced|sync started/i.test(document.querySelector('#tingxieCloudStatus')?.textContent || ''));
    const initialRemote = await waitForRemoteProfileCount(1);
    assert.equal(initialRemote.memory.profiles[0].name, 'Dave');
    assert.equal(Object.keys(initialRemote.checklist || {}).length >= 1, true);

    // Add a second child with the in-page form; automatic watcher updates cloud.
    await page.locator('#addProfileButton').click();
    await completeFriendlyTextDialog(page, 'Kate');
    assert.equal(await page.locator('#memoryProfileSelect option:checked').innerText(), 'Kate');
    await waitForRemoteProfileCount(2);

    // Switch back to Dave and share the whole saved profile with one tap, no title prompt.
    await page.locator('#memoryProfileSelect').selectOption({ label: 'Dave' });
    await page.waitForFunction(() => document.querySelector('#memoryProfileSelect')?.selectedOptions[0]?.textContent === 'Dave');
    await page.locator('#shareClassPackButton').click();
    await page.waitForFunction(() => window.__shareCalls.length === 1);
    const share = await page.evaluate(() => window.__shareCalls[0]);
    assert.match(share.url, /#classpack=/);

    // Delete Kate through the custom confirmation sheet to cover confirm() replacement.
    await page.locator('#memoryProfileSelect').selectOption({ label: 'Kate' });
    await page.locator('#deleteProfileButton').click();
    await page.locator('#friendlyActionOverlay').waitFor({ state: 'visible' });
    assert.match(await page.locator('#friendlyActionTitle').innerText(), /Delete Kate/);
    await page.locator('#friendlyActionConfirm').click();
    await page.locator('#friendlyActionOverlay').waitFor({ state: 'hidden' });
    await page.waitForFunction(() => window.__tingxieProfileMemory?.snapshot?.().profiles.length === 1);

    const dialogCalls = await page.evaluate(() => ({
      prompts: window.__nativePromptCalls,
      confirms: window.__nativeConfirmCalls
    }));
    assert.deepEqual(dialogCalls.prompts, []);
    assert.deepEqual(dialogCalls.confirms, []);
    assert.deepEqual(errors, []);

    await page.screenshot({ path: '/tmp/tingxie-friendly-ux-pass.png', fullPage: true });
  } catch (error) {
    await page.screenshot({ path: '/tmp/tingxie-friendly-ux-failure.png', fullPage: true }).catch(() => {});
    const state = await page.evaluate(() => ({
      friendly: window.__tingxieFriendlyUx,
      finalPolish: window.__tingxieFriendlyFinalPolish,
      simpleSync: {
        mode: window.__tingxieSimpleFamilySync?.mode?.(),
        username: window.__tingxieSimpleFamilySync?.username?.()
      },
      syncText: document.querySelector('#tingxieCloudSyncBox')?.textContent,
      profile: window.__tingxieProfileMemory?.activeProfile?.(),
      checklistHeading: document.querySelector('.word-checklist-heading strong')?.textContent,
      checklistSummary: document.querySelector('#wordChecklistSummary')?.textContent,
      nativePrompts: window.__nativePromptCalls,
      nativeConfirms: window.__nativeConfirmCalls,
      shareCalls: window.__shareCalls,
      ocrScript: Boolean(document.querySelector('script[data-tingxie-ocr-accuracy]')),
      browserCameraVisible: Array.from(document.querySelectorAll('.in-browser-camera-button')).some(element => getComputedStyle(element).display !== 'none'),
      hubPosition: document.querySelector('#learningHubLink') ? getComputedStyle(document.querySelector('#learningHubLink')).position : null
    })).catch(() => ({}));
    throw new Error(`${error.stack || error}\nBrowser errors:\n${errors.join('\n')}\nPage state:\n${JSON.stringify(state, null, 2)}\nRemote:\n${JSON.stringify([...remote.entries()], null, 2)}`);
  } finally {
    await context.close();
  }
}

async function runSecondDeviceFlow(browser) {
  const { context, page, errors } = await openPage(browser, { startSynced: true, viewport: { width: 430, height: 932 } });
  try {
    await page.waitForFunction(() => window.__tingxieSimpleFamilySync?.mode?.() === 'username');
    await page.waitForFunction(() => window.__tingxieProfileMemory?.snapshot?.().profiles.some(profile => profile.name === 'Dave'));
    await page.locator('#memoryProfileSelect').selectOption({ label: 'Dave' });
    await page.waitForFunction(() => document.querySelector('#wordList')?.value.includes('一份'));
    assert.equal(await page.locator('#memoryListCount').innerText(), '1/10 saved');
    const learnedRow = rowFor(page, '一份');
    assert.equal(await learnedRow.locator('input[type="checkbox"]').isChecked(), true);
    assert.match(await learnedRow.innerText(), /Learned/);
    assert.equal(await page.locator('#tingxieCloudModeBadge').innerText(), `Family: ${FAMILY}`);
    assert.equal(await page.locator('.in-browser-camera-button:visible').count(), 0);
    assert.equal(await page.locator('#learningHubLink').evaluate(element => getComputedStyle(element).position), 'static');
    assert.deepEqual(errors, []);
    await page.screenshot({ path: '/tmp/tingxie-friendly-ux-device2-pass.png', fullPage: true });
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
  await runPrimaryFamilyFlow(browser);
  await runSecondDeviceFlow(browser);
  console.log(IS_LIVE ? 'TINGXIE_LIVE_FRIENDLY_UX_PASS' : 'TINGXIE_FRIENDLY_UX_PASS');
} catch (error) {
  const detail = error.stack || String(error);
  await fs.writeFile(FAILURE_LOG, detail, 'utf8');
  console.error(IS_LIVE ? 'TINGXIE_LIVE_FRIENDLY_UX_FAILURE' : 'TINGXIE_FRIENDLY_UX_FAILURE');
  console.error(detail);
  process.exitCode = 1;
} finally {
  await browser?.close();
  server?.kill('SIGTERM');
}
