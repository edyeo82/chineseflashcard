import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';

const PORT = 4185;
const LOCAL_BASE = `http://127.0.0.1:${PORT}/tingxie/`;
const BASE_URL = process.env.TINGXIE_BASE_URL || LOCAL_BASE;
const IS_LIVE = Boolean(process.env.TINGXIE_BASE_URL);
const FAILURE_LOG = '/tmp/tingxie-ui-polish-error.txt';

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
  throw new Error('Local Ting Xie UI test server did not start.');
}

async function waitForLiveDeployment() {
  const deadline = Date.now() + 10 * 60 * 1000;
  let last = 'not checked';
  while (Date.now() < deadline) {
    try {
      const stamp = Date.now();
      const [indexResponse, bootResponse, uiResponse] = await Promise.all([
        fetch(`${BASE_URL}?ui-deployment=${stamp}`, { headers: { 'cache-control': 'no-cache' } }),
        fetch(`${BASE_URL}boot.js?ui-deployment=${stamp}`, { headers: { 'cache-control': 'no-cache' } }),
        fetch(`${BASE_URL}app-ui-polish.js?ui-deployment=${stamp}`, { headers: { 'cache-control': 'no-cache' } })
      ]);
      const [index, boot, ui] = await Promise.all([indexResponse.text(), bootResponse.text(), uiResponse.text()]);
      const ready = index.includes('ui=20260809-4')
        && boot.includes("app-ui-polish.js?v=20260809-4")
        && ui.includes("TINGXIE_UI_POLISH_VERSION = '20260809-4'");
      if (indexResponse.ok && bootResponse.ok && uiResponse.ok && ready) return;
      last = `index=${indexResponse.status}, boot=${bootResponse.status}, ui=${uiResponse.status}, ready=${ready}`;
    } catch (error) {
      last = error.message;
    }
    await new Promise(resolve => setTimeout(resolve, 10000));
  }
  throw new Error(`UI polish deployment did not appear. Last result: ${last}`);
}

async function installSpeechStubs(context) {
  await context.addInitScript(() => {
    localStorage.setItem('hcl:saveMode', 'guest');
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
        speak: utterance => setTimeout(() => utterance.onend?.(), 5),
        cancel: () => {},
        onvoiceschanged: null
      }
    });
  });
}

async function openUiPage(browser, options = {}) {
  const context = await browser.newContext({
    viewport: options.viewport,
    userAgent: options.userAgent
  });
  await installSpeechStubs(context);
  const errors = [];
  const page = await context.newPage();
  page.on('pageerror', error => errors.push(`pageerror: ${error.stack || error.message}`));
  page.on('console', message => { if (message.type() === 'error') errors.push(`console: ${message.text()}`); });
  page.on('requestfailed', request => errors.push(`requestfailed: ${request.url()} :: ${request.failure()?.errorText}`));
  await page.goto(`${BASE_URL}?test=deterministic&ui-polish=${Date.now()}`, { waitUntil: 'networkidle' });
  await page.waitForFunction(() => window.__tingxieUiPolish?.version === '20260809-4');
  await page.waitForFunction(() => document.getElementById('tingxieCloudSyncBox')?.open === true);
  return { context, page, errors };
}

async function verifyCommonUi(page) {
  assert.equal(await page.locator('label[for="profileName"]').isVisible(), false);
  assert.equal(await page.locator('#profileName').isVisible(), false);
  assert.equal((await page.locator('body').innerText()).includes('Child / profile'), false);
  assert.equal(await page.locator('.profile-memory-heading strong').innerText(), '👧 Children & 听写 lists');
  assert.match(await page.locator('.profile-memory-heading p').innerText(), /Choose a child, then choose a saved 听写 list/);
  assert.equal(await page.locator('#tingxieCloudSyncBox').evaluate(element => element.open), true);
  assert.equal(await page.locator('#tingxieCloudSyncBox').getAttribute('data-default-open'), 'true');
}

