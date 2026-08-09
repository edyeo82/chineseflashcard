import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';

const PORT = 4185;
const LOCAL_BASE = `http://127.0.0.1:${PORT}/tingxie/`;
const BASE_URL = process.env.TINGXIE_BASE_URL || LOCAL_BASE;
const IS_LIVE = Boolean(process.env.TINGXIE_BASE_URL);
const FAILURE_LOG = '/tmp/tingxie-class-pack-family-import-error.txt';
const MEMORY_KEY = 'tingxie:profileMemory:v1';
const SKIPPED_KEY = 'tingxie:skippedWords:v1';

let server = null;

function makeList(id, title, words) {
  return {
    id,
    title,
    customTitle: true,
    words,
    createdAt: '2026-08-01T00:00:00.000Z',
    updatedAt: '2026-08-01T00:00:00.000Z',
    lastPracticedAt: null,
    attempts: 7,
    bestScore: 7,
    lastScore: 6,
    lastTotal: 7,
    mistakes: ['sender-private']
  };
}

function makeProfile(id, name, lists = []) {
  return {
    id,
    name,
    createdAt: '2026-08-01T00:00:00.000Z',
    updatedAt: '2026-08-01T00:00:00.000Z',
    activeListId: lists[0]?.id || null,
    draftWords: [],
    lists,
    history: []
  };
}

function makeMemory(profiles, activeProfileId = profiles[0]?.id || null) {
  return { version: 1, activeProfileId, profiles };
}

const PACK_ONE_LISTS = Array.from({ length: 6 }, (_, index) => makeList(
  `pack-one-${index + 1}`,
  `听写 ${index + 1}`,
  index === 0 ? ['浪费', '组屋', '一份', '停车场'] : [`甲${index + 1}`, `乙${index + 1}`, `句子${index + 1}。`]
));

const PACK_TWO_LISTS = [
  makeList('duplicate', '听写 1 duplicate title', ['浪费', '组屋', '一份', '停车场']),
  ...Array.from({ length: 4 }, (_, index) => makeList(
    `pack-two-${index + 7}`,
    `听写 ${index + 7}`,
    [`新词${index + 7}甲`, `新词${index + 7}乙`]
  ))
];

const PACK_THREE_LISTS = [
  makeList('overflow-1', '听写 11', ['超额一']),
  makeList('overflow-2', '听写 12', ['超额二'])
];

async function waitForLocalServer() {
  const deadline = Date.now() + 15000;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(LOCAL_BASE);
      if (response.ok) return;
    } catch {}
    await new Promise(resolve => setTimeout(resolve, 250));
  }
  throw new Error('Local class-pack family-import server did not start.');
}

async function waitForLiveDeployment() {
  const deadline = Date.now() + 10 * 60 * 1000;
  let last = 'not checked';
  while (Date.now() < deadline) {
    try {
      const stamp = Date.now();
      const [bootResponse, importResponse] = await Promise.all([
        fetch(`${BASE_URL}boot.js?family-import=${stamp}`, { headers: { 'cache-control': 'no-cache' } }),
        fetch(`${BASE_URL}app-class-pack-family-import.js?family-import=${stamp}`, { headers: { 'cache-control': 'no-cache' } })
      ]);
      const [boot, importer] = await Promise.all([bootResponse.text(), importResponse.text()]);
      const ready = boot.includes('app-class-pack-family-import.js?v=20260809-2')
        && importer.includes("TINGXIE_CLASS_PACK_FAMILY_IMPORT_VERSION = '20260809-2'");
      if (bootResponse.ok && importResponse.ok && ready) return;
      last = `boot=${bootResponse.status}, importer=${importResponse.status}, ready=${ready}`;
    } catch (error) {
      last = error.message;
    }
    await new Promise(resolve => setTimeout(resolve, 10000));
  }
  throw new Error(`Class-pack family import deployment did not appear. Last result: ${last}`);
}

async function installBaseStubs(context, memory, skipped = {}) {
  await context.addInitScript(({ memoryState, skippedState }) => {
    if (!localStorage.getItem('__tingxieFamilyImportTestSeeded')) {
      localStorage.setItem('tingxie:profileMemory:v1', JSON.stringify(memoryState));
      localStorage.setItem('tingxie:skippedWords:v1', JSON.stringify(skippedState));
      localStorage.setItem('hcl:saveMode', 'guest');
      localStorage.setItem('__tingxieFamilyImportTestSeeded', '1');
    }

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
  }, { memoryState: memory, skippedState: skipped });
}

