'use strict';

const TINGXIE_MEMORY_SAVE_BUTTON_VERSION = '20260722-2';

function saveOrUpdateCurrentTingXie() {
  const button = $('saveMemoryListButton');
  const wordList = $('wordList');
  const items = uniqueItems(extractItems(wordList?.value || ''));

  if (!items.length) {
    showToast('Enter at least one word before saving.');
    wordList?.focus();
    return null;
  }

  if (!window.__tingxieProfileMemory?.saveList) {
    showToast('Child memory is not ready. Reload the page and try again.');
    return null;
  }

  const originalText = button?.textContent || '💾 Save / update list';
  if (button) {
    button.disabled = true;
    button.textContent = 'Saving…';
  }

  try {
    // Replace the textarea with the parser's exact saved representation so the
    // parent can immediately see that 一份, 一座山, 五颗星, etc. were preserved.
    wordList.value = items.join('\n');
    updateWordCount();
    const list = window.__tingxieProfileMemory.saveList(items);
    if (!list) throw new Error('The list could not be saved.');

    const profile = window.__tingxieProfileMemory.activeProfile();
    const status = $('profileMemoryStatus');
    if (status) status.textContent = `Saved “${list.title}” for ${profile.name} at ${new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit' }).format(new Date())}.`;
    showToast(`Saved ${items.length} items for ${profile.name}.`);
    return list;
  } catch (error) {
    showToast(error?.message || 'The list could not be saved.');
    return null;
  } finally {
    if (button) {
      button.disabled = false;
      button.textContent = originalText;
    }
  }
}

function installMemorySaveButton() {
  const actions = $('memoryListCount')?.closest('.memory-actions');
  if (!actions || $('saveMemoryListButton')) return;

  const button = document.createElement('button');
  button.id = 'saveMemoryListButton';
  button.className = 'primary-button';
  button.type = 'button';
  button.textContent = '💾 Save / update list';
  button.addEventListener('click', saveOrUpdateCurrentTingXie);
  actions.prepend(button);

  window.addEventListener('keydown', event => {
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's') {
      event.preventDefault();
      saveOrUpdateCurrentTingXie();
    }
  });

  document.documentElement.dataset.tingxieMemorySaveButton = 'true';
}

installMemorySaveButton();

window.__tingxieMemorySaveButton = {
  version: TINGXIE_MEMORY_SAVE_BUTTON_VERSION,
  save: saveOrUpdateCurrentTingXie
};
