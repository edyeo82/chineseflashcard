'use strict';

const TINGXIE_FRIENDLY_UX_VERSION = '20260810-1';
const FRIENDLY_TEST_MODE = new URLSearchParams(location.search).get('test');
const FRIENDLY_UX_ACTIVE = !FRIENDLY_TEST_MODE || FRIENDLY_TEST_MODE === 'friendly-ux';

function friendlyText(value) {
  return String(value == null ? '' : value);
}

function installFriendlyStyles() {
  if (document.querySelector('style[data-tingxie-friendly-ux]')) return;
  const style = document.createElement('style');
  style.dataset.tingxieFriendlyUx = 'true';
  style.textContent = `
    .friendly-retired { display: none !important; }
    .word-checklist-row.skipped .word-checklist-text { text-decoration: none !important; }
    .word-checklist-row.skipped { opacity: .58; }
    .friendly-action-overlay {
      position: fixed;
      inset: 0;
      z-index: 5000;
      display: grid;
      place-items: center;
      padding: 18px;
      background: rgba(20, 31, 30, .46);
    }
    .friendly-action-overlay[hidden] { display: none !important; }
    .friendly-action-card {
      width: min(440px, 100%);
      display: grid;
      gap: 12px;
      padding: 18px;
      border-radius: 18px;
      background: #fff;
      box-shadow: 0 24px 70px rgba(20, 31, 30, .3);
    }
    .friendly-action-card h3 { margin: 0; font-size: 1.12rem; }
    .friendly-action-card p { margin: 0; color: var(--muted); line-height: 1.45; }
    .friendly-action-card label { display: grid; gap: 6px; font-size: .82rem; font-weight: 800; }
    .friendly-action-buttons { display: flex; justify-content: flex-end; flex-wrap: wrap; gap: 8px; }
    .friendly-action-buttons button { min-width: 92px; }
    .friendly-action-status { min-height: 1.2em; font-size: .78rem; color: var(--muted); }
    .friendly-action-link { font-size: .78rem; }
    .friendly-action-card.danger .friendly-confirm-button { background: #9b1c1c; color: #fff; border-color: #9b1c1c; }
    @media (max-width: 560px) {
      .friendly-action-overlay { align-items: end; padding: 10px; }
      .friendly-action-card { border-radius: 18px 18px 12px 12px; }
      .friendly-action-buttons { display: grid; grid-template-columns: 1fr 1fr; }
    }
  `;
  document.head.appendChild(style);
}

function ensureFriendlyActionOverlay() {
  let overlay = document.getElementById('friendlyActionOverlay');
  if (overlay) return overlay;

  overlay = document.createElement('div');
  overlay.id = 'friendlyActionOverlay';
  overlay.className = 'friendly-action-overlay';
  overlay.hidden = true;
  overlay.innerHTML = `
    <section class="friendly-action-card" role="dialog" aria-modal="true" aria-labelledby="friendlyActionTitle">
      <h3 id="friendlyActionTitle"></h3>
      <p id="friendlyActionMessage"></p>
      <label id="friendlyActionInputRow" hidden>
        <span id="friendlyActionInputLabel"></span>
        <input id="friendlyActionInput" class="text-input" autocomplete="off">
      </label>
      <label id="friendlyActionLinkRow" hidden>
        <span>Share link</span>
        <input id="friendlyActionLink" class="text-input friendly-action-link" readonly>
      </label>
      <p id="friendlyActionStatus" class="friendly-action-status" role="status" aria-live="polite"></p>
      <div class="friendly-action-buttons">
        <button id="friendlyActionCancel" class="secondary-button" type="button">Cancel</button>
        <button id="friendlyActionConfirm" class="primary-button friendly-confirm-button" type="button">Save</button>
      </div>
    </section>
  `;
  document.body.appendChild(overlay);
  return overlay;
}

