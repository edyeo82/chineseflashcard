'use strict';

const TINGXIE_UI_POLISH_VERSION = '20260809-4';
const MEMORY_HEADING = '👧 Children & 听写 lists';
const MEMORY_DESCRIPTION = 'Choose a child, then choose a saved 听写 list. Each child keeps separate checklist progress.';

function hideLegacyProfileField() {
  const input = document.getElementById('profileName');
  const label = document.querySelector('label[for="profileName"]');
  if (input) {
    if (!input.hidden) input.hidden = true;
    if (input.getAttribute('aria-hidden') !== 'true') input.setAttribute('aria-hidden', 'true');
  }
  if (label) {
    if (!label.hidden) label.hidden = true;
    if (label.getAttribute('aria-hidden') !== 'true') label.setAttribute('aria-hidden', 'true');
  }
}

function clarifyMemoryHeading() {
  const box = document.getElementById('profileMemoryBox');
  if (!box) return false;
  const heading = box.querySelector('.profile-memory-heading strong');
  const description = box.querySelector('.profile-memory-heading p');
  if (heading && heading.textContent !== MEMORY_HEADING) heading.textContent = MEMORY_HEADING;
  if (description && description.textContent !== MEMORY_DESCRIPTION) description.textContent = MEMORY_DESCRIPTION;
  return true;
}

function openCloudSyncByDefault() {
  const details = document.getElementById('tingxieCloudSyncBox');
  if (!details) return false;
  if (!details.open) details.open = true;
  if (details.dataset.defaultOpen !== 'true') details.dataset.defaultOpen = 'true';
  return true;
}

function installDesktopSelectorStyles() {
  if (document.querySelector('style[data-tingxie-desktop-selectors]')) return;
  const style = document.createElement('style');
  style.dataset.tingxieDesktopSelectors = 'true';
  style.textContent = `
    @media (min-width: 721px) {
      /* The memory card sits inside the left column, so its usable width is
         much narrower than the whole desktop viewport. Keep each selector on
         a full row and place its actions directly underneath. */
      #profileMemoryBox .memory-control-row {
        grid-template-columns: minmax(0, 1fr);
        row-gap: 8px;
        align-items: stretch;
      }

      #profileMemoryBox .memory-control-row > label {
        display: block;
        width: 100%;
        min-width: 0;
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
        display: flex;
        width: 100%;
        min-width: 0;
        min-height: 40px;
        flex-wrap: wrap;
        justify-content: flex-end;
        align-items: center;
        gap: 7px;
      }

      #profileMemoryBox .memory-actions button {
        min-height: 38px;
        max-width: 100%;
      }

      /* Keep the saved-list count on the left and all list actions together
         on the right. app-memory-save-button prepends Save in the DOM, so
         explicit ordering keeps the visual row predictable. */
      #profileMemoryBox #memoryListCount {
        order: 1;
        margin-right: auto;
      }
      #profileMemoryBox #saveMemoryListButton { order: 2; }
      #profileMemoryBox #newMemoryListButton { order: 3; }
      #profileMemoryBox #renameListButton { order: 4; }
      #profileMemoryBox #deleteListButton { order: 5; }
    }
  `;
  document.head.appendChild(style);
}

function markReadyWhenPossible() {
  const memoryReady = clarifyMemoryHeading();
  const syncReady = openCloudSyncByDefault();
  if (memoryReady) document.documentElement.dataset.tingxieUiPolish = 'true';
  return memoryReady && syncReady;
}

function applyUiPolish() {
  hideLegacyProfileField();
  installDesktopSelectorStyles();
  markReadyWhenPossible();
}

applyUiPolish();

const observer = new MutationObserver(() => {
  hideLegacyProfileField();
  if (markReadyWhenPossible()) observer.disconnect();
});
observer.observe(document.body, { childList: true, subtree: true });

window.__tingxieUiPolish = {
  version: TINGXIE_UI_POLISH_VERSION,
  apply: applyUiPolish,
  syncOpen: () => Boolean(document.getElementById('tingxieCloudSyncBox')?.open)
};
