'use strict';

const TINGXIE_PARENT_FLOW_POLISH_VERSION = '20260810-3';
const PARENT_NEW_CHILD_VALUE = '__new_child__';

function parentCleanName(value) {
  return String(value || '').replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 30);
}

function familyImportMemorySnapshot() {
  return window.__tingxieClassPackFamilyImport?.memory?.() || { profiles: [], activeProfileId: null };
}

function directChildImportUi() {
  if (!window.__tingxieClassPack?.isActive?.()) return false;
  const panel = document.getElementById('classPackFamilyPanel');
  const select = document.getElementById('classPackFamilyProfileSelect');
  const newRow = document.getElementById('classPackNewChildRow');
  const nameInput = document.getElementById('classPackNewChildName');
  const capacity = document.getElementById('classPackFamilyCapacity');
  if (!panel || !select || !newRow || !nameInput || !capacity) return false;

  select.querySelector(`option[value="${PARENT_NEW_CHILD_VALUE}"]`)?.remove();
  if (!select.value && select.options.length) select.value = select.options[0].value;

  const selectLabel = select.closest('label');
  if (selectLabel && !selectLabel.querySelector('.parent-existing-child-label')) {
    [...selectLabel.childNodes].filter(node => node.nodeType === Node.TEXT_NODE).forEach(node => node.remove());
    const labelText = document.createElement('span');
    labelText.className = 'parent-existing-child-label';
    labelText.textContent = 'Existing child (optional)';
    selectLabel.prepend(labelText);
  }

  newRow.hidden = false;
  if (!newRow.querySelector('.parent-new-child-label')) {
    [...newRow.childNodes].filter(node => node.nodeType === Node.TEXT_NODE).forEach(node => node.remove());
    const labelText = document.createElement('span');
    labelText.className = 'parent-new-child-label';
    labelText.textContent = 'New child’s name';
    newRow.prepend(labelText);
    const note = document.createElement('small');
    note.className = 'parent-new-child-note';
    note.textContent = 'Type a name here to create the child profile automatically. No dropdown step needed.';
    newRow.append(note);
  }

  const name = parentCleanName(nameInput.value);
  const packCount = window.__tingxieClassPack?.pack?.()?.lists?.length || 0;
  if (name) {
    capacity.textContent = `A new profile for ${name} will be created and the shared lists will be saved there.`;
  } else {
    const memory = familyImportMemorySnapshot();
    const profile = memory.profiles?.find(item => item.id === select.value) || memory.profiles?.[0];
    const count = profile?.lists?.length || 0;
    const room = Math.max(0, 10 - count);
    capacity.textContent = profile
      ? `${profile.name} has space for ${room} more list${room === 1 ? '' : 's'}. Existing lists are never deleted.`
      : `Enter a child’s name to create a profile for these ${packCount} shared lists.`;
  }
  return true;
}

function installDirectChildImport() {
  if (!directChildImportUi()) return;
  const select = document.getElementById('classPackFamilyProfileSelect');
  const nameInput = document.getElementById('classPackNewChildName');
  const oldConfirm = document.getElementById('classPackFamilySaveConfirm');
  const toggle = document.getElementById('classPackFamilyToggle');
  if (!select || !nameInput || !oldConfirm || oldConfirm.dataset.parentDirectImport === 'true') return;

  const confirm = oldConfirm.cloneNode(true);
  confirm.dataset.parentDirectImport = 'true';
  oldConfirm.replaceWith(confirm);

  const refresh = () => setTimeout(directChildImportUi, 0);
  select.addEventListener('change', refresh);
  nameInput.addEventListener('input', directChildImportUi);
  toggle?.addEventListener('click', refresh);

  confirm.addEventListener('click', async () => {
    const status = document.getElementById('classPackFamilyStatus');
    const enteredName = parentCleanName(nameInput.value);
    const profileId = select.value;
    if (!enteredName && !profileId) {
      status.textContent = 'Enter the child’s name, or choose an existing child.';
      nameInput.focus();
      return;
    }

    confirm.disabled = true;
    status.textContent = enteredName ? `Creating ${enteredName} and saving the shared lists…` : 'Saving shared lists…';
    try {
      const result = await window.__tingxieClassPackFamilyImport.importCurrent(enteredName
        ? { newChild: true, name: enteredName }
        : { newChild: false, profileId });
      status.textContent = importSummary(result);
      toggle.textContent = `✓ Saved for ${result.profileName}`;
      const open = document.getElementById('classPackOpenChildButton');
      if (open) {
        open.hidden = false;
        open.textContent = `Open ${result.profileName}’s saved lists →`;
      }
      nameInput.value = '';
      if (typeof renderFamilyTargetChoices === 'function') renderFamilyTargetChoices();
      directChildImportUi();
      if (result.noRoom) showToast(`${result.noRoom} shared list${result.noRoom === 1 ? '' : 's'} could not fit because this child already has 10 lists.`);
      else showToast(`Saved class pack for ${result.profileName}.`);
    } catch (error) {
      status.textContent = error?.message || String(error);
      showToast(status.textContent);
    } finally {
      confirm.disabled = false;
    }
  });

  if (!document.querySelector('style[data-tingxie-direct-child-import]')) {
    const style = document.createElement('style');
    style.dataset.tingxieDirectChildImport = 'true';
    style.textContent = `
      .parent-new-child-note { color: var(--muted); font-size: .74rem; font-weight: 500; line-height: 1.35; }
      #classPackNewChildRow { padding: 10px; border: 1px solid rgba(120,85,217,.18); border-radius: 12px; background: rgba(249,247,255,.8); }
    `;
    document.head.appendChild(style);
  }
}