async function verifyDesktop(browser) {
  // 1055px is deliberately close to the screenshot/report size. The overall
  // page is desktop width, but the left memory card is narrow because it sits
  // inside the two-column prepare layout.
  const { context, page, errors } = await openUiPage(browser, { viewport: { width: 1055, height: 900 } });
  try {
    await verifyCommonUi(page);
    const result = await page.evaluate(() => {
      const rect = element => {
        const value = element.getBoundingClientRect();
        return { left: value.left, right: value.right, top: value.top, bottom: value.bottom, width: value.width };
      };
      const box = document.getElementById('profileMemoryBox');
      const profileSelect = document.getElementById('memoryProfileSelect');
      const listSelect = document.getElementById('memoryListSelect');
      const profileActions = document.getElementById('addProfileButton').closest('.memory-actions');
      const listActions = document.getElementById('saveMemoryListButton').closest('.memory-actions');
      const computed = getComputedStyle(listSelect);
      return {
        style: {
          appearance: computed.appearance,
          minHeight: computed.minHeight,
          borderRadius: computed.borderRadius,
          backgroundImage: computed.backgroundImage
        },
        box: rect(box),
        profileSelect: rect(profileSelect),
        listSelect: rect(listSelect),
        profileActions: rect(profileActions),
        listActions: rect(listActions),
        actionRects: [...box.querySelectorAll('.memory-actions button, #memoryListCount')].map(rect)
      };
    });

    assert.equal(result.style.appearance, 'none');
    assert.equal(result.style.minHeight, '46px');
    assert.equal(result.style.borderRadius, '12px');
    assert.notEqual(result.style.backgroundImage, 'none');
    assert.ok(result.listSelect.width >= 250, `Desktop saved-list selector is unexpectedly narrow: ${result.listSelect.width}px`);
    assert.ok(result.profileActions.top >= result.profileSelect.bottom + 4, 'Profile buttons must sit below the child selector.');
    assert.ok(result.listActions.top >= result.listSelect.bottom + 4, 'List buttons must sit below the saved-list selector.');
    for (const action of result.actionRects) {
      assert.ok(action.left >= result.box.left - 1, `Action spills left of memory card: ${JSON.stringify(action)}`);
      assert.ok(action.right <= result.box.right + 1, `Action spills right of memory card: ${JSON.stringify(action)}`);
    }
    assert.deepEqual(errors, []);
    await page.screenshot({ path: '/tmp/tingxie-ui-polish-desktop-pass.png', fullPage: true });
  } finally {
    await context.close();
  }
}

async function verifyMobile(browser) {
  const { context, page, errors } = await openUiPage(browser, {
    viewport: { width: 430, height: 932 },
    userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 26_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/140.0.0.0 Mobile/15E148 Safari/604.1'
  });
  try {
    await verifyCommonUi(page);
    const appearance = await page.locator('#memoryListSelect').evaluate(element => getComputedStyle(element).appearance);
    assert.notEqual(appearance, 'none', 'Phone selector should retain the native browser appearance.');
    assert.deepEqual(errors, []);
    await page.screenshot({ path: '/tmp/tingxie-ui-polish-mobile-pass.png', fullPage: true });
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
  await verifyDesktop(browser);
  await verifyMobile(browser);
  console.log(IS_LIVE ? 'TINGXIE_LIVE_UI_POLISH_PASS' : 'TINGXIE_UI_POLISH_PASS');
} catch (error) {
  const detail = error.stack || String(error);
  await fs.writeFile(FAILURE_LOG, detail, 'utf8');
  console.error(IS_LIVE ? 'TINGXIE_LIVE_UI_POLISH_FAILURE' : 'TINGXIE_UI_POLISH_FAILURE');
  console.error(detail);
  process.exitCode = 1;
} finally {
  await browser?.close();
  server?.kill('SIGTERM');
}
