'use strict';

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

function showAccuracyLoadFailure() {
  const toast = document.getElementById('toast');
  if (toast) {
    toast.textContent = 'High-accuracy OCR could not load. Reload the page.';
    toast.classList.add('show');
  }
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
