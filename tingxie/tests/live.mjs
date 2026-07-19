import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';

const LIVE_URL = 'https://edyeo82.github.io/chineseflashcard/tingxie/';
const EXPECTED_VERSION = '20260719-6';
const FIXTURE = '/tmp/tingxie-live-fixture.png';
const SCREENSHOT = '/tmp/tingxie-live-pass.png';
const FAILURE_SCREENSHOT = '/tmp/tingxie-live-failure.png';
const FAILURE_LOG = '/tmp/tingxie-live-error.txt';
const EXPECTED = [
  '浪费', '组屋', '所以', '如果', '车辆', '一份', '尽力', '超市', '日用品', '停车场',
  '我认为开着灯睡觉是不对的。',
  '读过的报纸，我们可以废物利用。',
  '妈妈购物时，都会用环保袋装东西。'
];

const ORIGINAL_OCR = `听写（十一）第十一课
lang fei     zi wu      sud yi      ra gud
ché lidn     yi fen      in li       chao shi
TT yong pin              ting ché chang
11. 我认为开着灯睡觉是不对的。
12. 读过的报纸， KNTARDA A.
默写：妈妈购物时，都会用环保袋装东西。`;
const ENHANCED_OCR = `1. 浪费    2. 组屋    3. 所以    4. 如采
5. 车辆    6. 一份    7. 尽刀    8. 超市
9. 日用晶  10. 停车 场
11. 我认为开着灯睡党是不对的。
12. 读过的报纸，我们可以废物利用。`;
const PINYIN_TEXT = `lang fei    zi wu    sud yi    ra gud
ché lidn    yi fen    in li    chao shi
TT yong pin          ting ché chang`;

function makeTsv() {
  const header = 'level\tpage_num\tblock_num\tpar_num\tline_num\tword_num\tleft\ttop\twidth\theight\tconf\ttext';
  const rows = [];
  let wordNumber = 0;
  const addPhrase = (tokens, startX, top, lineNumber) => {
    let left = startX;
    for (const token of tokens) {
      wordNumber += 1;
      const width = Math.max(42, token.length * 30);
      rows.push(`5\t1\t1\t1\t${lineNumber}\t${wordNumber}\t${left}\t${top}\t${width}\t36\t88\t${token}`);
      left += width + 22;
    }
  };
  addPhrase(['lang', 'fei'], 100, 120, 1);
  addPhrase(['zi', 'wu'], 480, 120, 1);
  addPhrase(['sud', 'yi'], 850, 120, 1);
  addPhrase(['ra', 'gud'], 1240, 120, 1);
  addPhrase(['ché', 'lidn'], 100, 340, 2);
  addPhrase(['yi', 'fen'], 480, 340, 2);
  addPhrase(['in', 'li'], 850, 340, 2);
  addPhrase(['chao', 'shi'], 1240, 340, 2);
  addPhrase(['TT', 'yong', 'pin'], 180, 560, 3);
  addPhrase(['ting', 'ché', 'chang'], 980, 560, 3);
  return [header, ...rows].join('\n');
}
const PINYIN_TSV = makeTsv();
const sleep = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds));

async function waitForDeployment() {
  const deadline = Date.now() + 10 * 60 * 1000;
  let lastMessage = 'No response yet.';
  while (Date.now() < deadline) {
    try {
      const stamp = Date.now();
      const [bootResponse, accuracyResponse] = await Promise.all([
        fetch(`${LIVE_URL}boot.js?deployment-check=${stamp}`, { headers: { 'cache-control': 'no-cache' } }),
        fetch(`${LIVE_URL}app-ocr-accuracy.js?deployment-check=${stamp}`, { headers: { 'cache-control': 'no-cache' } })
      ]);
      const [bootText, accuracyText] = await Promise.all([bootResponse.text(), accuracyResponse.text()]);
      const versionPresent = bootText.includes(EXPECTED_VERSION);
      const accuracyPresent = accuracyText.includes('tingxie-source-ocr-v2');
      if (bootResponse.ok && accuracyResponse.ok && versionPresent && accuracyPresent) {
        console.log('TINGXIE_LIVE_MILESTONE: accuracy-build-visible');
        return;
      }
      lastMessage = `boot=${bootResponse.status}, accuracy=${accuracyResponse.status}, version=${versionPresent}, module=${accuracyPresent}`;
    } catch (error) {
      lastMessage = error.message;
    }
    console.log(`Waiting for high-accuracy Pages deployment: ${lastMessage}`);
    await sleep(10000);
  }
  throw new Error(`The high-accuracy Pages build did not appear within 10 minutes. Last result: ${lastMessage}`);
}

