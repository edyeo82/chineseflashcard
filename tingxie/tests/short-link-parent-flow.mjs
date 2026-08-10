import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';

const PORT = 4188;
const LOCAL_BASE = `http://127.0.0.1:${PORT}/tingxie/`;
const BASE_URL = process.env.TINGXIE_BASE_URL || LOCAL_BASE;
const IS_LIVE = Boolean(process.env.TINGXIE_BASE_URL);
const FAILURE_LOG = '/tmp/tingxie-short-link-parent-flow-error.txt';

let server = null;

function makeList(id, title, words) {
  return {
    id,
    title,
    customTitle: true,
    words,
    createdAt: '2026-08-10T00:00:00.000Z',
    updatedAt: '2026-08-10T00:00:00.000Z',
    lastPracticedAt: null,
    attempts: 0,
    bestScore: null,
    lastScore: null,
    lastTotal: null,
    mistakes: []
  };
}

function makeProfile(id, name, lists = []) {
  return {
    id,
    name,
    createdAt: '2026-08-10T00:00:00.000Z',
    updatedAt: '2026-08-10T00:00:00.000Z',
    activeListId: lists[0]?.id || null,
    draftWords: [],
    lists,
    history: []
  };
}

function makeMemory(profiles, activeProfileId = profiles[0]?.id || null) {
  return { version: 1, activeProfileId, profiles };
}

const TEACHER_PROFILE = makeProfile('teacher', 'Teacher', [
  makeList('l1', '听写 1', ['森林', '山洞', '湖边', '天桥']),
  makeList('l2', '听写 2', ['沙滩', '养鱼', '拍照', '讨论']),
  makeList('l3', '听写 3', ['漂亮', '仍然', '停车场'])
]);

async function waitForLocalServer() {
  const deadline = Date.now() + 15000;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(LOCAL_BASE);
      if (response.ok) return;
    } catch {}
    await new Promise(resolve => setTimeout(resolve, 250));
  }
  throw new Error('Local short-link test server did not start.');
}

async function waitForLiveDeployment() {
  const deadline = Date.now() + 10 * 60 * 1000;
  let last = 'not checked';
  while (Date.now() < deadline) {
    try {
      const stamp = Date.now();
      const [bootResponse, shortResponse, parentResponse] = await Promise.all([
        fetch(`${BASE_URL}boot.js?short-parent=${stamp}`, { headers: { 'cache-control': 'no-cache' } }),
        fetch(`${BASE_URL}app-class-pack-short-link.js?short-parent=${stamp}`, { headers: { 'cache-control': 'no-cache' } }),
        fetch(`${BASE_URL}app-parent-flow-polish.js?short-parent=${stamp}`, { headers: { 'cache-control': 'no-cache' } })
      ]);
      const [boot, shortModule, parentModule] = await Promise.all([
        bootResponse.text(), shortResponse.text(), parentResponse.text()
      ]);
      const ready = boot.includes('app-class-pack-short-link.js?v=20260810-3')
        && boot.includes('app-parent-flow-polish.js?v=20260810-3')
        && shortModule.includes("TINGXIE_SHORT_CLASS_LINK_VERSION = '20260810-3'")
        && parentModule.includes("TINGXIE_PARENT_FLOW_POLISH_VERSION = '20260810-3'");
      if (bootResponse.ok && shortResponse.ok && parentResponse.ok && ready) return;
      last = `boot=${bootResponse.status}, short=${shortResponse.status}, parent=${parentResponse.status}, ready=${ready}`;
    } catch (error) {
      last = error.message;
    }
    await new Promise(resolve => setTimeout(resolve, 10000));
  }
  throw new Error(`Short-link deployment did not appear. Last result: ${last}`);
}

