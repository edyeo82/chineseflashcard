import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';

const PORT = 4183;
const LOCAL_BASE = `http://127.0.0.1:${PORT}/tingxie/`;
const BASE_URL = process.env.TINGXIE_BASE_URL || LOCAL_BASE;
const IS_LIVE = Boolean(process.env.TINGXIE_BASE_URL);
const FAILURE_LOG = '/tmp/tingxie-cloud-sync-error.txt';
const USERNAME = `family-sync-${Date.now().toString(36)}`;
const WORDS = ['浪费', '组屋', '一份', '停车场'];
const remoteStore = new Map();
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
  throw new Error('Local cloud-sync test server did not start.');
}

async function waitForLiveDeployment() {
  const deadline = Date.now() + 10 * 60 * 1000;
  let last = 'not checked';
  while (Date.now() < deadline) {
    try {
      const stamp = Date.now();
      const [pageResponse, bootResponse, cloudResponse] = await Promise.all([
        fetch(`${BASE_URL}?cloud-deployment=${stamp}`, { headers: { 'cache-control': 'no-cache' } }),
        fetch(`${BASE_URL}boot.js?cloud-deployment=${stamp}`, { headers: { 'cache-control': 'no-cache' } }),
        fetch(`${BASE_URL}app-cloud-sync.js?cloud-deployment=${stamp}`, { headers: { 'cache-control': 'no-cache' } })
      ]);
      const [page, boot, cloud] = await Promise.all([pageResponse.text(), bootResponse.text(), cloudResponse.text()]);
      const ready = page.includes('boot.js?v=20260802-3')
        && boot.includes("TINGXIE_BOOT_VERSION = '20260802-3'")
        && cloud.includes("TINGXIE_CLOUD_SYNC_VERSION = '20260802-3'");
      if (pageResponse.ok && bootResponse.ok && cloudResponse.ok && ready) return;
      last = `page=${pageResponse.status}, boot=${bootResponse.status}, cloud=${cloudResponse.status}, ready=${ready}`;
    } catch (error) {
      last = error.message;
    }
    await new Promise(resolve => setTimeout(resolve, 10000));
  }
  throw new Error(`Cloud-sync deployment did not appear. Last result: ${last}`);
}

async function makeContext(browser, preseedUsername = false) {
  const context = await browser.newContext({ viewport: { width: 430, height: 932 } });
  await context.exposeFunction('__tingxieTestCloudRead', key => structuredClone(remoteStore.get(key) || null));
  await context.exposeFunction('__tingxieTestCloudWrite', (key, payload) => {
    remoteStore.set(key, structuredClone(payload));
    return true;
  });
  await context.addInitScript(({ username, preseed }) => {
    if (preseed) {
      localStorage.setItem('hcl:saveMode', 'username');
      localStorage.setItem('hcl:simpleUsername', username);
    }

    window.__tingxieCloudTestAdapter = {
      onAuthStateChanged(callback) {
        queueMicrotask(() => callback(null));
        return () => {};
      },
      async readDoc(path) {
        return window.__tingxieTestCloudRead(path.join('/'));
      },
      async writeDoc(path, payload) {
        return window.__tingxieTestCloudWrite(path.join('/'), payload);
      },
      async signInGoogle() { return { user: { uid: 'test-user', email: 'test@example.com' } }; },
      async signInEmail() { return { user: { uid: 'test-user', email: 'test@example.com' } }; },
      async createEmail() { return { user: { uid: 'test-user', email: 'test@example.com' } }; },
      async signOut() { return true; }
    };

    class FakeUtterance {
      constructor(text) { this.text = text; this.lang = 'zh-CN'; this.rate = 1; }
    }
    Object.defineProperty(window, 'SpeechSynthesisUtterance', { value: FakeUtterance, configurable: true });
    Object.defineProperty(window, 'speechSynthesis', {
      configurable: true,
      value: {
        getVoices: () => [{ name: 'Test Mandarin', lang: 'zh-CN', localService: true }],
        speak: utterance => setTimeout(() => utterance.onend?.(), 5),
        cancel: () => {},
        onvoiceschanged: null
      }
    });
  }, { username: USERNAME, preseed: preseedUsername });
  return context;
}

