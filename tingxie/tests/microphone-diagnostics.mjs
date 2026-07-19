import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';

const PORT = 4177;
const LOCAL_BASE = `http://127.0.0.1:${PORT}/tingxie/`;
const BASE_URL = process.env.TINGXIE_BASE_URL || LOCAL_BASE;
const IS_LIVE = Boolean(process.env.TINGXIE_BASE_URL);
const FAILURE_LOG = '/tmp/tingxie-microphone-error.txt';
const IPHONE_CHROME_UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/138.0.7204.156 Mobile/15E148 Safari/604.1';

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
  throw new Error('Local test server did not start.');
}

async function waitForLiveDeployment() {
  const deadline = Date.now() + 10 * 60 * 1000;
  let last = 'not checked';
  while (Date.now() < deadline) {
    try {
      const stamp = Date.now();
      const [bootResponse, moduleResponse] = await Promise.all([
        fetch(`${BASE_URL}boot.js?mic-deployment=${stamp}`, { headers: { 'cache-control': 'no-cache' } }),
        fetch(`${BASE_URL}app-mic-fix.js?mic-deployment=${stamp}`, { headers: { 'cache-control': 'no-cache' } })
      ]);
      const [boot, module] = await Promise.all([bootResponse.text(), moduleResponse.text()]);
      if (bootResponse.ok && moduleResponse.ok && boot.includes('20260720-3') && module.includes("TINGXIE_MIC_FIX_VERSION = '20260720-3'")) return;
      last = `boot=${bootResponse.status}, module=${moduleResponse.status}, version=${boot.includes('20260720-3')}`;
    } catch (error) {
      last = error.message;
    }
    await new Promise(resolve => setTimeout(resolve, 10000));
  }
  throw new Error(`Microphone diagnostics deployment did not appear. Last result: ${last}`);
}

async function installBrowserMocks(context, scenario) {
  await context.addInitScript(({ scenarioName }) => {
    window.__microphoneTest = {
      scenario: scenarioName,
      getUserMediaCalls: 0,
      trackStopped: false,
      recognitionStarts: 0
    };

    class FakeUtterance {
      constructor(text) {
        this.text = text;
        this.lang = 'zh-CN';
        this.rate = 1;
      }
    }

    Object.defineProperty(window, 'SpeechSynthesisUtterance', {
      value: FakeUtterance,
      configurable: true
    });

    Object.defineProperty(window, 'speechSynthesis', {
      value: {
        getVoices: () => [{ name: 'Test Mandarin', lang: 'zh-CN', localService: true }],
        speak: utterance => setTimeout(() => utterance.onend?.(), 5),
        cancel: () => {},
        onvoiceschanged: null
      },
      configurable: true
    });

    Object.defineProperty(navigator, 'mediaDevices', {
      value: {
        getUserMedia: async () => {
          window.__microphoneTest.getUserMediaCalls += 1;
          if (scenarioName === 'denied') {
            const error = new Error('Permission denied for test');
            error.name = 'NotAllowedError';
            throw error;
          }
          return {
            getTracks: () => [{
              stop: () => { window.__microphoneTest.trackStopped = true; }
            }]
          };
        }
      },
      configurable: true
    });

    class FakeRecognition {
      start() {
        window.__microphoneTest.recognitionStarts += 1;
        setTimeout(() => {
          this.onstart?.();
          if (scenarioName === 'service-blocked') {
            this.onerror?.({ error: 'service-not-allowed' });
            this.onend?.();
          } else {
            this.onaudiostart?.();
          }
        }, 5);
      }

      stop() {
        setTimeout(() => this.onend?.(), 0);
      }
    }

    Object.defineProperty(window, 'SpeechRecognition', {
      value: FakeRecognition,
      configurable: true
    });
    Object.defineProperty(window, 'webkitSpeechRecognition', {
      value: FakeRecognition,
      configurable: true
    });
  }, { scenarioName: scenario });
}

async function prepareDictation(page) {
  await page.goto(`${BASE_URL}?test=deterministic&mic-check=${Date.now()}`, { waitUntil: 'networkidle' });
  await page.waitForFunction(() => document.documentElement.dataset.tingxieEventsBound === 'true');
  await page.waitForFunction(() => document.documentElement.dataset.tingxieMicDiagnostics === 'true');
  await page.locator('#wordList').fill('老虎\n狮子');
  await page.locator('#startDictationButton').click();
  await page.locator('#dictationPanel.active').waitFor();
  await page.waitForTimeout(30);
}