async function installCommonStubs(context, { memory = null, packStore = {} } = {}) {
  await context.addInitScript(({ memoryState, initialPackStore }) => {
    if (memoryState && !localStorage.getItem('__tingxieShortParentSeeded')) {
      localStorage.setItem('tingxie:profileMemory:v1', JSON.stringify(memoryState));
      localStorage.setItem('hcl:saveMode', 'guest');
      localStorage.removeItem('hcl:simpleUsername');
      localStorage.setItem('__tingxieShortParentSeeded', '1');
    }

    window.__shortPackStore = JSON.parse(JSON.stringify(initialPackStore || {}));
    window.__tingxieClassPackStoreTestAdapter = {
      async writeDoc(path, payload) {
        window.__shortPackStore[path.join('/')] = JSON.parse(JSON.stringify(payload));
        return true;
      },
      async readDoc(path) {
        return JSON.parse(JSON.stringify(window.__shortPackStore[path.join('/')] || null));
      }
    };

    const voices = [{ name: 'Singapore Female', lang: 'zh-SG', localService: true }];
    class FakeUtterance {
      constructor(text) {
        this.text = text;
        this.lang = 'zh-SG';
        this.rate = 1;
        this.pitch = 1;
        this.volume = 1;
      }
    }
    Object.defineProperty(window, 'SpeechSynthesisUtterance', { value: FakeUtterance, configurable: true });
    Object.defineProperty(window, 'speechSynthesis', {
      configurable: true,
      value: {
        getVoices: () => voices,
        speak: utterance => setTimeout(() => utterance.onend?.(), 5),
        cancel: () => {},
        onvoiceschanged: null
      }
    });
  }, { memoryState: memory, initialPackStore: packStore });
}

async function createShortShare(browser) {
  const context = await browser.newContext({ viewport: { width: 430, height: 932 } });
  await installCommonStubs(context, { memory: makeMemory([TEACHER_PROFILE], TEACHER_PROFILE.id) });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  try {
    await page.goto(`${BASE_URL}?test=friendly-ux&teacher=${Date.now()}`, { waitUntil: 'networkidle' });
    await page.waitForFunction(() => window.__tingxieClassPackShortLink?.version === '20260810-3');
    const shareUrl = await page.evaluate(async () => {
      const profile = window.__tingxieProfileMemory.activeProfile();
      return window.__tingxieClassPack.createShareUrl(profile, 'P5 Term 3 听写');
    });
    const parsed = new URL(shareUrl);
    const packId = parsed.searchParams.get('pack');
    assert.ok(packId);
    assert.match(packId, /^[23456789abcdefghjkmnpqrstuvwxyz]{12}$/);
    assert.equal(parsed.hash, '');
    assert.equal(parsed.searchParams.size, 1);
    assert.ok(shareUrl.length < 130, `Expected a neat short URL, got ${shareUrl.length} characters.`);
    const store = await page.evaluate(() => window.__shortPackStore);
    assert.equal(Object.keys(store).length, 1);
    assert.deepEqual(errors, []);
    return { shareUrl, store };
  } finally {
    await context.close();
  }
}

