import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';

const PORT = 4173;
const BASE_URL = `http://127.0.0.1:${PORT}`;
const FIXTURE = '/tmp/tingxie-fixture.png';

const server = spawn('python3', ['-m', 'http.server', String(PORT), '--directory', 'tingxie'], {
  stdio: ['ignore', 'pipe', 'pipe']
});

const waitForServer = async () => {
  const deadline = Date.now() + 15000;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(BASE_URL);
      if (response.ok) return;
    } catch {}
    await new Promise(resolve => setTimeout(resolve, 250));
  }
  throw new Error('Local Ting Xie server did not start.');
};

const addBrowserStubs = async context => {
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
};

const makeFixture = async browser => {
  const context = await browser.newContext({ viewport: { width: 900, height: 900 } });
  const page = await context.newPage();
  await page.setContent(`<!doctype html><html><body style="margin:0;background:white"><div id="sheet" style="width:760px;padding:45px;font-family:'Noto Sans CJK SC','Arial Unicode MS',sans-serif;font-size:56px;line-height:1.55;color:#111;background:#fff">1. 浪费<br>2. 组屋<br>3. 所以<br>4. 如果<br>5. 车辆<br>6. 一份<br>7. 尽力<br>8. 超市<br>9. 日用品<br>10. 停车场</div></body></html>`);
  await page.locator('#sheet').screenshot({ path: FIXTURE });
  await context.close();
};

const MOCK_OCR_TEXT = `1. 浪费\n2. 组屋\n3. 所以\n4. 如果\n5. 车辆\n6. 一份\n7. 尽力\n8. 超市\n9. 日用品\n10. 停车场\n11. 我认为开着灯睡觉是不对的。\n12. 读过的报纸，我们可以废物利用。\n默写：妈妈购物时，都会用环保袋装东西。`;

const runDeterministicFlow = async browser => {
  const context = await browser.newContext({ viewport: { width: 430, height: 932 } });
  await addBrowserStubs(context);
  await context.route(/tesseract\.min\.js/, route => route.fulfill({
    contentType: 'application/javascript',
    body: `window.Tesseract={createWorker:async function(langs,oem,options){options.logger&&options.logger({status:'loading language traineddata',progress:.35});return{recognize:async function(){options.logger&&options.logger({status:'recognizing text',progress:.8});return{data:{text:${JSON.stringify(MOCK_OCR_TEXT)}}}},terminate:async function(){}}}};`
  }));

  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto(`${BASE_URL}/?test=deterministic`, { waitUntil: 'networkidle' });

  await page.locator('#appReadyStatus').waitFor();
  assert.match(await page.locator('#appReadyStatus').innerText(), /App ready/);
  assert.equal(await page.locator('html').getAttribute('data-tingxie-events-bound'), 'true');

  await page.locator('#sourceImage').setInputFiles(FIXTURE);
  await page.locator('#sourcePreview:not(.hidden)').waitFor();
  assert.equal(await page.locator('#scanSourceButton').isEnabled(), true);

  await page.locator('#scanSourceButton').click();
  await page.locator('#sourceProgress:not(.hidden)').waitFor();
  await page.locator('#wordList').waitFor({ state: 'visible' });
  await page.waitForFunction(() => document.querySelector('#wordList').value.includes('停车场'));

  const words = (await page.locator('#wordList').inputValue()).split('\n').filter(Boolean);
  assert.ok(words.includes('浪费'));
  assert.ok(words.includes('停车场'));
  assert.ok(words.some(word => word.includes('我认为开着灯睡觉是不对的')));
  assert.equal(await page.locator('#startDictationButton').isEnabled(), true);

  await page.locator('#startDictationButton').click();
  await page.locator('#dictationPanel.active').waitFor();
  assert.match(await page.locator('#dictationProgressText').innerText(), /^1 of /);

  for (let index = 0; index < words.length; index += 1) {
    await page.locator('#nextButton').click();
  }
  await page.locator('#markingPanel.active').waitFor();

  const answers = words.slice();
  answers[0] = '浪废';
  answers.splice(1, 1);
  await page.locator('#answerText').fill(answers.join('\n'));
  await page.locator('#compareButton').click();
  await page.locator('#markingTableWrap:not(.hidden)').waitFor();
  assert.equal(await page.locator('.mark-row').count(), words.length);

  await page.locator('#saveMarkingButton').click();
  await page.locator('#reviewPanel.active').waitFor();
  assert.ok(await page.locator('.mistake-card').count() >= 1);
  assert.deepEqual(errors, []);

  await page.screenshot({ path: '/tmp/tingxie-smoke-final.png', fullPage: true });
  await context.close();
};

const runRealOcrFlow = async browser => {
  const context = await browser.newContext({ viewport: { width: 430, height: 932 } });
  await addBrowserStubs(context);
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto(`${BASE_URL}/?test=real-ocr`, { waitUntil: 'networkidle' });
  assert.match(await page.locator('#appReadyStatus').innerText(), /App ready/);

  await page.locator('#sourceImage').setInputFiles(FIXTURE);
  await page.locator('#scanSourceButton').click();
  await page.waitForFunction(() => {
    const value = document.querySelector('#wordList')?.value || '';
    const errorText = document.querySelector('#sourceProgressText')?.textContent || '';
    return value.length > 0 || /failed|could not|timed out/i.test(errorText);
  }, { timeout: 150000 });

  const value = await page.locator('#wordList').inputValue();
  if (!value) {
    throw new Error(`Real OCR did not populate the list: ${await page.locator('#sourceProgressText').innerText()}`);
  }
  assert.ok(/[浪组所如车份尽超日停]/.test(value), `Unexpected OCR result: ${value}`);
  assert.deepEqual(errors, []);
  await context.close();
};

let browser;
try {
  await waitForServer();
  browser = await chromium.launch({ headless: true });
  await makeFixture(browser);
  await runDeterministicFlow(browser);
  await runRealOcrFlow(browser);
  await fs.access('/tmp/tingxie-smoke-final.png');
  console.log('TINGXIE_SMOKE_PASS');
} finally {
  await browser?.close();
  server.kill('SIGTERM');
}
