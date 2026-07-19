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

// Load the accuracy layer after the normal app has attached its event handlers.
// The click handler resolves runOcr at click time, so this same-origin override is
// ready well before a user can choose and scan a photo.
window.addEventListener('DOMContentLoaded', () => {
  // The existing deterministic smoke test supplies a deliberately minimal OCR
  // mock. Its purpose is the overall app flow; the separate accuracy regression
  // test exercises this high-accuracy layer in full.
  if (new URLSearchParams(location.search).get('test') === 'deterministic') return;
  if (document.querySelector('script[data-tingxie-ocr-accuracy]')) return;
  const script = document.createElement('script');
  script.src = 'app-ocr-accuracy.js?v=20260719-6';
  script.async = true;
  script.dataset.tingxieOcrAccuracy = 'true';
  script.onload = () => {
    document.documentElement.dataset.tingxieOcrAccuracy = 'true';
    const status = document.getElementById('appReadyStatus');
    if (status?.dataset.ready === 'true') status.textContent = 'App ready. High-accuracy OCR loaded.';
  };
  script.onerror = () => {
    const toast = document.getElementById('toast');
    if (toast) {
      toast.textContent = 'High-accuracy OCR could not load. Reload the page.';
      toast.classList.add('show');
    }
  };
  document.head.appendChild(script);
});