function friendlyAction(options = {}) {
  const overlay = ensureFriendlyActionOverlay();
  const card = overlay.querySelector('.friendly-action-card');
  const title = document.getElementById('friendlyActionTitle');
  const message = document.getElementById('friendlyActionMessage');
  const inputRow = document.getElementById('friendlyActionInputRow');
  const inputLabel = document.getElementById('friendlyActionInputLabel');
  const input = document.getElementById('friendlyActionInput');
  const linkRow = document.getElementById('friendlyActionLinkRow');
  const linkInput = document.getElementById('friendlyActionLink');
  const status = document.getElementById('friendlyActionStatus');
  const cancel = document.getElementById('friendlyActionCancel');
  const confirm = document.getElementById('friendlyActionConfirm');

  title.textContent = options.title || 'Confirm';
  message.textContent = options.message || '';
  message.hidden = !options.message;
  card.classList.toggle('danger', Boolean(options.danger));
  inputRow.hidden = !options.input;
  linkRow.hidden = !options.link;
  status.textContent = '';
  cancel.textContent = options.cancelText || 'Cancel';
  confirm.textContent = options.confirmText || 'Save';

  if (options.input) {
    inputLabel.textContent = options.inputLabel || 'Name';
    input.value = options.value || '';
    input.maxLength = options.maxLength || 50;
    input.placeholder = options.placeholder || '';
  }
  if (options.link) linkInput.value = options.link;

  overlay.hidden = false;
  document.body.style.overflow = 'hidden';

  return new Promise(resolve => {
    let finished = false;
    const finish = value => {
      if (finished) return;
      finished = true;
      overlay.hidden = true;
      document.body.style.overflow = '';
      cancel.onclick = null;
      confirm.onclick = null;
      overlay.onclick = null;
      document.removeEventListener('keydown', onKeyDown, true);
      resolve(value);
    };
    const onKeyDown = event => {
      if (event.key === 'Escape') {
        event.preventDefault();
        finish(null);
      }
      if (event.key === 'Enter' && options.input && document.activeElement === input) {
        event.preventDefault();
        finish(input.value);
      }
    };
    cancel.onclick = () => finish(null);
    confirm.onclick = () => finish(options.input ? input.value : true);
    overlay.onclick = event => { if (event.target === overlay) finish(null); };
    document.addEventListener('keydown', onKeyDown, true);
    setTimeout(() => {
      if (options.input) input.focus();
      else confirm.focus();
    }, 0);
  });
}

async function friendlyAskText(options) {
  return friendlyAction({ ...options, input: true });
}

async function friendlyConfirm(options) {
  return Boolean(await friendlyAction({ ...options, input: false }));
}

function replaceButtonHandler(id, handler) {
  const oldButton = document.getElementById(id);
  if (!oldButton) return null;
  const button = oldButton.cloneNode(true);
  oldButton.replaceWith(button);
  button.addEventListener('click', handler);
  return button;
}

function cleanFriendlyName(value, maxLength = 50) {
  return friendlyText(value).replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, maxLength);
}

async function friendlyAddProfile() {
  if (tingxieMemory.profiles.length >= TINGXIE_MAX_PROFILES) {
    showToast(`This family can have up to ${TINGXIE_MAX_PROFILES} children.`);
    return;
  }
  saveDraftImmediately();
  const suggested = `Child ${tingxieMemory.profiles.length + 1}`;
  const value = await friendlyAskText({
    title: 'Add a child',
    message: 'Create a separate place for this child’s 听写 lists and learned words.',
    inputLabel: 'Child’s name',
    value: suggested,
    maxLength: 30,
    placeholder: 'e.g. Sarah',
    confirmText: 'Add child'
  });
  if (value == null) return;
  const name = cleanFriendlyName(value, 30);
  if (!name) { showToast('Enter the child’s name.'); return; }
  if (tingxieMemory.profiles.some(profile => profile.name.toLowerCase() === name.toLowerCase())) {
    showToast('That child is already in this family.');
    return;
  }
  const profile = makeProfile(name);
  tingxieMemory.profiles.push(profile);
  tingxieMemory.activeProfileId = profile.id;
  persistProfileMemory();
  applyProfileWords(profile);
  showToast(`${name} was added.`);
}