async function runParentFlow(browser, share) {
  const defaultProfile = makeProfile('child-default', 'Child 1', []);
  const context = await browser.newContext({ viewport: { width: 430, height: 932 } });
  await installCommonStubs(context, {
    memory: makeMemory([defaultProfile], defaultProfile.id),
    packStore: share.store
  });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', error => errors.push(`pageerror: ${error.stack || error.message}`));
  page.on('console', message => { if (message.type() === 'error') errors.push(`console: ${message.text()}`); });
  page.on('requestfailed', request => {
    const text = request.failure()?.errorText || '';
    if (!/ERR_ABORTED/i.test(text)) errors.push(`requestfailed: ${request.url()} :: ${text}`);
  });

  try {
    const shared = new URL(share.shareUrl);
    shared.searchParams.set('test', 'friendly-ux');
    await page.goto(shared.toString(), { waitUntil: 'networkidle' });
    await page.waitForFunction(() => window.__tingxieClassPack?.isActive?.() === true);
    await page.waitForFunction(() => window.__tingxieParentFlowPolish?.version === '20260810-3');
    assert.equal(await page.locator('#classPackTitle').innerText(), 'P5 Term 3 听写');
    assert.equal(await page.locator('#classPackListSelect option').count(), 3);

    await page.locator('#classPackFamilyToggle').click();
    await page.locator('#classPackFamilyPanel:not([hidden])').waitFor();
    assert.equal(await page.locator('#classPackNewChildRow').isVisible(), true);
    assert.equal(await page.locator('#classPackFamilyProfileSelect option[value="__new_child__"]').count(), 0);
    assert.match(await page.locator('.parent-new-child-note').innerText(), /create the child profile automatically/i);

    // No dropdown step: typing a name alone must create the child.
    await page.locator('#classPackNewChildName').fill('Sarah');
    assert.match(await page.locator('#classPackFamilyCapacity').innerText(), /new profile for Sarah/i);
    await page.locator('#classPackFamilySaveConfirm').click();
    await page.waitForFunction(() => document.querySelector('#classPackFamilyStatus')?.textContent.includes('lists saved'));

    let memory = JSON.parse(await page.evaluate(() => localStorage.getItem('tingxie:profileMemory:v1')));
    assert.equal(memory.profiles.length, 1);
    assert.equal(memory.profiles[0].name, 'Sarah');
    assert.equal(memory.profiles[0].lists.length, 3);

    // Opening the imported child must remove the new ?pack= short-link query.
    await page.locator('#classPackOpenChildButton').click();
    await page.waitForFunction(() => !new URL(location.href).searchParams.has('pack'));
    await page.waitForFunction(() => window.__tingxieClassPack?.isActive?.() === false);
    await page.waitForFunction(() => document.querySelector('#memoryProfileSelect')?.selectedOptions[0]?.textContent === 'Sarah');
    assert.equal(new URL(page.url()).searchParams.has('pack'), false);

    await page.waitForFunction(() => document.querySelectorAll('.word-checklist-row').length >= 4);
    assert.equal(await page.locator('#saveLearnedProgressButton').isVisible(), true);
    assert.equal(await page.locator('#saveLearnedProgressButton').innerText(), '💾 Save progress');

    await page.evaluate(() => {
      window.__progressUploads = 0;
      window.__tingxieCloudSync.mode = () => 'username';
      window.__tingxieCloudSync.path = () => ['publicUsers', 'familytest', 'children', 'TingXie', 'profile', 'memory'];
      window.__tingxieCloudSync.upload = async () => { window.__progressUploads += 1; return true; };
    });

    const firstLearned = page.locator('.word-checklist-row').first();
    await firstLearned.locator('input[type="checkbox"]').check();
    await page.waitForFunction(() => document.querySelector('#learnedProgressSaveStatus')?.textContent.includes('tap Save progress'));
    await page.locator('#saveLearnedProgressButton').click();
    await page.waitForFunction(() => document.querySelector('#learnedProgressSaveStatus')?.textContent.includes('saved and synced'));
    assert.equal(await page.evaluate(() => window.__progressUploads), 1);

    const skipped = JSON.parse(await page.evaluate(() => localStorage.getItem('tingxie:skippedWords:v1')) || '{}');
    assert.ok(Object.values(skipped).some(value => Array.isArray(value) && value.length === 1));
    assert.deepEqual(errors, []);
    await page.screenshot({ path: '/tmp/tingxie-short-link-parent-flow-pass.png', fullPage: true });
  } catch (error) {
    await page.screenshot({ path: '/tmp/tingxie-short-link-parent-flow-failure.png', fullPage: true }).catch(() => {});
    const state = await page.evaluate(() => ({
      url: location.href,
      short: window.__tingxieClassPackShortLink?.version,
      activePack: window.__tingxieClassPack?.isActive?.(),
      parent: window.__tingxieParentFlowPolish?.version,
      importStatus: document.querySelector('#classPackFamilyStatus')?.textContent,
      progressStatus: document.querySelector('#learnedProgressSaveStatus')?.textContent,
      memory: localStorage.getItem('tingxie:profileMemory:v1'),
      skipped: localStorage.getItem('tingxie:skippedWords:v1')
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
  const share = await createShortShare(browser);
  await runParentFlow(browser, share);
  console.log(IS_LIVE ? 'TINGXIE_LIVE_SHORT_LINK_PARENT_FLOW_PASS' : 'TINGXIE_SHORT_LINK_PARENT_FLOW_PASS');
} catch (error) {
  const detail = error.stack || String(error);
  await fs.writeFile(FAILURE_LOG, detail, 'utf8');
  console.error(IS_LIVE ? 'TINGXIE_LIVE_SHORT_LINK_PARENT_FLOW_FAILURE' : 'TINGXIE_SHORT_LINK_PARENT_FLOW_FAILURE');
  console.error(detail);
  process.exitCode = 1;
} finally {
  await browser?.close();
  server?.kill('SIGTERM');
}