async function createShareUrl(browser, profile, title) {
  const context = await browser.newContext({ viewport: { width: 430, height: 932 } });
  await installBaseStubs(context, makeMemory([profile], profile.id));
  const page = await context.newPage();
  try {
    await page.goto(`${BASE_URL}?test=class-pack&share=${Date.now()}`, { waitUntil: 'networkidle' });
    await page.waitForFunction(() => window.__tingxieClassPack?.version === '20260809-1');
    return await page.evaluate(async ({ profileData, packTitle }) => {
      return window.__tingxieClassPack.createShareUrl(profileData, packTitle);
    }, { profileData: profile, packTitle: title });
  } finally {
    await context.close();
  }
}

function testUrl(sharedUrl, label) {
  const url = new URL(sharedUrl);
  url.searchParams.set('test', 'class-pack');
  url.searchParams.set('family-import', label);
  return url.toString();
}

async function openPack(context, sharedUrl, label) {
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', error => errors.push(`pageerror: ${error.stack || error.message}`));
  page.on('console', message => { if (message.type() === 'error') errors.push(`console: ${message.text()}`); });
  page.on('requestfailed', request => errors.push(`requestfailed: ${request.url()} :: ${request.failure()?.errorText}`));
  await page.goto(testUrl(sharedUrl, label), { waitUntil: 'networkidle' });
  await page.waitForFunction(() => window.__tingxieClassPack?.isActive?.() === true);
  await page.waitForFunction(() => window.__tingxieClassPackFamilyImport?.version === '20260809-2');
  await page.waitForFunction(() => document.documentElement.dataset.tingxieClassPackFamilyImport === 'true');
  return { page, errors };
}

async function importIntoNewChild(page, name) {
  await page.locator('#classPackFamilyToggle').click();
  await page.locator('#classPackFamilyProfileSelect').selectOption('__new_child__');
  await page.locator('#classPackNewChildName').fill(name);
  await page.locator('#classPackFamilySaveConfirm').click();
  await page.waitForFunction(() => document.querySelector('#classPackFamilyStatus')?.textContent.includes('lists saved'));
}

async function importIntoExistingChild(page, profileName) {
  await page.locator('#classPackFamilyToggle').click();
  const option = page.locator('#classPackFamilyProfileSelect option').filter({ hasText: profileName }).first();
  const value = await option.getAttribute('value');
  assert.ok(value);
  await page.locator('#classPackFamilyProfileSelect').selectOption(value);
  await page.locator('#classPackFamilySaveConfirm').click();
  await page.waitForFunction(() => document.querySelector('#classPackFamilyStatus')?.textContent.includes('lists saved'));
}

async function runMultiplePackFamilyTest(browser, urls) {
  const defaultMemory = makeMemory([makeProfile('child-default', 'Child 1', [])], 'child-default');
  const privateSkipped = { 'child-default:draft': ['private-checkbox-state'] };
  const context = await browser.newContext({ viewport: { width: 430, height: 932 } });
  await installBaseStubs(context, defaultMemory, privateSkipped);

  try {
    let opened = await openPack(context, urls.one, 'one');
    let page = opened.page;
    const originalSkipped = await page.evaluate(key => localStorage.getItem(key), SKIPPED_KEY);
    assert.equal(await page.locator('#classPackFamilyToggle').innerText(), '👧 Save class pack for my child');
    await importIntoNewChild(page, 'Sarah');

    let memory = JSON.parse(await page.evaluate(key => localStorage.getItem(key), MEMORY_KEY));
    assert.equal(memory.profiles.length, 1, 'The empty default Child 1 profile should be reused for a first child.');
    assert.equal(memory.profiles[0].name, 'Sarah');
    assert.equal(memory.profiles[0].lists.length, 6);
    assert.equal(memory.profiles[0].history.length, 0);
    assert.equal(memory.profiles[0].lists.every(list => list.attempts === 0 && list.mistakes.length === 0), true);
    assert.equal(JSON.stringify(memory).includes('sender-private'), false);
    assert.equal(await page.evaluate(key => localStorage.getItem(key), SKIPPED_KEY), originalSkipped);
    assert.match(await page.locator('#classPackFamilyStatus').innerText(), /6 added/);
    assert.equal(await page.locator('#classPackOpenChildButton').isVisible(), true);
    assert.deepEqual(opened.errors, []);
    await page.close();

    opened = await openPack(context, urls.two, 'two');
    page = opened.page;
    await page.evaluate(() => {
      window.__familyCloudUploads = 0;
      window.__tingxieCloudSync.mode = () => 'username';
      window.__tingxieCloudSync.path = () => ['publicUsers', 'family123', 'children', 'TingXie', 'profile', 'memory'];
      window.__tingxieCloudSync.upload = async () => { window.__familyCloudUploads += 1; return true; };
    });
    await importIntoExistingChild(page, 'Sarah');
    memory = JSON.parse(await page.evaluate(key => localStorage.getItem(key), MEMORY_KEY));
    const sarah = memory.profiles.find(profile => profile.name === 'Sarah');
    assert.equal(sarah.lists.length, 10);
    assert.match(await page.locator('#classPackFamilyStatus').innerText(), /4 added/);
    assert.match(await page.locator('#classPackFamilyStatus').innerText(), /1 already there/);
    assert.equal(await page.evaluate(() => window.__familyCloudUploads), 1, 'Family import should explicitly upload when cloud sync is active.');
    assert.equal(await page.evaluate(key => localStorage.getItem(key), SKIPPED_KEY), originalSkipped);
    assert.deepEqual(opened.errors, []);
    await page.close();

    opened = await openPack(context, urls.three, 'three');
    page = opened.page;
    await importIntoExistingChild(page, 'Sarah');
    memory = JSON.parse(await page.evaluate(key => localStorage.getItem(key), MEMORY_KEY));
    assert.equal(memory.profiles.find(profile => profile.name === 'Sarah').lists.length, 10);
    assert.match(await page.locator('#classPackFamilyStatus').innerText(), /2 could not fit/);
    assert.equal(await page.evaluate(key => localStorage.getItem(key), SKIPPED_KEY), originalSkipped);
    assert.deepEqual(opened.errors, []);
    await page.screenshot({ path: '/tmp/tingxie-class-pack-family-import-pass.png', fullPage: true });
    await page.close();
  } finally {
    await context.close();
  }
}

