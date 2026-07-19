import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';

const PORT = 4178;
const BASE_URL = `http://127.0.0.1:${PORT}`;
const FAILURE_LOG = '/tmp/tingxie-paste-list-error.txt';
const EXPECTED = [
  '老虎', '狮子', '旗子', '华族', '兴奋', '弯月', '国庆日', '亮晶晶', '五颗星', '一座山',
  '老师把一张世界地图贴在白板上。',
  '每天早上，我们会先唱国歌才上课。',
  '妈妈竖起大拇指，夸我们都是乖孩子。'
];

const CHATGPT_CLIPBOARD = `The intended OCR output should be:

\`\`\`text
老虎
狮子
旗子
华族
兴奋
弯月
国庆日
亮晶晶
五颗星
一座山
老师把一张世界地图贴在白板上。
每天早上，我们会先唱国歌才上课。
妈妈竖起大拇指，夸我们都是乖孩子。
\`\`\`

With numbering:

1. 老虎
2. 狮子
3. 旗子
4. 华族
5. 兴奋
6. 弯月
7. 国庆日
8. 亮晶晶
9. 五颗星
10. 一座山
11. 老师把一张世界地图贴在白板上。
12. 每天早上，我们会先唱国歌才上课。
13. 妈妈竖起大拇指，夸我们都是乖孩子。

The page heading is **听写（十二）第十二课**, dated **8月11日**.`;

const server = spawn('python3', ['-m', 'http.server', String(PORT), '--directory', '.'], {
  stdio: ['ignore', 'pipe', 'pipe']
});

async function waitForServer() {
  const deadline = Date.now() + 15000;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`${BASE_URL}/tingxie/`);
      if (response.ok) return;
    } catch {}
    await new Promise(resolve => setTimeout(resolve, 250));
  }
  throw new Error('Local server did not start.');
}

let browser;
let context;
let page;
const errors = [];
try {
  await waitForServer();
  browser = await chromium.launch({ headless: true });
  context = await browser.newContext({ viewport: { width: 430, height: 932 } });
  await context.addInitScript(clipboardText => {
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { readText: async () => clipboardText }
    });

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
  }, CHATGPT_CLIPBOARD);

  page = await context.newPage();
  page.on('pageerror', error => errors.push(`pageerror: ${error.stack || error.message}`));
  page.on('console', message => { if (message.type() === 'error') errors.push(`console: ${message.text()}`); });
  page.on('requestfailed', request => errors.push(`requestfailed: ${request.url()} :: ${request.failure()?.errorText}`));

  await page.goto(`${BASE_URL}/tingxie/?test=deterministic`, { waitUntil: 'networkidle' });
  await page.waitForFunction(() => document.documentElement.dataset.tingxiePasteReady === 'true');

  assert.equal(await page.locator('#pasteListButton').isVisible(), true);
  await page.locator('#pasteListButton').click();
  await page.waitForFunction(() => document.querySelector('#wordList')?.value.split('\n').filter(Boolean).length === 13);

  const actual = (await page.locator('#wordList').inputValue()).split('\n').filter(Boolean);
  assert.deepEqual(actual, EXPECTED);
  assert.equal(await page.locator('#wordCount').innerText(), '13 items');
  assert.equal(await page.locator('#startDictationButton').isEnabled(), true);
  assert.match(await page.locator('#pasteListStatus').innerText(), /Pasted 13 items/);

  await page.locator('#startDictationButton').click();
  await page.locator('#dictationPanel.active').waitFor();
  assert.equal(await page.locator('#itemNumber').innerText(), '第 1 题');
  assert.equal(await page.locator('#dictationProgressText').innerText(), '1 of 13');
  assert.deepEqual(errors, []);

  await page.screenshot({ path: '/tmp/tingxie-paste-list-pass.png', fullPage: true });
  console.log('TINGXIE_PASTE_LIST_PASS');
} catch (error) {
  await page?.screenshot({ path: '/tmp/tingxie-paste-list-failure.png', fullPage: true }).catch(() => {});
  const state = await page?.evaluate(() => ({
    pasteReady: document.documentElement.dataset.tingxiePasteReady,
    words: document.querySelector('#wordList')?.value,
    count: document.querySelector('#wordCount')?.textContent,
    status: document.querySelector('#pasteListStatus')?.textContent,
    toast: document.querySelector('#toast')?.textContent
  })).catch(() => ({}));
  const detail = `${error.stack || error}\nBrowser errors:\n${errors.join('\n')}\nPage state:\n${JSON.stringify(state, null, 2)}`;
  await fs.writeFile(FAILURE_LOG, detail, 'utf8');
  console.error('TINGXIE_PASTE_LIST_FAILURE');
  console.error(detail);
  process.exitCode = 1;
} finally {
  await context?.close();
  await browser?.close();
  server.kill('SIGTERM');
}
