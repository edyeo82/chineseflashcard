import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';

const PORT = 4186;
const LOCAL_BASE = `http://127.0.0.1:${PORT}/tingxie/`;
const BASE_URL = process.env.TINGXIE_BASE_URL || LOCAL_BASE;
const IS_LIVE = Boolean(process.env.TINGXIE_BASE_URL);
const FAILURE_LOG = '/tmp/tingxie-standard-voice-error.txt';

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
  throw new Error('Local standard-voice test server did not start.');
}

async function waitForLiveDeployment() {
  const deadline = Date.now() + 10 * 60 * 1000;
  let last = 'not checked';
  while (Date.now() < deadline) {
    try {
      const stamp = Date.now();
      const [pageResponse, bootResponse, voiceResponse] = await Promise.all([
        fetch(`${BASE_URL}?standard-voice-deployment=${stamp}`, { headers: { 'cache-control': 'no-cache' } }),
        fetch(`${BASE_URL}boot.js?standard-voice-deployment=${stamp}`, { headers: { 'cache-control': 'no-cache' } }),
        fetch(`${BASE_URL}app-standard-mandarin-voice.js?standard-voice-deployment=${stamp}`, { headers: { 'cache-control': 'no-cache' } })
      ]);
      const [pageHtml, boot, voice] = await Promise.all([pageResponse.text(), bootResponse.text(), voiceResponse.text()]);
      const ready = pageHtml.includes('boot.js?v=20260802-3')
        && pageHtml.includes('voice=20260809-1')
        && boot.includes("TINGXIE_BOOT_VERSION = '20260802-3'")
        && boot.includes("app-standard-mandarin-voice.js?v=20260809-1")
        && voice.includes("TINGXIE_STANDARD_VOICE_VERSION = '20260809-1'");
      if (pageResponse.ok && bootResponse.ok && voiceResponse.ok && ready) return;
      last = `page=${pageResponse.status}, boot=${bootResponse.status}, voice=${voiceResponse.status}, ready=${ready}`;
    } catch (error) {
      last = error.message;
    }
    await new Promise(resolve => setTimeout(resolve, 10000));
  }
  throw new Error(`Standard-voice deployment did not appear. Last result: ${last}`);
}

async function installSpeechStubs(context) {
  await context.addInitScript(() => {
    localStorage.setItem('hcl:saveMode', 'guest');
    window.__spokenItems = [];
    window.__testVoices = [
      { name: 'Sin-Ji Female', lang: 'zh-HK', localService: true },
      { name: 'Kangkang', lang: 'zh-SG', localService: true },
      { name: 'Singapore Female', lang: 'zh-SG', localService: true },
      { name: 'Ting-Ting', lang: 'zh-CN', localService: true },
      { name: 'Cloud Mandarin', lang: 'zh-CN', localService: false },
      { name: 'English Voice', lang: 'en-SG', localService: true }
    ];

    class FakeUtterance {
      constructor(text) {
        this.text = text;
        this.lang = 'zh-CN';
        this.rate = 1;
        this.pitch = 1;
        this.volume = 1;
        this.voice = null;
      }
    }

    Object.defineProperty(window, 'SpeechSynthesisUtterance', { value: FakeUtterance, configurable: true });
    Object.defineProperty(window, 'speechSynthesis', {
      configurable: true,
      value: {
        getVoices: () => window.__testVoices,
        speak: utterance => {
          window.__spokenItems.push({
            text: utterance.text,
            voiceName: utterance.voice?.name || '',
            lang: utterance.lang,
            rate: utterance.rate
          });
          setTimeout(() => {
            utterance.onstart?.();
            utterance.onend?.();
          }, 5);
        },
        cancel: () => {},
        onvoiceschanged: null
      }
    });
  });
}