async function runFiveChildLimitTest(browser, sharedUrl) {
  const profiles = Array.from({ length: 4 }, (_, index) => makeProfile(`kid-${index + 1}`, `Kid ${index + 1}`, []));
  const context = await browser.newContext({ viewport: { width: 430, height: 932 } });
  await installBaseStubs(context, makeMemory(profiles, profiles[0].id));
  const { page, errors } = await openPack(context, sharedUrl, 'limit');
  try {
    await importIntoNewChild(page, 'Kid 5');
    const memory = JSON.parse(await page.evaluate(key => localStorage.getItem(key), MEMORY_KEY));
    assert.equal(memory.profiles.length, 5);
    assert.equal(memory.profiles.some(profile => profile.name === 'Kid 5'), true);

    const newOptions = page.locator('#classPackFamilyProfileSelect option[value="__new_child__"]');
    assert.equal(await newOptions.count(), 0, 'A family with 5 children must not offer a sixth child option.');

    const rejected = await page.evaluate(async () => {
      try {
        await window.__tingxieClassPackFamilyImport.importCurrent({ newChild: true, name: 'Kid 6' });
        return null;
      } catch (error) {
        return error.message;
      }
    });
    assert.match(rejected, /already has 5 child profiles/i);
    assert.deepEqual(errors, []);
    await page.screenshot({ path: '/tmp/tingxie-class-pack-five-child-limit-pass.png', fullPage: true });
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
  const urls = {
    one: await createShareUrl(browser, makeProfile('teacher-one', 'Teacher', PACK_ONE_LISTS), 'Pack One'),
    two: await createShareUrl(browser, makeProfile('teacher-two', 'Teacher', PACK_TWO_LISTS), 'Pack Two'),
    three: await createShareUrl(browser, makeProfile('teacher-three', 'Teacher', PACK_THREE_LISTS), 'Pack Three')
  };

  await runMultiplePackFamilyTest(browser, urls);
  await runFiveChildLimitTest(browser, urls.one);
  console.log(IS_LIVE ? 'TINGXIE_LIVE_CLASS_PACK_FAMILY_IMPORT_PASS' : 'TINGXIE_CLASS_PACK_FAMILY_IMPORT_PASS');
} catch (error) {
  const detail = error.stack || String(error);
  await fs.writeFile(FAILURE_LOG, detail, 'utf8');
  console.error(IS_LIVE ? 'TINGXIE_LIVE_CLASS_PACK_FAMILY_IMPORT_FAILURE' : 'TINGXIE_CLASS_PACK_FAMILY_IMPORT_FAILURE');
  console.error(detail);
  process.exitCode = 1;
} finally {
  await browser?.close();
  server?.kill('SIGTERM');
}
