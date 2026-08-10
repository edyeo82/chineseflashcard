'use strict';

const TINGXIE_FRIENDLY_FINAL_VERSION = '20260810-1';

function putLearningAppsBackInHeader() {
  const link = document.getElementById('learningHubLink');
  const header = document.querySelector('.app-header > div');
  if (!link || !header) return;

  link.textContent = '← Learning apps';
  link.setAttribute('aria-label', 'Return to all learning apps');
  header.prepend(link);

  if (!document.querySelector('style[data-tingxie-friendly-hub-link]')) {
    const style = document.createElement('style');
    style.dataset.tingxieFriendlyHubLink = 'true';
    style.textContent = `
      #learningHubLink {
        position: static !important;
        inset: auto !important;
        right: auto !important;
        bottom: auto !important;
        z-index: auto !important;
        display: inline-flex !important;
        width: auto !important;
        min-height: 0 !important;
        margin: 0 0 9px !important;
        padding: 0 !important;
        border: 0 !important;
        border-radius: 0 !important;
        background: transparent !important;
        box-shadow: none !important;
        backdrop-filter: none !important;
        color: var(--primary-dark) !important;
        font-size: .82rem !important;
        font-weight: 800 !important;
        text-decoration: none !important;
        transform: none !important;
      }
      #learningHubLink:hover,
      #learningHubLink:focus-visible {
        text-decoration: underline !important;
        transform: none !important;
      }
    `;
    document.head.appendChild(style);
  }

  document.documentElement.dataset.tingxieHubLinkPlacement = 'top';
}

function retireLegacyBrowserCamera() {
  const sourceInput = document.getElementById('sourceImage');
  const sourceLabel = document.querySelector('label[for="sourceImage"]');
  sourceInput?.classList.add('friendly-retired');
  sourceLabel?.classList.add('friendly-retired');

  ['sourcePreview', 'scanSourceButton', 'appReadyStatus', 'sourceProgress', 'cameraDialog'].forEach(id => {
    document.getElementById(id)?.classList.add('friendly-retired');
  });

  document.querySelectorAll('.in-browser-camera-button').forEach(button => {
    button.classList.add('friendly-retired');
  });

  // Also cover any older cached camera helper that did not use the final class.
  document.querySelectorAll('button, a, label').forEach(element => {
    const text = String(element.textContent || '').replace(/\s+/g, ' ').trim();
    if (/^(?:📷\s*)?Take photo in browser$/i.test(text) || /^Read words from photo$/i.test(text)) {
      element.classList.add('friendly-retired');
    }
  });

  if (typeof closeInBrowserCamera === 'function') {
    try { closeInBrowserCamera(); } catch { /* already closed */ }
  }

  document.documentElement.dataset.tingxieBrowserOcr = 'retired';
}

function applyFriendlyFinalPolish() {
  putLearningAppsBackInHeader();
  retireLegacyBrowserCamera();
  document.documentElement.dataset.tingxieFriendlyFinalPolish = 'true';
}

applyFriendlyFinalPolish();

// Camera/UI helpers are synchronous today, but keep a short observer so a
// cached older helper cannot re-add a retired browser-camera control afterward.
const friendlyFinalObserver = new MutationObserver(() => {
  putLearningAppsBackInHeader();
  retireLegacyBrowserCamera();
});
friendlyFinalObserver.observe(document.body, { childList: true, subtree: true });
setTimeout(() => friendlyFinalObserver.disconnect(), 3000);

window.__tingxieFriendlyFinalPolish = {
  version: TINGXIE_FRIENDLY_FINAL_VERSION,
  apply: applyFriendlyFinalPolish
};
