'use strict';

const TINGXIE_FRIENDLY_FINAL_VERSION = '20260810-1';

function putLearningAppsBackInHeader() {
  const link = document.getElementById('learningHubLink');
  const header = document.querySelector('.app-header > div');
  if (!link || !header) return;

  if (link.textContent !== '← Learning apps') link.textContent = '← Learning apps';
  if (link.getAttribute('aria-label') !== 'Return to all learning apps') {
    link.setAttribute('aria-label', 'Return to all learning apps');
  }
  if (link.parentElement !== header || header.firstElementChild !== link) {
    header.prepend(link);
  }

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
      .word-checklist-row.learned,
      .word-checklist-row.skipped.learned {
        opacity: .58 !important;
        background: #eef0ee !important;
      }
      .word-checklist-row.learned .word-checklist-text,
      .word-checklist-row.learned .word-checklist-number,
      .word-checklist-row.learned .word-checklist-status {
        color: var(--muted) !important;
      }
      .word-checklist-row.learned .word-checklist-text {
        text-decoration: none !important;
      }
    `;
    document.head.appendChild(style);
  }

  if (document.documentElement.dataset.tingxieHubLinkPlacement !== 'top') {
    document.documentElement.dataset.tingxieHubLinkPlacement = 'top';
  }
}

function applyLearnedRowVisuals() {
  document.querySelectorAll('.word-checklist-row').forEach(row => {
    if (row.classList.contains('learned')) {
      row.style.setProperty('opacity', '.58', 'important');
      row.style.setProperty('background', '#eef0ee', 'important');
    } else {
      row.style.removeProperty('opacity');
      row.style.removeProperty('background');
    }
  });
}

function addRetiredClass(element) {
  if (element && !element.classList.contains('friendly-retired')) {
    element.classList.add('friendly-retired');
  }
}

function retireLegacyBrowserCamera() {
  addRetiredClass(document.getElementById('sourceImage'));
  addRetiredClass(document.querySelector('label[for="sourceImage"]'));

  ['sourcePreview', 'scanSourceButton', 'appReadyStatus', 'sourceProgress', 'cameraDialog'].forEach(id => {
    addRetiredClass(document.getElementById(id));
  });

  document.querySelectorAll('.in-browser-camera-button').forEach(addRetiredClass);

  document.querySelectorAll('button, a, label').forEach(element => {
    const text = String(element.textContent || '').replace(/\s+/g, ' ').trim();
    if (/^(?:📷\s*)?Take photo in browser$/i.test(text) || /^Read words from photo$/i.test(text)) {
      addRetiredClass(element);
    }
  });

  if (typeof closeInBrowserCamera === 'function') {
    try { closeInBrowserCamera(); } catch { /* already closed */ }
  }

  if (document.documentElement.dataset.tingxieBrowserOcr !== 'retired') {
    document.documentElement.dataset.tingxieBrowserOcr = 'retired';
  }
}

function applyFriendlyFinalPolish() {
  putLearningAppsBackInHeader();
  retireLegacyBrowserCamera();
  applyLearnedRowVisuals();
  document.documentElement.dataset.tingxieFriendlyFinalPolish = 'true';
}

applyFriendlyFinalPolish();

document.addEventListener('change', event => {
  if (event.target?.matches?.('.word-checklist-row input[type="checkbox"]')) {
    queueMicrotask(applyLearnedRowVisuals);
  }
}, true);

const friendlyFinalObserver = new MutationObserver(() => {
  putLearningAppsBackInHeader();
  retireLegacyBrowserCamera();
  applyLearnedRowVisuals();
});
friendlyFinalObserver.observe(document.body, {
  childList: true,
  subtree: true,
  attributes: true,
  attributeFilter: ['class']
});
setTimeout(() => friendlyFinalObserver.disconnect(), 3000);

window.__tingxieFriendlyFinalPolish = {
  version: TINGXIE_FRIENDLY_FINAL_VERSION,
  apply: applyFriendlyFinalPolish
};