async function runScenario(browser, scenario) {
  const context = await browser.newContext({
    viewport: { width: 430, height: 932 },
    userAgent: IPHONE_CHROME_UA
  });
  await installBrowserMocks(context, scenario);
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', error => errors.push(`pageerror: ${error.stack || error.message}`));
  page.on('console', message => { if (message.type() === 'error') errors.push(`console: ${message.text()}`); });
  page.on('requestfailed', request => errors.push(`requestfailed: ${request.url()} :: ${request.failure()?.errorText}`));

  try {
    await prepareDictation(page);
    await page.locator('#voiceNextButton').click();

    if (scenario === 'denied') {
      await page.waitForFunction(() => document.querySelector('#voiceStatus')?.textContent.includes('not allowed to use the microphone'));
      const status = await page.locator('#voiceStatus').innerText();
      assert.match(status, /Microphone and Speech Recognition/);
      assert.equal(await page.locator('#voiceNextButton').innerText(), '🎤 Enable voice “next”');
      const state = await page.evaluate(() => window.__microphoneTest);
      assert.equal(state.getUserMediaCalls, 1);
      assert.equal(state.recognitionStarts, 0);
    }

    if (scenario === 'service-blocked') {
      await page.waitForFunction(() => window.__microphoneTest?.recognitionStarts === 1, null, { timeout: 10000 });
      await page.waitForTimeout(80);
      const status = await page.locator('#voiceStatus').innerText();
      console.log(`SERVICE_BLOCKED_STATUS: ${status}`);
      assert.match(status, /speech-recognition service/i);
      assert.match(status, /Settings → Chrome → Speech Recognition/);
      assert.doesNotMatch(status, /Microphone permission was not granted/);
      const state = await page.evaluate(() => window.__microphoneTest);
      assert.equal(state.getUserMediaCalls, 1);
      assert.equal(state.trackStopped, true);
      assert.equal(state.recognitionStarts, 1);
    }

    if (scenario === 'success') {
      await page.waitForFunction(() => window.__microphoneTest?.recognitionStarts === 1, null, { timeout: 10000 });
      await page.waitForTimeout(80);
      const status = await page.locator('#voiceStatus').innerText();
      console.log(`SUCCESS_STATUS: ${status}`);
      assert.match(status, /Microphone is active/i);
      assert.equal(await page.locator('#voiceNextButton').innerText(), '⏸ Stop voice “next”');
      const state = await page.evaluate(() => window.__microphoneTest);
      assert.equal(state.getUserMediaCalls, 1);
      assert.equal(state.trackStopped, true);
      assert.equal(state.recognitionStarts, 1);
    }

    assert.deepEqual(errors, []);
    await page.screenshot({ path: `/tmp/tingxie-microphone-${scenario}.png`, fullPage: true });
  } catch (error) {
    const status = await page.locator('#voiceStatus').innerText().catch(() => 'unavailable');
    const state = await page.evaluate(() => ({
      test: window.__microphoneTest,
      app: window.__tingxieMicrophoneDiagnostics?.getState?.()
    })).catch(() => null);
    await page.screenshot({ path: `/tmp/tingxie-microphone-${scenario}-failure.png`, fullPage: true }).catch(() => {});
    throw new Error(`${error.stack || error}\nScenario: ${scenario}\nStatus: ${status}\nState: ${JSON.stringify(state)}\nBrowser errors:\n${errors.join('\n')}`);
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
  await runScenario(browser, 'denied');
  await runScenario(browser, 'service-blocked');
  await runScenario(browser, 'success');
  console.log(IS_LIVE ? 'TINGXIE_LIVE_MICROPHONE_PASS' : 'TINGXIE_MICROPHONE_PASS');
} catch (error) {
  const detail = error.stack || String(error);
  await fs.writeFile(FAILURE_LOG, detail, 'utf8');
  console.error(IS_LIVE ? 'TINGXIE_LIVE_MICROPHONE_FAILURE' : 'TINGXIE_MICROPHONE_FAILURE');
  console.error(detail);
  process.exitCode = 1;
} finally {
  await browser?.close();
  server?.kill('SIGTERM');
}
