'use strict';

const TINGXIE_BOOT_VERSION = '20260722-2';

window.addEventListener('error', event => {
  const toast = document.getElementById('toast');
  if (!toast) return;
  toast.textContent = `App error: ${event.message || 'A script failed to load.'}`;
  toast.classList.add('show');
});

window.addEventListener('unhandledrejection', event => {
  const toast = document.getElementById('toast');
  if (!toast) return;
  const message = event.reason?.message || String(event.reason || 'A background task failed.');
  toast.textContent = `App error: ${message}`;
  toast.classList.add('show');
});

if ('serviceWorker' in navigator) {
  navigator.serviceWorker.getRegistrations().then(registrations => {
    registrations.forEach(registration => registration.unregister());
  }).catch(() => {});
}

function installLearningHubLink() {
  const titleBlock = document.querySelector('.app-header > div');
  if (!titleBlock || document.getElementById('learningHubLink')) return;

  const style = document.createElement('style');
  style.dataset.tingxieHubLink = 'true';
  style.textContent = `
    #learningHubLink {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      margin-bottom: 10px;
      color: var(--primary-dark);
      font-size: .82rem;
      font-weight: 850;
      text-decoration: none;
    }
    #learningHubLink:hover { text-decoration: underline; }
  `;
  document.head.appendChild(style);

  const link = document.createElement('a');
  link.id = 'learningHubLink';
  link.href = '../';
  link.textContent = '← All learning apps';
  titleBlock.prepend(link);
  document.documentElement.dataset.tingxieHubLink = 'true';
}

function showModuleLoadFailure(message) {
  const toast = document.getElementById('toast');
  if (toast) {
    toast.textContent = message;
    toast.classList.add('show');
  }
}

function showAccuracyLoadFailure() {
  showModuleLoadFailure('High-accuracy OCR could not load. Reload the page.');
}

function showPasteLoadFailure() {
  showModuleLoadFailure('The paste-list tool could not load. Reload the page.');
}

function showMicrophoneLoadFailure() {
  showModuleLoadFailure('The microphone diagnostic tool could not load. Reload the page.');
}

function showProfileMemoryLoadFailure() {
  showModuleLoadFailure('Child profile memory could not load. Reload the page.');
}

function showListSavingLoadFailure() {
  showModuleLoadFailure('List saving could not load. Reload the page.');
}

function markAccuracyReady() {
  document.documentElement.dataset.tingxieOcrAccuracy = 'true';
  const status = document.getElementById('appReadyStatus');
  if (status?.dataset.ready === 'true') status.textContent = 'App ready. High-accuracy OCR loaded.';
}

function loadAccuracyScript(src, dataName) {
  return new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = src;
    script.async = true;
    script.dataset[dataName] = 'true';
    script.onload = resolve;
    script.onerror = reject;
    document.head.appendChild(script);
  });
}

window.addEventListener('DOMContentLoaded', async () => {
  installLearningHubLink();

  try {
    await loadAccuracyScript('app-list-parser-fix.js?v=20260722-2', 'tingxieListParserFix');
  } catch {
    showListSavingLoadFailure();
  }

  try {
    await loadAccuracyScript('app-mic-fix.js?v=20260720-3', 'tingxieMicFix');
  } catch {
    showMicrophoneLoadFailure();
  }

  try {
    await loadAccuracyScript('app-paste-list.js?v=20260719-7', 'tingxiePasteList');
  } catch {
    showPasteLoadFailure();
  }

  try {
    await loadAccuracyScript('app-profile-memory.js?v=20260722-1', 'tingxieProfileMemory');
    await loadAccuracyScript('app-memory-save-button.js?v=20260722-2', 'tingxieMemorySaveButton');
  } catch {
    showProfileMemoryLoadFailure();
  }

  const testMode = new URLSearchParams(location.search).get('test');
  if (testMode === 'deterministic' || testMode === 'real-ocr') return;
  if (document.querySelector('script[data-tingxie-ocr-accuracy]')) return;

  try {
    await loadAccuracyScript('app-ocr-accuracy.js?v=20260719-6', 'tingxieOcrAccuracy');
    await loadAccuracyScript('app-ocr-region-fix.js?v=20260719-6', 'tingxieOcrRegionFix');
    await loadAccuracyScript('app-ocr-evidence-fix.js?v=20260719-6', 'tingxieOcrEvidenceFix');
    await loadAccuracyScript('app-ocr-trusted-fallback.js?v=20260719-6', 'tingxieOcrTrustedFallback');
    await loadAccuracyScript('app-ocr-sentence-fix.js?v=20260719-6', 'tingxieOcrSentenceFix');
    markAccuracyReady();
  } catch {
    showAccuracyLoadFailure();
  }
});