function setProgressSaveStatus(message, saved = false) {
  const status = document.getElementById('learnedProgressSaveStatus');
  const button = document.getElementById('saveLearnedProgressButton');
  if (status) status.textContent = message;
  if (button) button.dataset.saved = saved ? 'true' : 'false';
}

async function saveLearnedProgressNow() {
  const button = document.getElementById('saveLearnedProgressButton');
  if (!button) return;
  button.disabled = true;
  setProgressSaveStatus('Saving progress…');
  try {
    if (typeof saveSkippedWordStore === 'function' && !window.__tingxieClassPack?.isActive?.()) {
      saveSkippedWordStore();
    }

    const classPackMode = Boolean(window.__tingxieClassPack?.isActive?.());
    const cloud = window.__tingxieCloudSync;
    let synced = false;
    if (!classPackMode && cloud?.mode?.() === 'username' && cloud?.path?.()) {
      await cloud.upload?.({ silent: true });
      synced = true;
    }

    const profile = window.__tingxieProfileMemory?.activeProfile?.();
    const learned = typeof currentSkippedSet === 'function' ? currentSkippedSet().size : 0;
    const message = classPackMode
      ? `Progress saved on this device · ${learned} learned.`
      : synced
        ? `Progress saved and synced for ${profile?.name || 'this child'} · ${learned} learned.`
        : `Progress saved for ${profile?.name || 'this child'} · ${learned} learned.`;
    setProgressSaveStatus(`✓ ${message}`, true);
    showToast(message);
  } catch (error) {
    console.error('Could not save learned-word progress', error);
    setProgressSaveStatus('Could not sync right now. Progress is still saved on this device.');
    showToast('Progress is saved on this device. Family sync will retry later.');
  } finally {
    button.disabled = false;
  }
}

function installProgressSaveButton() {
  const box = document.getElementById('wordChecklistBox');
  const actions = box?.querySelector('.word-checklist-actions');
  if (!box || !actions || document.getElementById('saveLearnedProgressButton')) return false;

  const button = document.createElement('button');
  button.id = 'saveLearnedProgressButton';
  button.className = 'accent-button learned-progress-save-button';
  button.type = 'button';
  button.textContent = '💾 Save progress';
  actions.appendChild(button);

  const status = document.createElement('p');
  status.id = 'learnedProgressSaveStatus';
  status.className = 'help-text learned-progress-save-status';
  status.setAttribute('role', 'status');
  status.setAttribute('aria-live', 'polite');
  status.textContent = 'Tick learned words, then tap Save progress.';
  actions.insertAdjacentElement('afterend', status);

  button.addEventListener('click', saveLearnedProgressNow);
  box.addEventListener('change', event => {
    if (event.target?.matches?.('.word-checklist-row input[type="checkbox"]')) {
      setProgressSaveStatus('Progress changed — tap Save progress.');
    }
  });

  ['memoryProfileSelect', 'memoryListSelect', 'classPackListSelect'].forEach(id => {
    document.getElementById(id)?.addEventListener('change', () => setProgressSaveStatus('Tick learned words, then tap Save progress.'));
  });

  if (!document.querySelector('style[data-tingxie-progress-save]')) {
    const style = document.createElement('style');
    style.dataset.tingxieProgressSave = 'true';
    style.textContent = `
      .word-checklist-actions .learned-progress-save-button { margin-left: auto; min-height: 38px; }
      .learned-progress-save-status { margin: -3px 0 0; }
      #saveLearnedProgressButton[data-saved="true"] { box-shadow: 0 0 0 3px rgba(35,118,112,.1); }
      @media (max-width: 560px) {
        .word-checklist-actions .learned-progress-save-button { width: 100%; margin-left: 0; }
      }
    `;
    document.head.appendChild(style);
  }

  return true;
}

function initializeParentFlowPolish() {
  installDirectChildImport();
  installProgressSaveButton();
  document.documentElement.dataset.tingxieParentFlowPolish = 'true';
}

initializeParentFlowPolish();

const parentFlowObserver = new MutationObserver(() => {
  installDirectChildImport();
  installProgressSaveButton();
});
parentFlowObserver.observe(document.body, { childList: true, subtree: true });
setTimeout(() => parentFlowObserver.disconnect(), 5000);

window.__tingxieParentFlowPolish = {
  version: TINGXIE_PARENT_FLOW_POLISH_VERSION,
  apply: initializeParentFlowPolish,
  saveProgress: saveLearnedProgressNow
};
