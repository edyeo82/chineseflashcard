import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';

const PORT = 4184;
const LOCAL_BASE = `http://127.0.0.1:${PORT}/tingxie/`;
const BASE_URL = process.env.TINGXIE_BASE_URL || LOCAL_BASE;
const IS_LIVE = Boolean(process.env.TINGXIE_BASE_URL);
const FAILURE_LOG = '/tmp/tingxie-class-pack-error.txt';
const PACK_TITLE = 'P5 Chinese · 听写 1–10';
const PERSONAL_MEMORY_KEY = 'tingxie:profileMemory:v1';
const PERSONAL_SKIPPED_KEY = 'tingxie:skippedWords:v1';
const CLASS_PROGRESS_KEY = 'tingxie:classPackProgress:v1';

const SHARED_LISTS = Array.from({ length: 10 }, (_, index) => ({
  id: `teacher-list-${index + 1}`,
  title: `听写 ${index + 1}`,
  customTitle: true,
  words: index === 0
    ? ['浪费', '组屋', '一份', '停车场']
    : [`词语${index + 1}A`, `词语${index + 1}B`, `句子${index + 1}。`],
  createdAt: `2026-08-${String(index + 1).padStart(2, '0')}T00:00:00.000Z`,
  updatedAt: `2026-08-${String(index + 1).padStart(2, '0')}T00:00:00.000Z`,
  attempts: 4,
  bestScore: 9,
  lastScore: 8,
  lastTotal: 10,
  mistakes: ['不应分享']
}));

function makeMemory(profileName, profileId, lists, activeListId) {
  return {
    version: 1,
    activeProfileId: profileId,
    profiles: [{
      id: profileId,
      name: profileName,
      createdAt: '2026-08-01T00:00:00.000Z',
      updatedAt: '2026-08-09T00:00:00.000Z',
      activeListId,
      draftWords: [],
      lists,
      history: [{ date: '2026-08-08T00:00:00.000Z', correct: 5, total: 6, mistakes: ['private-history'] }]
    }]
  };
}

const TEACHER_MEMORY = makeMemory('Teacher source', 'teacher-profile', SHARED_LISTS, SHARED_LISTS[0].id);
const STUDENT_MEMORY = makeMemory('Student own profile', 'student-profile', [{
  id: 'student-list',
  title: 'My own list',
  customTitle: true,
  words: ['自己的', '进度'],
  createdAt: '2026-08-01T00:00:00.000Z',
  updatedAt: '2026-08-01T00:00:00.000Z',
  attempts: 0,
  bestScore: null,
  lastScore: null,
  lastTotal: null,
  mistakes: []
}], 'student-list');
const STUDENT_SKIPPED = { 'student-profile:student-list': ['自己的'] };
const TEACHER_SKIPPED = { 'teacher-profile:teacher-list-1': ['浪费'] };

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
  throw new Error('Local class-pack test server did not start.');
}

async function waitForLiveDeployment() {
  const deadline = Date.now() + 10 * 60 * 1000;
  let last = 'not checked';
  while (Date.now() < deadline) {
    try {
      const stamp = Date.now();
      const [pageResponse, bootResponse, packResponse] = await Promise.all([
        fetch(`${BASE_URL}?classpack-deployment=${stamp}`, { headers: { 'cache-control': 'no-cache' } }),
        fetch(`${BASE_URL}boot.js?classpack-deployment=${stamp}`, { headers: { 'cache-control': 'no-cache' } }),
        fetch(`${BASE_URL}app-class-pack.js?classpack-deployment=${stamp}`, { headers: { 'cache-control': 'no-cache' } })
      ]);
      const [page, boot, pack] = await Promise.all([pageResponse.text(), bootResponse.text(), packResponse.text()]);
      const ready = page.includes('boot.js?v=20260809-1')
        && boot.includes("TINGXIE_BOOT_VERSION = '20260809-1'")
        && pack.includes("TINGXIE_CLASS_PACK_VERSION = '20260809-1'");
      if (pageResponse.ok && bootResponse.ok && packResponse.ok && ready) return;
      last = `page=${pageResponse.status}, boot=${bootResponse.status}, pack=${packResponse.status}, ready=${ready}`;
    } catch (error) {
      last = error.message;
    }
    await new Promise(resolve => setTimeout(resolve, 10000));
  }
  throw new Error(`Class-pack deployment did not appear. Last result: ${last}`);
}

