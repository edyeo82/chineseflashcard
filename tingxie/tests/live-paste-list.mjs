import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';

const LIVE_URL = 'https://edyeo82.github.io/chineseflashcard/tingxie/';
const EXPECTED_VERSION = '20260719-7';
const SCREENSHOT = '/tmp/tingxie-live-paste-pass.png';
const FAILURE_SCREENSHOT = '/tmp/tingxie-live-paste-failure.png';
const FAILURE_LOG = '/tmp/tingxie-live-paste-error.txt';
const EXPECTED = [
  '老虎', '狮子', '旗子', '华族', '兴奋', '弯月', '国庆日', '亮晶晶', '五颗星', '一座山',
  '老师把一张世界地图贴在白板上。',
  '每天早上，我们会先唱国歌才上课。',
  '妈妈竖起大拇指，夸我们都是乖孩子。'
];
const CLIPBOARD_TEXT = `Here is the list:
\`\`\`text
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
\`\`\`
The heading is 听写（十二）第十二课.`;

const sleep = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds));

async function waitForDeployment() {
  const deadline = Date.now() + 10 * 60 * 1000;
  let lastMessage = 'No response yet.';
  while (Date.now() < deadline) {
    try {
      const stamp = Date.now();
      const [bootResponse, pasteResponse] = await Promise.all([
        fetch(`${LIVE_URL}boot.js?deployment-check=${stamp}`, { headers: { 'cache-control': 'no-cache' } }),
        fetch(`${LIVE_URL}app-paste-list.js?deployment-check=${stamp}`, { headers: { 'cache-control': 'no-cache' } })
      ]);
      const [bootText, pasteText] = await Promise.all([bootResponse.text(), pasteResponse.text()]);
      const versionPresent = bootText.includes(EXPECTED_VERSION);
      const pastePresent = pasteText.includes('tingxie-paste-v1');
      if (bootResponse.ok && pasteResponse.ok && versionPresent && pastePresent) {
        console.log('TINGXIE_LIVE_PASTE_MILESTONE: deployment-visible');
        return;
      }
      lastMessage = `boot=${bootResponse.status}, paste=${pasteResponse.status}, version=${versionPresent}, module=${pastePresent}`;
    } catch (error) {
      lastMessage = error.message;
    }
    console.log(`Waiting for paste-list Pages deployment: ${lastMessage}`);
    await sleep(10000);
  }
  throw new Error(`The paste-list Pages build did not appear within 10 minutes. Last result: ${lastMessage}`);
}

async function verifyLivePage(browser) {
  const context = await browser.newContext({ viewport: { width: 430, height: 932 } });
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
  }, CLIPBOARD_TEXT);

  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', error => errors.push(`pageerror: ${error.stack || error.message}`));
  page.on('console', message => { if (message.type() === 'error') errors.push(`console: ${message.text()}`); });
  page.on('requestfailed', request => errors.push(`requestfailed: ${request.url()} :: ${request.failure()?.errorText}`));

  try {
    await page.goto(`${LIVE_URL}?test=deterministic&live-paste-check=${Date.now()}`, { waitUntil: 'networkidle' });
    await page.waitForFunction(() => document.documentElement.dataset.tingxiePasteReady === 'true', null, { timeout: 15000 });
    assert.equal(await page.locator('#pasteListButton').isVisible(), true);

    await page.locator('#pasteListButton').click();
    await page.waitForFunction(() => document.querySelector('#wordList')?.value.split('\n').filter(Boolean).length === 13, null, { timeout: 10000 });
    const actual = (await page.locator('#wordList').inputValue()).split('\n').filter(Boolean);
    assert.deepEqual(actual, EXPECTED);
    assert.equal(await page.locator('#wordCount').innerText(), '13 items');
    assert.equal(await page.locator('#startDictationButton').isEnabled(), true);

    await page.locator('#startDictationButton').click();
    await page.locator('#dictationPanel.active').waitFor();
    assert.equal(await page.locator('#dictationProgressText').innerText(), '1 of 13');
    assert.deepEqual(errors, []);

    console.log('TINGXIE_LIVE_PASTE_MILESTONE: public-paste-to-dictation-pass');
    await page.screenshot({ path: SCREENSHOT, fullPage: true });
  } catch (error) {
    await page.screenshot({ path: FAILURE_SCREENSHOT, fullPage: true }).catch(() => {});
    const state = await page.evaluate(() => ({
      url: location.href,
      pasteReady: document.documentElement.dataset.tingxiePasteReady,
      words: document.querySelector('#wordList')?.value,
      count: document.querySelector('#wordCount')?.textContent,
      status: document.querySelector('#pasteListStatus')?.textContent,
      toast: document.querySelector('#toast')?.textContent
    })).catch(() => ({}));
    throw new Error(`${error.stack || error}\nBrowser errors:\n${errors.join('\n')}\nPage state:\n${JSON.stringify(state, null, 2)}`);
  } finally {
    await context.close();
  }
}

let browser;
try {
  await waitForDeployment();
  browser = await chromium.launch({ headless: true });
  await verifyLivePage(browser);
  await fs.access(SCREENSHOT);
  console.log('TINGXIE_LIVE_PASTE_PASS');
} catch (error) {
  const detail = error.stack || String(error);
  await fs.writeFile(FAILURE_LOG, detail, 'utf8');
  console.error('TINGXIE_LIVE_PASTE_FAILURE');
  console.error(detail);
  process.exitCode = 1;
} finally {
  await browser?.close();
}
