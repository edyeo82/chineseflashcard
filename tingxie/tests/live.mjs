import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';

const LIVE_URL = 'https://edyeo82.github.io/chineseflashcard/tingxie/';
const EXPECTED_VERSION = '20260719-5';
const FIXTURE = '/tmp/tingxie-live-fixture.png';
const SCREENSHOT = '/tmp/tingxie-live-pass.png';
const FAILURE_SCREENSHOT = '/tmp/tingxie-live-failure.png';
const FAILURE_LOG = '/tmp/tingxie-live-error.txt';

const sleep = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds));

async function waitForDeployment() {
  const deadline = Date.now() + 8 * 60 * 1000;
  let lastMessage = 'No response yet.';

  while (Date.now() < deadline) {
    try {
      const response = await fetch(`${LIVE_URL}?deployment-check=${Date.now()}`, {
        headers: { 'cache-control': 'no-cache' }
      });
      const html = await response.text();
      if (response.ok && html.includes(EXPECTED_VERSION) && html.includes('appReadyStatus')) {
        console.log('TINGXIE_LIVE_MILESTONE: deployed-version-visible');
        return;
      }
      lastMessage = `HTTP ${response.status}; version present=${html.includes(EXPECTED_VERSION)}`;
    } catch (error) {
      lastMessage = error.message;
    }
    console.log(`Waiting for GitHub Pages deployment: ${lastMessage}`);
    await sleep(10000);
  }

  throw new Error(`The expected Pages build did not appear within 8 minutes. Last result: ${lastMessage}`);
}

async function addBrowserStubs(context) {
  await context.addInitScript(() => {
    class FakeUtterance {
      constructor(text) {
        this.text = text;
        this.lang = 'zh-CN';
        this.rate = 1;
      }
    }
    Object.defineProperty(window, 'SpeechSynthesisUtterance', { value: FakeUtterance, configurable: true });
    Object.defineProperty(window, 'speechSynthesis', {
      value: {
        getVoices: () => [{ name: 'Test Mandarin', lang: 'zh-CN', localService: true }],
        speak: utterance => setTimeout(() => utterance.onend?.(), 5),
        cancel: () => {},
        onvoiceschanged: null
      },
      configurable: true
    });
  });
}

async function makeFixture(browser) {
  const context = await browser.newContext({ viewport: { width: 900, height: 800 } });
  const page = await context.newPage();
  await page.setContent(`<!doctype html><html><body style="margin:0;background:white"><div id="sheet" style="width:760px;padding:45px;font-family:'Noto Sans CJK SC','Arial Unicode MS',sans-serif;font-size:56px;line-height:1.55;color:#111;background:#fff">1. 浪费<br>2. 组屋<br>3. 所以<br>4. 如果<br>5. 车辆<br>6. 一份<br>7. 尽力<br>8. 超市<br>9. 日用品<br>10. 停车场</div></body></html>`);
  await page.locator('#sheet').screenshot({ path: FIXTURE });
  await context.close();
}

async function verifyLivePage(browser) {
  const context = await browser.newContext({ viewport: { width: 430, height: 932 } });
  await addBrowserStubs(context);

  const mockText = '1. 浪费\n2. 组屋\n3. 所以\n4. 如果\n5. 车辆\n6. 一份\n7. 尽力\n8. 超市\n9. 日用品\n10. 停车场';
  await context.route(/tesseract\.min\.js/, route => route.fulfill({
    contentType: 'application/javascript',
    body: `window.Tesseract={createWorker:async function(langs,oem,options){options.logger&&options.logger({status:'loading language traineddata',progress:.35});return{recognize:async function(){options.logger&&options.logger({status:'recognizing text',progress:.8});return{data:{text:${JSON.stringify(mockText)}}}},terminate:async function(){}}}};`
  }));

  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', error => errors.push(`pageerror: ${error.stack || error.message}`));
  page.on('console', message => {
    if (message.type() === 'error') errors.push(`console: ${message.text()}`);
  });
  page.on('requestfailed', request => errors.push(`requestfailed: ${request.url()} :: ${request.failure()?.errorText}`));

  try {
    await page.goto(`${LIVE_URL}?live-browser-check=${Date.now()}`, { waitUntil: 'networkidle' });
    assert.match(await page.locator('#appReadyStatus').innerText(), /App ready/);
    assert.equal(await page.locator('html').getAttribute('data-tingxie-events-bound'), 'true');
    console.log('TINGXIE_LIVE_MILESTONE: public-app-ready');

    await page.locator('#sourceImage').setInputFiles(FIXTURE);
    await page.locator('#sourcePreview:not(.hidden)').waitFor();
    assert.equal(await page.locator('#scanSourceButton').isEnabled(), true);
    console.log('TINGXIE_LIVE_MILESTONE: public-photo-loaded');

    await page.locator('#scanSourceButton').click();
    await page.locator('#sourceProgress:not(.hidden)').waitFor();
    await page.waitForFunction(() => document.querySelector('#wordList')?.value.includes('停车场'));
    assert.match(await page.locator('#sourceProgressText').innerText(), /Finished reading the photo/);
    assert.equal(await page.locator('#startDictationButton').isEnabled(), true);
    assert.deepEqual(errors, []);
    console.log('TINGXIE_LIVE_MILESTONE: public-ocr-button-pass');

    await page.screenshot({ path: SCREENSHOT, fullPage: true });
  } catch (error) {
    await page.screenshot({ path: FAILURE_SCREENSHOT, fullPage: true }).catch(() => {});
    const state = await page.evaluate(() => ({
      url: location.href,
      ready: document.documentElement.dataset.tingxieEventsBound,
      status: document.querySelector('#appReadyStatus')?.textContent,
      toast: document.querySelector('#toast')?.textContent,
      buttonDisabled: document.querySelector('#scanSourceButton')?.disabled,
      buttonText: document.querySelector('#scanSourceButton')?.textContent,
      progress: document.querySelector('#sourceProgressText')?.textContent,
      words: document.querySelector('#wordList')?.value
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
  await makeFixture(browser);
  await verifyLivePage(browser);
  await fs.access(SCREENSHOT);
  console.log('TINGXIE_LIVE_PASS');
} catch (error) {
  const detail = error.stack || String(error);
  await fs.writeFile(FAILURE_LOG, detail, 'utf8');
  console.error('TINGXIE_LIVE_FAILURE');
  console.error(detail);
  process.exitCode = 1;
} finally {
  await browser?.close();
}