async function installBaseStubs(context, memory, skipped, captureShare = false) {
  await context.addInitScript(({ memoryState, skippedState, shouldCaptureShare }) => {
    localStorage.setItem('tingxie:profileMemory:v1', JSON.stringify(memoryState));
    localStorage.setItem('tingxie:skippedWords:v1', JSON.stringify(skippedState));
    localStorage.setItem('hcl:saveMode', 'guest');
    window.__sharedClassPack = null;

    if (shouldCaptureShare) {
      Object.defineProperty(navigator, 'share', {
        configurable: true,
        value: async data => { window.__sharedClassPack = data; }
      });
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
  }, { memoryState: memory, skippedState: skipped, shouldCaptureShare: captureShare });
}

async function openNormalPage(context, label) {
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', error => errors.push(`pageerror: ${error.stack || error.message}`));
  page.on('console', message => { if (message.type() === 'error') errors.push(`console: ${message.text()}`); });
  page.on('requestfailed', request => errors.push(`requestfailed: ${request.url()} :: ${request.failure()?.errorText}`));
  await page.goto(`${BASE_URL}?test=class-pack&device=${label}&stamp=${Date.now()}`, { waitUntil: 'networkidle' });
  await page.waitForFunction(() => window.__tingxieClassPack?.version === '20260809-1');
  return { page, errors };
}

function withClassPackTestQuery(sharedUrl) {
  const url = new URL(sharedUrl);
  url.search = '?test=class-pack';
  return url.toString();
}

async function openSharedPage(context, sharedUrl, label) {
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', error => errors.push(`pageerror: ${error.stack || error.message}`));
  page.on('console', message => { if (message.type() === 'error') errors.push(`console: ${message.text()}`); });
  page.on('requestfailed', request => errors.push(`requestfailed: ${request.url()} :: ${request.failure()?.errorText}`));
  const url = new URL(withClassPackTestQuery(sharedUrl));
  url.searchParams.set('student', label);
  await page.goto(url.toString(), { waitUntil: 'networkidle' });
  await page.waitForFunction(() => document.documentElement.dataset.tingxieClassPack === 'true');
  await page.waitForFunction(() => window.__tingxieClassPack?.isActive?.() === true);
  return { page, errors };
}

async function createTeacherShare(browser) {
  const context = await browser.newContext({ viewport: { width: 430, height: 932 } });
  await installBaseStubs(context, TEACHER_MEMORY, TEACHER_SKIPPED, true);
  const { page, errors } = await openNormalPage(context, 'teacher');
  try {
    const beforeMemory = await page.evaluate(() => localStorage.getItem(PERSONAL_MEMORY_KEY), PERSONAL_MEMORY_KEY);
    const beforeSkipped = await page.evaluate(() => localStorage.getItem(PERSONAL_SKIPPED_KEY), PERSONAL_SKIPPED_KEY);
    assert.equal(await page.locator('#memoryListCount').innerText(), '10/10 saved');
    assert.equal(await page.locator('#shareClassPackButton').isVisible(), true);

    page.once('dialog', dialog => dialog.accept(PACK_TITLE));
    await page.locator('#shareClassPackButton').click();
    await page.waitForFunction(() => Boolean(window.__sharedClassPack?.url));
    const shared = await page.evaluate(() => window.__sharedClassPack);
    assert.match(shared.url, /#classpack=(?:g|b)\./);
    assert.match(shared.text, /10 听写 lists/);

    const afterMemory = await page.evaluate(() => localStorage.getItem(PERSONAL_MEMORY_KEY), PERSONAL_MEMORY_KEY);
    const afterSkipped = await page.evaluate(() => localStorage.getItem(PERSONAL_SKIPPED_KEY), PERSONAL_SKIPPED_KEY);
    assert.equal(afterMemory, beforeMemory);
    assert.equal(afterSkipped, beforeSkipped);
    assert.deepEqual(errors, []);
    return shared.url;
  } finally {
    await context.close();
  }
}

async function runStudentA(browser, sharedUrl) {
  const context = await browser.newContext({ viewport: { width: 430, height: 932 } });
  await installBaseStubs(context, STUDENT_MEMORY, STUDENT_SKIPPED, false);
  const { page, errors } = await openSharedPage(context, sharedUrl, 'A');
  try {
    const beforeMemory = await page.evaluate(() => localStorage.getItem(PERSONAL_MEMORY_KEY), PERSONAL_MEMORY_KEY);
    const beforeSkipped = await page.evaluate(() => localStorage.getItem(PERSONAL_SKIPPED_KEY), PERSONAL_SKIPPED_KEY);
    const pack = await page.evaluate(() => window.__tingxieClassPack.pack());

    assert.equal(pack.title, PACK_TITLE);
    assert.equal(pack.lists.length, 10);
    assert.equal(Object.hasOwn(pack, 'history'), false);
    assert.equal(JSON.stringify(pack).includes('private-history'), false);
    assert.equal(JSON.stringify(pack).includes('不应分享'), false);
    assert.equal(await page.locator('#classPackListSelect option').count(), 10);
    assert.equal(await page.locator('#classPackListCount').innerText(), '1 of 10');
    assert.equal(await page.locator('#wordList').inputValue(), '浪费\n组屋\n一份\n停车场');
    assert.equal(await page.locator('#wordList').getAttribute('readonly'), '');

    const firstCheckbox = page.locator('#wordChecklistRows .word-checklist-row input').first();
    assert.equal(await firstCheckbox.isChecked(), false, 'Teacher checkbox state must not travel in the share link.');
    await firstCheckbox.check();
    assert.equal(await firstCheckbox.isChecked(), true);

    const normalSkippedAfterCheck = await page.evaluate(() => localStorage.getItem(PERSONAL_SKIPPED_KEY), PERSONAL_SKIPPED_KEY);
    assert.equal(normalSkippedAfterCheck, beforeSkipped, 'Class checkbox must not alter the student normal checklist store.');
    const classProgress = JSON.parse(await page.evaluate(() => localStorage.getItem(CLASS_PROGRESS_KEY) || '{}', CLASS_PROGRESS_KEY));
    assert.equal(Object.values(classProgress).some(values => values.includes('浪费')), true);

    await page.locator('#classPackListSelect').selectOption('list-2');
    await page.waitForFunction(() => document.querySelector('#classPackListCount')?.textContent === '2 of 10');
    assert.match(await page.locator('#wordList').inputValue(), /词语2A/);
    await page.locator('#classPackListSelect').selectOption('list-1');
    await page.waitForFunction(() => document.querySelector('#classPackListCount')?.textContent === '1 of 10');
    assert.equal(await page.locator('#wordChecklistRows .word-checklist-row input').first().isChecked(), true, 'Student A class progress should persist for the class pack.');

    await page.locator('#startDictationButton').click();
    await page.locator('#dictationPanel.active').waitFor();
    const reading = await page.evaluate(() => window.__tingxieReaderMode.snapshot());
    assert.deepEqual(reading.words, ['组屋', '一份', '停车场']);
    await page.locator('#exitDictationButton').click();
    await page.locator('#setupPanel.active').waitFor();

    const afterMemory = await page.evaluate(() => localStorage.getItem(PERSONAL_MEMORY_KEY), PERSONAL_MEMORY_KEY);
    const afterSkipped = await page.evaluate(() => localStorage.getItem(PERSONAL_SKIPPED_KEY), PERSONAL_SKIPPED_KEY);
    assert.equal(afterMemory, beforeMemory, 'Opening and reading a class pack must not alter the student saved profile.');
    assert.equal(afterSkipped, beforeSkipped, 'Opening and reading a class pack must not alter the student normal checkboxes.');

    await page.locator('#exitClassPackButton').click();
    await page.waitForFunction(() => !document.documentElement.dataset.tingxieClassPack);
    await page.waitForFunction(() => document.querySelector('#wordList')?.value === '自己的\n进度');
    assert.equal(await page.locator('#memoryProfileSelect option:checked').innerText(), 'Student own profile');

    assert.deepEqual(errors, []);
    await page.screenshot({ path: '/tmp/tingxie-class-pack-student-a-pass.png', fullPage: true });
  } finally {
    await context.close();
  }
}

async function runStudentB(browser, sharedUrl) {
  const context = await browser.newContext({ viewport: { width: 430, height: 932 } });
  await installBaseStubs(context, STUDENT_MEMORY, STUDENT_SKIPPED, false);
  const { page, errors } = await openSharedPage(context, sharedUrl, 'B');
  try {
    assert.equal(await page.locator('#wordChecklistRows .word-checklist-row input').first().isChecked(), false, 'Student B must not inherit Student A checkbox progress.');
    assert.equal(await page.locator('#classPackListSelect option').count(), 10);
    assert.equal(await page.locator('#wordList').inputValue(), '浪费\n组屋\n一份\n停车场');
    assert.deepEqual(errors, []);
    await page.screenshot({ path: '/tmp/tingxie-class-pack-student-b-pass.png', fullPage: true });
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
  const sharedUrl = await createTeacherShare(browser);
  await runStudentA(browser, sharedUrl);
  await runStudentB(browser, sharedUrl);
  console.log(IS_LIVE ? 'TINGXIE_LIVE_CLASS_PACK_PASS' : 'TINGXIE_CLASS_PACK_PASS');
} catch (error) {
  const detail = error.stack || String(error);
  await fs.writeFile(FAILURE_LOG, detail, 'utf8');
  console.error(IS_LIVE ? 'TINGXIE_LIVE_CLASS_PACK_FAILURE' : 'TINGXIE_CLASS_PACK_FAILURE');
  console.error(detail);
  process.exitCode = 1;
} finally {
  await browser?.close();
  server?.kill('SIGTERM');
}
