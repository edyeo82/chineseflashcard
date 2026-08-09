'use strict';

const TINGXIE_UI_POLISH_VERSION = '20260809-3';

function hideLegacyProfileField() {
  const input = document.getElementById('profileName');
  const label = document.querySelector('label[for="profileName"]');
  if (input) {
    input.hidden = true;
    input.setAttribute('aria-hidden', 'true');
  }
  if (label) {
    label.hidden = true;
    label.setAttribute('aria-hidden', 'true');
  }
}

function clarifyMemoryHeading() {
  const box = document.getElementById('profileMemoryBox');
  if (!box) return;
  const heading = box.querySelector('.profile-memory-heading strong');
  const description = box.querySelector('.profile-memory-heading p');
  if (heading) heading.textContent = '👧 Children & 听写 lists';
  if (description) description.textContent = 'Choose a child, then choose a saved 听写 list. Each child keeps separate checklist progress.';
}

function openCloudSyncByDefault() {
  const details = document.getElementById('tingxieCloudSyncBox');
  if (!details) return false;
  details.open = true;
  details.dataset.defaultOpen = 'true';
  return true;
}

function installDesktopSelectorStyles() {
  if (document.querySelector('style[data-tingxie-desktop-selectors]')) return;
  const style = document.createElement('style');
  style.dataset.tingxieDesktopSelectors = 'true';
  style.textContent = `
    @media (min-width: 721px) {
      #profileMemoryBox .memory-control-row {
        grid-template-columns: minmax(300px, 1fr) auto;
        column-gap: 14px;
      }

      #profileMemoryBox #memoryProfileSelect,
      #profileMemoryBox #memoryListSelect {
        -webkit-appearance: none;
        appearance: none;
        min-height: 46px;
        padding: 10px 44px 10px 13px;
        border: 1px solid var(--line);
        border-radius: 12px;
        background-color: #fff;
        background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='18' height='18' viewBox='0 0 24 24' fill='none' stroke='%235a3fba' stroke-width='2.25' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpath d='m7 10 5 5 5-5'/%3E%3C/svg%3E");
        background-repeat: no-repeat;
        background-position: right 13px center;
        background-size: 18px 18px;
        color: var(--ink);
        font-size: .94rem;
        font-weight: 700;
        line-height: 1.25;
        cursor: pointer;
        box-shadow: 0 1px 2px rgba(44,36,28,.04);
      }

      #profileMemoryBox #memoryProfileSelect:hover,
      #profileMemoryBox #memoryListSelect:hover {
        border-color: rgba(120,85,217,.5);
        background-color: #fffdfa;
      }

      #profileMemoryBox #memoryProfileSelect:focus,
      #profileMemoryBox #memoryListSelect:focus {
        border-color: var(--primary);
        box-shadow: 0 0 0 3px rgba(120,85,217,.12);
      }

      #profileMemoryBox .memory-actions {
        min-height: 46px;
        align-items: center;
      }
    }
  `;
  document.head.appendChild(style);
}

function applyUiPolish() {
  hideLegacyProfileField();
  clarifyMemoryHeading();
  installDesktopSelectorStyles();
  openCloudSyncByDefault();
}

applyUiPolish();

const observer = new MutationObserver(() => {
  hideLegacyProfileField();
  clarifyMemoryHeading();
  const syncReady = openCloudSyncByDefault();
  if (syncReady && document.getElementById('profileMemoryBox')) {
    document.documentElement.dataset.tingxieUiPolish = 'true';
  }
});
observer.observe(document.body, { childList: true, subtree: true });

if (document.getElementById('profileMemoryBox')) {
  document.documentElement.dataset.tingxieUiPolish = 'true';
}

window.__tingxieUiPolish = {
  version: TINGXIE_UI_POLISH_VERSION,
  apply: applyUiPolish,
  syncOpen: () => Boolean(document.getElementById('tingxieCloudSyncBox')?.open)
};