async function friendlyRenameProfile() {
  const profile = activeProfile();
  const value = await friendlyAskText({
    title: 'Rename child',
    inputLabel: 'Child’s name',
    value: profile.name,
    maxLength: 30,
    confirmText: 'Save name'
  });
  if (value == null) return;
  const name = cleanFriendlyName(value, 30);
  if (!name || name === profile.name) return;
  if (tingxieMemory.profiles.some(item => item.id !== profile.id && item.name.toLowerCase() === name.toLowerCase())) {
    showToast('That child name is already being used.');
    return;
  }
  profile.name = name;
  profile.updatedAt = memoryNow();
  profile.history = profile.history.map(entry => ({ ...entry, profile: name }));
  persistProfileMemory();
  renderMemoryUi();
  renderHistory();
  showToast(`Child renamed to ${name}.`);
}

async function friendlyDeleteProfile() {
  if (tingxieMemory.profiles.length <= 1) {
    showToast('Keep at least one child profile.');
    return;
  }
  const profile = activeProfile();
  const confirmed = await friendlyConfirm({
    title: `Delete ${profile.name}?`,
    message: `This removes ${profile.name}’s saved 听写 lists and learned-word progress from this family.`,
    confirmText: 'Delete child',
    danger: true
  });
  if (!confirmed) return;
  tingxieMemory.profiles = tingxieMemory.profiles.filter(item => item.id !== profile.id);
  tingxieMemory.activeProfileId = tingxieMemory.profiles[0].id;
  persistProfileMemory();
  applyProfileWords(activeProfile());
  showToast(`${profile.name} was deleted.`);
}

async function friendlyRenameList() {
  const list = activeSavedList();
  if (!list) return;
  const value = await friendlyAskText({
    title: 'Rename 听写 list',
    inputLabel: 'List name',
    value: list.title,
    maxLength: 50,
    placeholder: 'e.g. Term 3 · 听写 4',
    confirmText: 'Save name'
  });
  if (value == null) return;
  const title = cleanFriendlyName(value, 50);
  if (!title) return;
  list.title = title;
  list.customTitle = true;
  list.updatedAt = memoryNow();
  persistProfileMemory();
  renderSavedListChoices();
  updateMemoryStatus(`Saved as “${title}”.`);
}

async function friendlyDeleteList() {
  const profile = activeProfile();
  const list = activeSavedList(profile);
  if (!list) return;
  const confirmed = await friendlyConfirm({
    title: 'Delete this 听写 list?',
    message: `“${list.title}” will be removed from ${profile.name}.`,
    confirmText: 'Delete list',
    danger: true
  });
  if (!confirmed) return;
  profile.lists = profile.lists.filter(item => item.id !== list.id);
  profile.activeListId = null;
  profile.draftWords = [];
  profile.updatedAt = memoryNow();
  persistProfileMemory();
  clearSessionBeforeMemoryLoad();
  renderMemoryUi();
  renderHistory();
  updateMemoryStatus(`Deleted “${list.title}”.`);
}

async function showShareLink(link) {
  const result = await friendlyAction({
    title: 'Share class pack',
    message: 'Copy this link and send it to the class.',
    link,
    confirmText: 'Copy link',
    cancelText: 'Done'
  });
  if (!result) return;
  const status = document.getElementById('friendlyActionStatus');
  try {
    await navigator.clipboard.writeText(link);
    showToast('Class pack link copied.');
  } catch {
    const input = document.getElementById('friendlyActionLink');
    input?.focus();
    input?.select();
    if (status) status.textContent = 'The link is selected. Copy it with your browser’s Copy command.';
  }
}