async function runStandardVoiceFlow(browser) {
  const context = await browser.newContext({ viewport: { width: 430, height: 932 } });
  await installSpeechStubs(context);
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', error => errors.push(`pageerror: ${error.stack || error.message}`));
  page.on('console', message => { if (message.type() === 'error') errors.push(`console: ${message.text()}`); });
  page.on('requestfailed', request => errors.push(`requestfailed: ${request.url()} :: ${request.failure()?.errorText}`));

  try {
    await page.goto(`${BASE_URL}?test=word-checklist&standard-voice=${Date.now()}`, { waitUntil: 'networkidle' });
    await page.waitForFunction(() => window.__tingxieStandardFemaleVoice?.version === '20260809-1');
    await page.locator('.settings-box').evaluate(element => { element.open = true; });

    const initial = await page.evaluate(() => ({
      selected: window.__tingxieStandardFemaleVoice.selected(),
      firstLabel: document.querySelector('#voiceSelect option')?.textContent,
      labels: Array.from(document.querySelectorAll('#voiceSelect option')).map(option => option.textContent),
      note: document.querySelector('#standardFemaleVoiceNote')?.textContent,
      button: document.querySelector('#recommendedVoiceButton')?.textContent
    }));

    assert.equal(initial.selected.name, 'Singapore Female');
    assert.equal(initial.selected.lang, 'zh-SG');
    assert.match(initial.firstLabel, /Recommended standard female.*Singapore Female.*Singapore Mandarin \(zh-SG\).*female.*device/i);
    assert.equal(initial.labels.some(label => /Sin-Ji|zh-HK/i.test(label)), false);
    assert.match(initial.note, /female Singapore Mandarin \(zh-SG\)/i);
    assert.match(initial.button, /standard female voice/i);

    await page.locator('#wordList').fill('浪费');
    await page.locator('#testVoiceButton').click();
    await page.waitForFunction(() => window.__spokenItems.length >= 1);
    const spoken = await page.evaluate(() => window.__spokenItems.at(-1));
    assert.equal(spoken.voiceName, 'Singapore Female');
    assert.equal(spoken.lang, 'zh-SG');
    assert.equal(spoken.text, '浪费');

    const fallback = await page.evaluate(() => {
      window.__testVoices = [
        { name: 'Kangkang', lang: 'zh-SG', localService: true },
        { name: 'Ting-Ting', lang: 'zh-CN', localService: true },
        { name: 'Cloud Mandarin', lang: 'zh-CN', localService: false }
      ];
      window.__tingxieStandardFemaleVoice.repopulate();
      return {
        selected: window.__tingxieStandardFemaleVoice.selected(),
        firstLabel: document.querySelector('#voiceSelect option')?.textContent,
        note: document.querySelector('#standardFemaleVoiceNote')?.textContent
      };
    });
    assert.equal(fallback.selected.name, 'Ting-Ting');
    assert.equal(fallback.selected.lang, 'zh-CN');
    assert.match(fallback.firstLabel, /Recommended standard female.*Ting-Ting.*zh-CN/i);
    assert.match(fallback.note, /female Mandarin/i);

    const scoreOrder = await page.evaluate(() => ({
      femaleSg: window.__tingxieStandardFemaleVoice.score({ name: 'Singapore Female', lang: 'zh-SG', localService: true }),
      maleSg: window.__tingxieStandardFemaleVoice.score({ name: 'Kangkang', lang: 'zh-SG', localService: true }),
      femaleCn: window.__tingxieStandardFemaleVoice.score({ name: 'Ting-Ting', lang: 'zh-CN', localService: true })
    }));
    assert.ok(scoreOrder.femaleSg > scoreOrder.femaleCn);
    assert.ok(scoreOrder.femaleCn > scoreOrder.maleSg);

    assert.deepEqual(errors, []);
    await page.screenshot({ path: '/tmp/tingxie-standard-voice-pass.png', fullPage: true });
  } catch (error) {
    await page.screenshot({ path: '/tmp/tingxie-standard-voice-failure.png', fullPage: true }).catch(() => {});
    const state = await page.evaluate(() => ({
      ready: document.documentElement.dataset.tingxieStandardFemaleVoice,
      options: Array.from(document.querySelectorAll('#voiceSelect option')).map(option => option.textContent),
      selected: window.__tingxieStandardFemaleVoice?.selected?.(),
      note: document.querySelector('#standardFemaleVoiceNote')?.textContent,
      spoken: window.__spokenItems
    })).catch(() => ({}));
    throw new Error(`${error.stack || error}\nBrowser errors:\n${errors.join('\n')}\nPage state:\n${JSON.stringify(state, null, 2)}`);
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
  await runStandardVoiceFlow(browser);
  console.log(IS_LIVE ? 'TINGXIE_LIVE_STANDARD_VOICE_PASS' : 'TINGXIE_STANDARD_VOICE_PASS');
} catch (error) {
  const detail = error.stack || String(error);
  await fs.writeFile(FAILURE_LOG, detail, 'utf8');
  console.error(IS_LIVE ? 'TINGXIE_LIVE_STANDARD_VOICE_FAILURE' : 'TINGXIE_STANDARD_VOICE_FAILURE');
  console.error(detail);
  process.exitCode = 1;
} finally {
  await browser?.close();
  server?.kill('SIGTERM');
}