async function addBrowserStubs(context) {
  await context.addInitScript(() => {
    class FakeUtterance {
      constructor(text) { this.text = text; this.lang = 'zh-CN'; this.rate = 1; }
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
  const context = await browser.newContext({ viewport: { width: 1000, height: 1400 } });
  const page = await context.newPage();
  await page.setContent(`<!doctype html><html><body style="margin:0;background:#eee;padding:55px"><div id="sheet" style="box-sizing:border-box;width:880px;height:1180px;border:3px solid #222;background:#fff;padding:35px;font-family:'Noto Sans CJK SC',sans-serif;color:#222"><h2 style="font-size:30px">听写（十一）第十一课</h2><div style="font-size:22px;line-height:2.8">lang fei　　zi wu　　sud yi　　ra gud<br>浪费　　　　组屋　　　所以　　　如果<br>ché lidn　　yi fen　　in li　　　chao shi<br>车辆　　　　一份　　　尽力　　　超市<br>TT yong pin　　　　　 ting ché chang<br>日用品　　　　　　　 停车场</div><p style="font-size:28px">11. 我认为开着灯睡觉是不对的。</p><p style="font-size:28px">12. 读过的报纸，我们可以废物利用。</p><p style="font-size:28px">默写：妈妈购物时，都会用环保袋装东西。</p></div></body></html>`);
  await page.locator('#sheet').screenshot({ path: FIXTURE });
  await context.close();
}

async function verifyLivePage(browser) {
  const context = await browser.newContext({ viewport: { width: 430, height: 932 } });
  await addBrowserStubs(context);
  await context.route(/tesseract\.min\.js/, route => route.fulfill({
    contentType: 'application/javascript',
    body: `window.Tesseract={createWorker:async function(langs,oem,options){let pass=0;return{setParameters:async function(){},recognize:async function(){pass+=1;options.logger&&options.logger({status:'recognizing text',progress:pass/3});if(pass===1)return{data:{text:${JSON.stringify(ORIGINAL_OCR)}}};if(pass===2)return{data:{text:${JSON.stringify(ENHANCED_OCR)},tsv:''}};return{data:{text:${JSON.stringify(PINYIN_TEXT)},tsv:${JSON.stringify(PINYIN_TSV)}}}},terminate:async function(){}}}};`
  }));

  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', error => errors.push(`pageerror: ${error.stack || error.message}`));
  page.on('console', message => { if (message.type() === 'error') errors.push(`console: ${message.text()}`); });
  page.on('requestfailed', request => errors.push(`requestfailed: ${request.url()} :: ${request.failure()?.errorText}`));

  try {
    const deadline = Date.now() + 4 * 60 * 1000;
    while (Date.now() < deadline) {
      await page.goto(`${LIVE_URL}?live-accuracy-check=${Date.now()}`, { waitUntil: 'networkidle' });
      try {
        await page.waitForFunction(() => document.documentElement.dataset.tingxieOcrAccuracy === 'true', null, { timeout: 10000 });
        break;
      } catch {
        await sleep(5000);
      }
    }
    assert.equal(await page.locator('html').getAttribute('data-tingxie-ocr-accuracy'), 'true');
    assert.match(await page.locator('#appReadyStatus').innerText(), /High-accuracy OCR loaded/);
    console.log('TINGXIE_LIVE_MILESTONE: public-accuracy-layer-ready');

    await page.locator('#sourceImage').setInputFiles(FIXTURE);
    await page.locator('#sourcePreview:not(.hidden)').waitFor();
    assert.equal(await page.locator('#scanSourceButton').isEnabled(), true);
    await page.locator('#scanSourceButton').click();
    await page.waitForFunction(() => document.querySelector('#wordList')?.value.split('\n').filter(Boolean).length === 13, null, { timeout: 30000 });

    const actual = (await page.locator('#wordList').inputValue()).split('\n').filter(Boolean);
    assert.deepEqual(actual, EXPECTED);
    assert.match(await page.locator('#sourceProgressText').innerText(), /combined/i);
    assert.equal(await page.locator('#startDictationButton').isEnabled(), true);
    assert.deepEqual(errors, []);
    console.log('TINGXIE_LIVE_MILESTONE: public-exact-13-item-ocr-pass');
    await page.screenshot({ path: SCREENSHOT, fullPage: true });
  } catch (error) {
    await page.screenshot({ path: FAILURE_SCREENSHOT, fullPage: true }).catch(() => {});
    const state = await page.evaluate(() => ({
      url: location.href,
      ready: document.documentElement.dataset.tingxieEventsBound,
      accuracy: document.documentElement.dataset.tingxieOcrAccuracy,
      status: document.querySelector('#appReadyStatus')?.textContent,
      toast: document.querySelector('#toast')?.textContent,
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