async function friendlyShareClassPack() {
  const profile = window.__tingxieProfileMemory?.activeProfile?.();
  if (!profile) { showToast('Child profiles are still loading.'); return; }
  const savedLists = (profile.lists || []).filter(list => Array.isArray(list.words) && list.words.length);
  if (!savedLists.length) { showToast('Save at least one 听写 list before sharing.'); return; }

  const pack = profileToClassPack(profile, '听写 class pack');
  if (!pack) { showToast('There are no saved lists to share.'); return; }
  const shareUrl = await buildClassPackShareUrl(pack);
  const shareData = {
    title: pack.title,
    text: `${pack.lists.length} 听写 list${pack.lists.length === 1 ? '' : 's'}`,
    url: shareUrl
  };

  try {
    if (navigator.share) {
      await navigator.share(shareData);
      showToast(`Shared ${pack.lists.length} 听写 list${pack.lists.length === 1 ? '' : 's'}.`);
      return;
    }
    await navigator.clipboard.writeText(shareUrl);
    showToast(`Class pack link copied · ${pack.lists.length} lists.`);
  } catch (error) {
    if (error?.name === 'AbortError') return;
    await showShareLink(shareUrl);
  }
}

function wireFriendlyActions() {
  replaceButtonHandler('addProfileButton', friendlyAddProfile);
  replaceButtonHandler('renameProfileButton', friendlyRenameProfile);
  replaceButtonHandler('deleteProfileButton', friendlyDeleteProfile);
  replaceButtonHandler('renameListButton', friendlyRenameList);
  replaceButtonHandler('deleteListButton', friendlyDeleteList);
  replaceButtonHandler('shareClassPackButton', friendlyShareClassPack);
}

function learnedWordSet(learned) {
  const all = currentAllWords();
  const next = learned ? new Set(all.map(wordStorageKey)) : new Set();
  persistSkippedSet(next);
  renderWordChecklist();
  showToast(learned ? 'All words marked as learned.' : 'All words are ready to practise again.');
}

function updateLearnedSummary() {
  const all = currentAllWords();
  const learned = currentSkippedSet();
  const toPractise = all.filter(word => !learned.has(wordStorageKey(word))).length;
  const summary = document.getElementById('wordChecklistSummary');
  if (summary) summary.textContent = `${learned.size} learned · ${toPractise} to practise`;
  const start = document.getElementById('startDictationButton');
  if (start) start.disabled = toPractise === 0;
}

function renderLearnedChecklist() {
  const list = document.getElementById('wordChecklistRows');
  if (!list) return;
  const words = currentAllWords();
  const learned = currentSkippedSet();
  list.replaceChildren();

  if (!words.length) {
    const empty = document.createElement('p');
    empty.className = 'word-checklist-empty';
    empty.textContent = 'Add a list above. The words will appear here.';
    list.append(empty);
    updateLearnedSummary();
    return;
  }

  words.forEach((word, index) => {
    const key = wordStorageKey(word);
    const isLearned = learned.has(key);
    const row = document.createElement('label');
    row.className = `word-checklist-row${isLearned ? ' skipped learned' : ''}`;

    const checkbox = document.createElement('input');
    checkbox.type = 'checkbox';
    checkbox.checked = isLearned;
    checkbox.dataset.wordKey = key;
    checkbox.setAttribute('aria-label', `Mark ${word} as learned`);

    const number = document.createElement('span');
    number.className = 'word-checklist-number';
    number.textContent = String(index + 1);

    const text = document.createElement('span');
    text.className = 'word-checklist-text';
    text.textContent = word;

    const status = document.createElement('span');
    status.className = 'word-checklist-status';
    status.textContent = isLearned ? 'Learned ✓' : 'Practise';

    checkbox.addEventListener('change', () => {
      const next = currentSkippedSet();
      if (checkbox.checked) next.add(key);
      else next.delete(key);
      persistSkippedSet(next);
      row.classList.toggle('skipped', checkbox.checked);
      row.classList.toggle('learned', checkbox.checked);
      status.textContent = checkbox.checked ? 'Learned ✓' : 'Practise';
      updateLearnedSummary();
      showToast(checkbox.checked
        ? `“${word}” marked as learned. It will not be read.`
        : `“${word}” is back in the practice list.`);
    });

    row.append(checkbox, number, text, status);
    list.append(row);
  });
  updateLearnedSummary();
}

