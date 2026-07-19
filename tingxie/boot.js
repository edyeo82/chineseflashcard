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

// Load the accuracy layers after the normal app has attached its event handlers.
// The click handler resolves runOcr at click time, so the overrides are ready well
// before a user can choose and scan a photo.
window.addEventListener('DOMContentLoaded', () => {
  // The original deterministic smoke test supplies a deliberately minimal OCR
  // mock. Its purpose is the overall app flow; a separate strict regression
  // exercises both high-accuracy layers in full.
  if (new URLSearchParams(location.search).get('test') === 'deterministic') return;
  if (document.querySelector('script[data-tingxie-ocr-accuracy]')) return;

  const accuracyScript = document.createElement('script');
  accuracyScript.src = 'app-ocr-accuracy.js?v=20260719-6';
  accuracyScript.async = true;
  accuracyScript.dataset.tingxieOcrAccuracy = 'true';
  accuracyScript.onerror = showAccuracyLoadFailure;
  accuracyScript.onload = () => {
    const sentenceScript = document.createElement('script');
    sentenceScript.src = 'app-ocr-sentence-fix.js?v=20260719-6';
    sentenceScript.async = true;
    sentenceScript.dataset.tingxieOcrSentenceFix = 'true';
    sentenceScript.onload = markAccuracyReady;
    sentenceScript.onerror = showAccuracyLoadFailure;
    document.head.appendChild(sentenceScript);
  };
  document.head.appendChild(accuracyScript);
});