async function openCloudPage(context, label) {
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', error => errors.push(`pageerror: ${error.stack || error.message}`));
  page.on('console', message => { if (message.type() === 'error') errors.push(`console: ${message.text()}`); });
  page.on('requestfailed', request => errors.push(`requestfailed: ${request.url()} :: ${request.failure()?.errorText}`));
  await page.goto(`${BASE_URL}?test=cloud-sync&device=${label}&stamp=${Date.now()}`, { waitUntil: 'networkidle' });
  await page.waitForFunction(() => document.documentElement.dataset.tingxieCloudSync === 'true');
  await page.waitForFunction(() => document.documentElement.dataset.tingxieHubLinkPlacement === 'top');
  return { page, errors };
}

async function runCloudSyncTest(browser) {
  const contextA = await makeContext(browser, false);
  const contextB = await makeContext(browser, true);
  let pageA;
  let pageB;
  const allErrors = [];

  try {
    ({ page: pageA, errors: allErrors[0] } = await openCloudPage(contextA, 'A'));
    const errorsA = allErrors[0];
    await pageA.locator('#tingxieCloudSyncBox summary').click();
    await pageA.locator('#tingxieUsernameInput').fill(USERNAME);
    await pageA.locator('#tingxieUsernameMode').click();
    await pageA.waitForFunction(() => document.querySelector('#tingxieCloudStatus')?.textContent.includes('Created cloud storage'));

    pageA.once('dialog', dialog => dialog.accept('Kate'));
    await pageA.locator('#renameProfileButton').click();
    await pageA.waitForFunction(() => document.querySelector('#memoryProfileSelect option:checked')?.textContent === 'Kate');

    await pageA.locator('#wordList').fill(WORDS.join('\n'));
    await pageA.locator('#saveMemoryListButton').click();
    await pageA.waitForFunction(() => document.querySelector('#memoryListCount')?.textContent === '1/10 saved');
    await pageA.waitForFunction(() => document.querySelectorAll('#wordChecklistRows .word-checklist-row').length === 4);
    await pageA.locator('#wordChecklistRows .word-checklist-row').first().locator('input').check();

    const expectedPath = `publicUsers/${USERNAME}/children/TingXie/profile/memory`;
    const deadline = Date.now() + 8000;
    while (Date.now() < deadline) {
      const stored = remoteStore.get(expectedPath);
      const remoteProfile = stored?.memory?.profiles?.[0];
      const remoteChecklist = stored?.checklist || {};
      if (remoteProfile?.name === 'Kate' && remoteProfile?.lists?.[0]?.words?.includes('一份') && Object.values(remoteChecklist).some(items => items.includes('浪费'))) break;
      await new Promise(resolve => setTimeout(resolve, 200));
    }

    const stored = remoteStore.get(expectedPath);
    assert.ok(stored, 'Device A should write the Ting Xie document under the shared Flashcards username root.');
    assert.equal(stored.memory.profiles[0].name, 'Kate');
    assert.deepEqual(stored.memory.profiles[0].lists[0].words, WORDS);
    assert.equal(Object.values(stored.checklist).some(items => items.includes('浪费')), true);
    assert.equal(await pageA.evaluate(() => localStorage.getItem('hcl:saveMode')), 'username');
    assert.equal(await pageA.evaluate(() => localStorage.getItem('hcl:simpleUsername')), USERNAME);
    assert.deepEqual(await pageA.evaluate(() => window.__tingxieCloudSync.path()), ['publicUsers', USERNAME, 'children', 'TingXie', 'profile', 'memory']);

    ({ page: pageB, errors: allErrors[1] } = await openCloudPage(contextB, 'B'));
    const errorsB = allErrors[1];
    await pageB.waitForFunction(expected => document.querySelector('#wordList')?.value === expected, WORDS.join('\n'), { timeout: 12000 });
    await pageB.waitForFunction(() => document.querySelector('#memoryProfileSelect option:checked')?.textContent === 'Kate');
    await pageB.waitForFunction(() => document.querySelector('#memoryListCount')?.textContent === '1/10 saved');
    await pageB.waitForFunction(() => document.querySelector('#wordChecklistRows .word-checklist-row input')?.checked === true);

    assert.equal(await pageB.locator('#memoryProfileSelect option:checked').innerText(), 'Kate');
    assert.equal(await pageB.locator('#wordList').inputValue(), WORDS.join('\n'));
    assert.equal(await pageB.locator('#wordChecklistRows .word-checklist-row').first().getAttribute('class').then(value => value.includes('skipped')), true);
    assert.match(await pageB.locator('#tingxieCloudStatus').innerText(), /Cloud is up to date|Loaded cloud profiles/);

    const hubLink = pageB.locator('#learningHubLink');
    assert.equal(await hubLink.innerText(), '🏠 Learning apps');
    assert.equal(await hubLink.evaluate(element => getComputedStyle(element).position), 'static');
    assert.equal(await hubLink.evaluate(element => element.parentElement?.matches('.app-header > div')), true);

    assert.deepEqual(errorsA, []);
    assert.deepEqual(errorsB, []);
    await pageB.screenshot({ path: '/tmp/tingxie-cloud-sync-pass.png', fullPage: true });
  } catch (error) {
    await pageA?.screenshot({ path: '/tmp/tingxie-cloud-sync-device-a-failure.png', fullPage: true }).catch(() => {});
    await pageB?.screenshot({ path: '/tmp/tingxie-cloud-sync-device-b-failure.png', fullPage: true }).catch(() => {});
    const stateA = await pageA?.evaluate(() => ({
      url: location.href,
      cloud: document.documentElement.dataset.tingxieCloudSync,
      status: document.querySelector('#tingxieCloudStatus')?.textContent,
      profile: document.querySelector('#memoryProfileSelect option:checked')?.textContent,
      words: document.querySelector('#wordList')?.value,
      localMode: localStorage.getItem('hcl:saveMode'),
      localUsername: localStorage.getItem('hcl:simpleUsername')
    })).catch(() => ({}));
    const stateB = await pageB?.evaluate(() => ({
      url: location.href,
      cloud: document.documentElement.dataset.tingxieCloudSync,
      status: document.querySelector('#tingxieCloudStatus')?.textContent,
      profile: document.querySelector('#memoryProfileSelect option:checked')?.textContent,
      words: document.querySelector('#wordList')?.value,
      checklist: Array.from(document.querySelectorAll('#wordChecklistRows input')).map(input => input.checked)
    })).catch(() => ({}));
    throw new Error(`${error.stack || error}\nBrowser errors:\n${JSON.stringify(allErrors)}\nRemote store:\n${JSON.stringify(Object.fromEntries(remoteStore), null, 2)}\nDevice A:\n${JSON.stringify(stateA, null, 2)}\nDevice B:\n${JSON.stringify(stateB, null, 2)}`);
  } finally {
    await contextA.close();
    await contextB.close();
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
  await runCloudSyncTest(browser);
  console.log(IS_LIVE ? 'TINGXIE_LIVE_CLOUD_SYNC_PASS' : 'TINGXIE_CLOUD_SYNC_PASS');
} catch (error) {
  const detail = error.stack || String(error);
  await fs.writeFile(FAILURE_LOG, detail, 'utf8');
  console.error(IS_LIVE ? 'TINGXIE_LIVE_CLOUD_SYNC_FAILURE' : 'TINGXIE_CLOUD_SYNC_FAILURE');
  console.error(detail);
  process.exitCode = 1;
} finally {
  await browser?.close();
  server?.kill('SIGTERM');
}