function installLearnedWordLanguage() {
  const box = document.getElementById('wordChecklistBox');
  if (!box) return;
  const heading = box.querySelector('.word-checklist-heading strong');
  const description = box.querySelector('.word-checklist-heading p');
  if (heading) heading.textContent = 'Words your child has learned';
  if (description) description.textContent = 'Tick a word after your child knows it. Ticked words stay saved, turn grey, and will not be read. Untick anytime to practise them again.';
  const enableAll = document.getElementById('enableAllWordsButton');
  const skipAll = document.getElementById('skipAllWordsButton');
  if (enableAll) enableAll.textContent = 'Practise all';
  if (skipAll) skipAll.textContent = 'Mark all learned';

  updateChecklistSummary = updateLearnedSummary;
  renderWordChecklist = renderLearnedChecklist;
  setAllWordsSkipped = learnedWordSet;
  renderLearnedChecklist();
}

function retireBrowserOcr() {
  const sourceInput = document.getElementById('sourceImage');
  sourceInput?.closest('label.upload-zone')?.classList.add('friendly-retired');
  ['sourcePreview', 'scanSourceButton', 'appReadyStatus', 'sourceProgress'].forEach(id => {
    document.getElementById(id)?.classList.add('friendly-retired');
  });
}

function polishFriendlyCopy() {
  const subtitle = document.querySelector('.app-header .subtitle');
  if (subtitle) subtitle.textContent = 'Choose a list → Listen → Learn';
  const setupTitle = document.getElementById('setupTitle');
  if (setupTitle) setupTitle.textContent = 'Choose a child and 听写 list';
  document.getElementById('loadLastButton')?.classList.add('friendly-retired');

  const wordLabel = document.querySelector('label[for="wordList"]');
  if (wordLabel) wordLabel.textContent = 'Words and sentences';
  const wordList = document.getElementById('wordList');
  const help = wordList?.nextElementSibling;
  if (help?.classList.contains('help-text')) {
    help.textContent = 'One item per line. Type here or paste a list from ChatGPT.';
  }

  const pasteBox = document.querySelector('.ai-paste-box');
  const pasteTitle = pasteBox?.querySelector('.ai-paste-copy strong');
  const pasteCopy = pasteBox?.querySelector('.ai-paste-copy p');
  const pasteButton = document.getElementById('pasteListButton');
  if (pasteTitle) pasteTitle.textContent = 'Add a list from a photo';
  if (pasteCopy) pasteCopy.textContent = 'Open the photo in ChatGPT, ask it to extract the 听写 words, copy the list, then paste it here.';
  if (pasteButton) pasteButton.textContent = '📋 Paste list from ChatGPT';

  const saveButton = document.getElementById('saveMemoryListButton');
  if (saveButton) saveButton.textContent = '💾 Save list';

  const shareRow = document.querySelector('.class-pack-share-row p');
  if (shareRow) shareRow.textContent = 'Share all saved lists for this child. Other children get their own learned-word progress.';
}

function initializeFriendlyUx() {
  if (!FRIENDLY_UX_ACTIVE) {
    window.__tingxieFriendlyUx = { version: TINGXIE_FRIENDLY_UX_VERSION, active: false };
    return;
  }
  installFriendlyStyles();
  retireBrowserOcr();
  polishFriendlyCopy();
  installLearnedWordLanguage();
  wireFriendlyActions();
  document.documentElement.dataset.tingxieFriendlyUx = 'true';
  window.__tingxieFriendlyUx = {
    version: TINGXIE_FRIENDLY_UX_VERSION,
    active: true,
    askText: friendlyAskText,
    confirm: friendlyConfirm,
    renderLearned: renderLearnedChecklist
  };
}

initializeFriendlyUx();
