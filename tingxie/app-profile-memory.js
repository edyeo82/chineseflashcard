'use strict';

const TINGXIE_MEMORY_VERSION = '20260722-1';
const TINGXIE_MEMORY_KEY = 'tingxie:profileMemory:v1';
const TINGXIE_MAX_PROFILES = 5;
const TINGXIE_MAX_LISTS = 10;
const TINGXIE_MAX_HISTORY = 20;

const legacyLoadLastList = loadLastList;
const legacyResetForNewList = resetForNewList;
const legacyUpdateWordCount = updateWordCount;

let tingxieMemory = null;
let memoryApplying = false;
let memorySaveTimer = null;

function memoryNow() {
  return new Date().toISOString();
}

function memoryId(prefix) {
  if (window.crypto?.randomUUID) return `${prefix}-${window.crypto.randomUUID()}`;
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 9)}`;
}

function parseMemoryJson(value, fallback) {
  if (!value) return fallback;
  try {
    const parsed = JSON.parse(value);
    return parsed == null ? fallback : parsed;
  } catch {
    return fallback;
  }
}

function memoryWords(value) {
  const items = Array.isArray(value) ? value : extractItems(String(value || ''));
  return uniqueItems(items.map(item => String(item || '').trim()).filter(Boolean));
}

function memoryWordKey(words) {
  return memoryWords(words).map(normalizeChinese).filter(Boolean).join('|');
}

function makeListTitle(words) {
  const items = memoryWords(words);
  if (!items.length) return 'Untitled 听写';
  const title = items.slice(0, 3).join('、');
  return title.length > 28 ? `${title.slice(0, 27)}…` : title;
}

function makeProfile(name) {
  const now = memoryNow();
  return {
    id: memoryId('child'),
    name: String(name || 'Child 1').trim() || 'Child 1',
    createdAt: now,
    updatedAt: now,
    activeListId: null,
    draftWords: [],
    lists: [],
    history: []
  };
}

function normalizeList(raw) {
  const now = memoryNow();
  const words = memoryWords(raw?.words);
  return {
    id: String(raw?.id || memoryId('list')),
    title: String(raw?.title || makeListTitle(words)).trim() || makeListTitle(words),
    customTitle: Boolean(raw?.customTitle),
    words,
    createdAt: raw?.createdAt || now,
    updatedAt: raw?.updatedAt || raw?.createdAt || now,
    lastPracticedAt: raw?.lastPracticedAt || null,
    attempts: Math.max(0, Number(raw?.attempts) || 0),
    bestScore: Number.isFinite(Number(raw?.bestScore)) ? Number(raw.bestScore) : null,
    lastScore: Number.isFinite(Number(raw?.lastScore)) ? Number(raw.lastScore) : null,
    lastTotal: Number.isFinite(Number(raw?.lastTotal)) ? Number(raw.lastTotal) : null,
    mistakes: memoryWords(raw?.mistakes)
  };
}

function normalizeProfile(raw, index) {
  const profile = makeProfile(raw?.name || `Child ${index + 1}`);
  profile.id = String(raw?.id || profile.id);
  profile.createdAt = raw?.createdAt || profile.createdAt;
  profile.updatedAt = raw?.updatedAt || profile.updatedAt;
  profile.draftWords = memoryWords(raw?.draftWords);
  profile.lists = Array.isArray(raw?.lists)
    ? raw.lists.map(normalizeList).filter(list => list.words.length).slice(0, TINGXIE_MAX_LISTS)
    : [];
  profile.history = Array.isArray(raw?.history) ? raw.history.slice(0, TINGXIE_MAX_HISTORY) : [];
  profile.activeListId = profile.lists.some(list => list.id === raw?.activeListId) ? raw.activeListId : null;
  return profile;
}

function migrateLegacyMemory() {
  const legacyProfile = String(localStorage.getItem(STORAGE_KEYS.profile) || '').trim();
  const legacyLast = parseMemoryJson(localStorage.getItem(STORAGE_KEYS.lastList), null);
  const legacyHistory = parseMemoryJson(localStorage.getItem(STORAGE_KEYS.history), []);
  const names = [];
  const addName = name => {
    const cleaned = String(name || '').trim();
    if (!cleaned || names.some(item => item.toLowerCase() === cleaned.toLowerCase())) return;
    if (names.length < TINGXIE_MAX_PROFILES) names.push(cleaned);
  };

  addName(legacyProfile);
  addName(legacyLast?.profile);
  if (Array.isArray(legacyHistory)) legacyHistory.forEach(entry => addName(entry?.profile));
  if (!names.length) names.push('Child 1');

  const profiles = names.map(makeProfile);
  const findProfile = name => {
    const cleaned = String(name || '').trim().toLowerCase();
    return profiles.find(profile => profile.name.toLowerCase() === cleaned) || profiles[0];
  };

  if (legacyLast?.words?.length) {
    const profile = findProfile(legacyLast.profile || legacyProfile);
    const list = normalizeList({
      title: makeListTitle(legacyLast.words),
      words: legacyLast.words,
      createdAt: legacyLast.savedAt,
      updatedAt: legacyLast.savedAt
    });
    profile.lists.push(list);
    profile.activeListId = list.id;
  }

  if (Array.isArray(legacyHistory)) {
    legacyHistory.forEach(entry => {
      const profile = findProfile(entry?.profile || legacyProfile);
      profile.history.push({ ...entry, profile: profile.name });
    });
    profiles.forEach(profile => {
      profile.history = profile.history.slice(0, TINGXIE_MAX_HISTORY);
    });
  }

  const active = findProfile(legacyProfile || legacyLast?.profile);
  return {
    version: 1,
    activeProfileId: active.id,
    profiles
  };
}

function loadProfileMemory() {
  const stored = parseMemoryJson(localStorage.getItem(TINGXIE_MEMORY_KEY), null);
  if (!stored || !Array.isArray(stored.profiles) || !stored.profiles.length) return migrateLegacyMemory();

  const profiles = stored.profiles.slice(0, TINGXIE_MAX_PROFILES).map(normalizeProfile);
  if (!profiles.length) profiles.push(makeProfile('Child 1'));
  const activeProfileId = profiles.some(profile => profile.id === stored.activeProfileId)
    ? stored.activeProfileId
    : profiles[0].id;
  return { version: 1, activeProfileId, profiles };
}

function persistProfileMemory() {
  localStorage.setItem(TINGXIE_MEMORY_KEY, JSON.stringify(tingxieMemory));
}

function activeProfile() {
  let profile = tingxieMemory.profiles.find(item => item.id === tingxieMemory.activeProfileId);
  if (!profile) {
    profile = tingxieMemory.profiles[0] || makeProfile('Child 1');
    if (!tingxieMemory.profiles.length) tingxieMemory.profiles.push(profile);
    tingxieMemory.activeProfileId = profile.id;
  }
  return profile;
}

function activeSavedList(profile = activeProfile()) {
  return profile.lists.find(list => list.id === profile.activeListId) || null;
}

function sortedProfileLists(profile = activeProfile()) {
  return [...profile.lists].sort((left, right) => {
    const leftTime = Date.parse(left.updatedAt || left.createdAt || 0) || 0;
    const rightTime = Date.parse(right.updatedAt || right.createdAt || 0) || 0;
    return rightTime - leftTime;
  });
}

function syncLegacyProfile(profile = activeProfile()) {
  const hiddenInput = $('profileName');
  if (hiddenInput) hiddenInput.value = profile.name;
  localStorage.setItem(STORAGE_KEYS.profile, profile.name);
}

function currentTextareaWords() {
  return memoryWords($('wordList')?.value || '');
}

function profileCurrentWords(profile = activeProfile()) {
  const list = activeSavedList(profile);
  return list ? list.words : profile.draftWords;
}

function updateMemoryStatus(message) {
  const status = $('profileMemoryStatus');
  if (status) status.textContent = message;
}

function listScoreLabel(list) {
  if (list.lastScore == null || list.lastTotal == null) return '';
  return ` · ${list.lastScore}/${list.lastTotal}`;
}

function renderProfileChoices() {
  const select = $('memoryProfileSelect');
  if (!select) return;
  select.replaceChildren();
  tingxieMemory.profiles.forEach((profile, index) => {
    select.add(new Option(profile.name || `Child ${index + 1}`, profile.id));
  });
  select.value = activeProfile().id;
  $('addProfileButton').disabled = tingxieMemory.profiles.length >= TINGXIE_MAX_PROFILES;
  $('deleteProfileButton').disabled = tingxieMemory.profiles.length <= 1;
}

function renderSavedListChoices() {
  const profile = activeProfile();
  const select = $('memoryListSelect');
  if (!select) return;
  select.replaceChildren();
  select.add(new Option(profile.draftWords.length ? 'Unsaved draft' : 'New unsaved list', ''));
  sortedProfileLists(profile).forEach(list => {
    select.add(new Option(`${list.title}${listScoreLabel(list)}`, list.id));
  });
  select.value = profile.activeListId || '';
  $('memoryListCount').textContent = `${profile.lists.length}/${TINGXIE_MAX_LISTS} saved`;
  const hasList = Boolean(activeSavedList(profile));
  $('renameListButton').disabled = !hasList;
  $('deleteListButton').disabled = !hasList;
}

function renderMemoryUi() {
  renderProfileChoices();
  renderSavedListChoices();
  syncLegacyProfile();
}

function clearSessionBeforeMemoryLoad() {
  memoryApplying = true;
  try {
    legacyResetForNewList();
  } finally {
    memoryApplying = false;
  }
}

function applyProfileWords(profile = activeProfile(), options = {}) {
  if (options.resetSession !== false) clearSessionBeforeMemoryLoad();
  const words = profileCurrentWords(profile);
  memoryApplying = true;
  try {
    $('wordList').value = words.join('\n');
    legacyUpdateWordCount();
  } finally {
    memoryApplying = false;
  }
  renderMemoryUi();
  renderHistory();
  const list = activeSavedList(profile);
  updateMemoryStatus(list
    ? `Loaded “${list.title}” for ${profile.name}. Changes save automatically in this browser.`
    : profile.draftWords.length
      ? `Restored an unsaved draft for ${profile.name}.`
      : `${profile.name} is ready for a new 听写.`);
}

function saveDraftImmediately() {
  if (memoryApplying || !tingxieMemory) return;
  const profile = activeProfile();
  const words = currentTextareaWords();
  const list = activeSavedList(profile);
  const now = memoryNow();

  if (list) {
    if (words.length) {
      list.words = words;
      if (!list.customTitle) list.title = makeListTitle(words);
      list.updatedAt = now;
    }
  } else {
    profile.draftWords = words;
  }
  profile.updatedAt = now;
  persistProfileMemory();
  renderSavedListChoices();
  updateMemoryStatus(words.length ? `Draft saved for ${profile.name}.` : `${profile.name} has no current draft.`);
}

function scheduleDraftSave() {
  if (memoryApplying || !tingxieMemory) return;
  clearTimeout(memorySaveTimer);
  updateMemoryStatus('Saving…');
  memorySaveTimer = setTimeout(saveDraftImmediately, 450);
}

function evictOldestList(profile) {
  if (profile.lists.length < TINGXIE_MAX_LISTS) return null;
  const oldest = [...profile.lists].sort((left, right) => {
    const leftTime = Date.parse(left.updatedAt || left.createdAt || 0) || 0;
    const rightTime = Date.parse(right.updatedAt || right.createdAt || 0) || 0;
    return leftTime - rightTime;
  })[0];
  profile.lists = profile.lists.filter(list => list.id !== oldest.id);
  return oldest;
}

saveCurrentList = function saveCurrentProfileList(words) {
  const cleanedWords = memoryWords(words);
  if (!cleanedWords.length) return null;
  const profile = activeProfile();
  const now = memoryNow();
  let list = activeSavedList(profile);
  let replaced = null;

  if (!list) {
    const key = memoryWordKey(cleanedWords);
    list = profile.lists.find(item => memoryWordKey(item.words) === key) || null;
  }

  if (!list) {
    replaced = evictOldestList(profile);
    list = normalizeList({
      id: memoryId('list'),
      title: makeListTitle(cleanedWords),
      words: cleanedWords,
      createdAt: now,
      updatedAt: now
    });
    profile.lists.push(list);
  } else {
    list.words = cleanedWords;
    if (!list.customTitle) list.title = makeListTitle(cleanedWords);
    list.updatedAt = now;
  }

  profile.activeListId = list.id;
  profile.draftWords = [];
  profile.updatedAt = now;
  syncLegacyProfile(profile);
  localStorage.setItem(STORAGE_KEYS.lastList, JSON.stringify({
    words: cleanedWords,
    profile: profile.name,
    savedAt: now
  }));
  persistProfileMemory();
  renderMemoryUi();
  updateMemoryStatus(`Saved “${list.title}” for ${profile.name}.`);
  if (replaced) showToast(`Saved the new list. The oldest of ${TINGXIE_MAX_LISTS} lists, “${replaced.title}”, was removed.`);
  return list;
};

loadLastList = function loadCurrentProfileList() {
  const profile = activeProfile();
  if (!profile.activeListId && !profile.draftWords.length && profile.lists.length) {
    profile.activeListId = sortedProfileLists(profile)[0].id;
    persistProfileMemory();
  }
  const words = profileCurrentWords(profile);
  if (!words.length) {
    showToast(`No saved list exists for ${profile.name} yet.`);
    return;
  }
  applyProfileWords(profile);
  showToast(`Loaded ${profile.name}’s last list.`);
};

saveHistory = function saveProfileHistory(entry) {
  const profile = activeProfile();
  const now = entry?.date || memoryNow();
  const list = activeSavedList(profile);
  const historyEntry = {
    ...entry,
    date: now,
    profile: profile.name,
    listId: list?.id || null,
    listTitle: list?.title || makeListTitle(state.sessionWords || state.words)
  };
  profile.history.unshift(historyEntry);
  profile.history = profile.history.slice(0, TINGXIE_MAX_HISTORY);
  profile.updatedAt = now;

  if (list) {
    const score = Number(entry?.correct) || 0;
    list.attempts += 1;
    list.lastScore = score;
    list.lastTotal = Number(entry?.total) || list.words.length;
    list.bestScore = list.bestScore == null ? score : Math.max(list.bestScore, score);
    list.lastPracticedAt = now;
    list.updatedAt = now;
    list.mistakes = memoryWords(entry?.mistakes);
  }

  persistProfileMemory();
  renderMemoryUi();
};

renderHistory = function renderProfileHistory() {
  const container = $('historyList');
  if (!container || !tingxieMemory) return;
  const profile = activeProfile();
  container.replaceChildren();

  if (!profile.history.length) {
    const empty = document.createElement('p');
    empty.textContent = `No saved practice sessions for ${profile.name} yet.`;
    container.append(empty);
    return;
  }

  profile.history.forEach(item => {
    const row = document.createElement('div');
    row.className = 'history-item';
    const left = document.createElement('div');
    const title = document.createElement('p');
    const listName = item.listTitle || (item.mode === 'mistakes' ? 'Mistake retest' : 'Saved list');
    title.textContent = `${listName} · ${item.mode === 'mistakes' ? 'Retest' : 'Full list'}`;
    const time = document.createElement('small');
    time.textContent = formatDate(item.date);
    left.append(title, time);
    const score = document.createElement('strong');
    score.textContent = `${item.correct}/${item.total}`;
    row.append(left, score);
    container.append(row);
  });
};

updateWordCount = function updateWordCountWithMemory() {
  legacyUpdateWordCount();
  scheduleDraftSave();
};

resetForNewList = function resetForNewProfileList() {
  const profile = activeProfile();
  const currentWords = currentTextareaWords();
  if (currentWords.length) saveCurrentList(currentWords);
  profile.activeListId = null;
  profile.draftWords = [];
  profile.updatedAt = memoryNow();
  persistProfileMemory();
  clearSessionBeforeMemoryLoad();
  renderMemoryUi();
  renderHistory();
  updateMemoryStatus(`New blank list for ${profile.name}.`);
};

function switchProfile(profileId) {
  saveDraftImmediately();
  const profile = tingxieMemory.profiles.find(item => item.id === profileId);
  if (!profile) return;
  tingxieMemory.activeProfileId = profile.id;
  profile.updatedAt = memoryNow();
  persistProfileMemory();
  applyProfileWords(profile);
  showToast(`Switched to ${profile.name}.`);
}

function switchSavedList(listId) {
  saveDraftImmediately();
  const profile = activeProfile();
  if (!listId) {
    profile.activeListId = null;
  } else if (profile.lists.some(list => list.id === listId)) {
    profile.activeListId = listId;
  }
  profile.updatedAt = memoryNow();
  persistProfileMemory();
  applyProfileWords(profile);
}

function addProfile() {
  if (tingxieMemory.profiles.length >= TINGXIE_MAX_PROFILES) {
    showToast(`Up to ${TINGXIE_MAX_PROFILES} child profiles are supported.`);
    return;
  }
  saveDraftImmediately();
  const suggested = `Child ${tingxieMemory.profiles.length + 1}`;
  const name = window.prompt('Name this child profile:', suggested);
  if (name == null) return;
  const cleaned = name.trim();
  if (!cleaned) {
    showToast('Enter a profile name.');
    return;
  }
  if (tingxieMemory.profiles.some(profile => profile.name.toLowerCase() === cleaned.toLowerCase())) {
    showToast('That profile name already exists.');
    return;
  }
  const profile = makeProfile(cleaned);
  tingxieMemory.profiles.push(profile);
  tingxieMemory.activeProfileId = profile.id;
  persistProfileMemory();
  applyProfileWords(profile);
  showToast(`${cleaned} was added.`);
}

function renameProfile() {
  const profile = activeProfile();
  const name = window.prompt('Rename this child profile:', profile.name);
  if (name == null) return;
  const cleaned = name.trim();
  if (!cleaned || cleaned === profile.name) return;
  if (tingxieMemory.profiles.some(item => item.id !== profile.id && item.name.toLowerCase() === cleaned.toLowerCase())) {
    showToast('That profile name already exists.');
    return;
  }
  profile.name = cleaned;
  profile.updatedAt = memoryNow();
  profile.history = profile.history.map(entry => ({ ...entry, profile: cleaned }));
  persistProfileMemory();
  renderMemoryUi();
  renderHistory();
  showToast(`Profile renamed to ${cleaned}.`);
}

function deleteProfile() {
  if (tingxieMemory.profiles.length <= 1) {
    showToast('At least one child profile is required.');
    return;
  }
  const profile = activeProfile();
  if (!window.confirm(`Delete ${profile.name} and all of this child’s saved 听写 lists and scores?`)) return;
  tingxieMemory.profiles = tingxieMemory.profiles.filter(item => item.id !== profile.id);
  tingxieMemory.activeProfileId = tingxieMemory.profiles[0].id;
  persistProfileMemory();
  applyProfileWords(activeProfile());
  showToast(`${profile.name} was deleted from this browser.`);
}

function startNewSavedList() {
  const profile = activeProfile();
  const words = currentTextareaWords();
  if (words.length) saveCurrentList(words);
  profile.activeListId = null;
  profile.draftWords = [];
  profile.updatedAt = memoryNow();
  persistProfileMemory();
  clearSessionBeforeMemoryLoad();
  renderMemoryUi();
  renderHistory();
  updateMemoryStatus(`New blank list for ${profile.name}.`);
}

function renameSavedList() {
  const list = activeSavedList();
  if (!list) return;
  const title = window.prompt('Rename this saved 听写:', list.title);
  if (title == null) return;
  const cleaned = title.trim();
  if (!cleaned) return;
  list.title = cleaned.slice(0, 50);
  list.customTitle = true;
  list.updatedAt = memoryNow();
  persistProfileMemory();
  renderSavedListChoices();
  updateMemoryStatus(`Renamed the list to “${list.title}”.`);
}

function deleteSavedList() {
  const profile = activeProfile();
  const list = activeSavedList(profile);
  if (!list) return;
  if (!window.confirm(`Delete “${list.title}” from ${profile.name}’s saved lists?`)) return;
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

function installProfileMemoryUi() {
  const profileInput = $('profileName');
  const profileLabel = document.querySelector('label[for="profileName"]');
  const hostCard = profileInput?.closest('.card');
  if (!profileInput || !hostCard || $('profileMemoryBox')) return;

  profileInput.hidden = true;
  if (profileLabel) profileLabel.hidden = true;

  const style = document.createElement('style');
  style.dataset.tingxieProfileMemory = 'true';
  style.textContent = `
    .profile-memory-box {
      display: grid;
      gap: 14px;
      margin-bottom: 16px;
      padding: 16px;
      border: 1px solid rgba(35, 118, 112, .24);
      border-radius: 16px;
      background: linear-gradient(135deg, rgba(225, 247, 244, .92), #fffdfa);
    }
    .profile-memory-heading { display: flex; justify-content: space-between; gap: 12px; align-items: flex-start; }
    .profile-memory-heading strong { display: block; margin-bottom: 3px; }
    .profile-memory-heading p { margin: 0; color: var(--muted); font-size: .82rem; line-height: 1.4; }
    .memory-control-row { display: grid; grid-template-columns: minmax(0, 1fr) auto; gap: 10px; align-items: end; }
    .memory-control-row label { min-width: 0; font-size: .82rem; font-weight: 800; }
    .memory-control-row select { width: 100%; margin-top: 5px; }
    .memory-actions { display: flex; flex-wrap: wrap; justify-content: flex-end; gap: 7px; }
    .memory-actions button { white-space: nowrap; }
    #memoryListCount { align-self: center; }
    #profileMemoryStatus { margin: 0; }
    @media (max-width: 680px) {
      .memory-control-row { grid-template-columns: 1fr; }
      .memory-actions { justify-content: stretch; }
      .memory-actions button { flex: 1 1 auto; }
    }
  `;
  document.head.appendChild(style);

  const box = document.createElement('section');
  box.id = 'profileMemoryBox';
  box.className = 'profile-memory-box';
  box.setAttribute('aria-label', 'Child profiles and saved Ting Xie lists');
  box.innerHTML = `
    <div class="profile-memory-heading">
      <div>
        <strong>👧 Child memory</strong>
        <p>Each child has separate lists, scores, mistakes and history. Everything stays in this browser.</p>
      </div>
      <span class="pill">Up to ${TINGXIE_MAX_PROFILES} kids</span>
    </div>
    <div class="memory-control-row">
      <label>Child profile
        <select id="memoryProfileSelect" class="select-input"></select>
      </label>
      <div class="memory-actions">
        <button id="addProfileButton" class="small-button" type="button">+ Add</button>
        <button id="renameProfileButton" class="small-button" type="button">Rename</button>
        <button id="deleteProfileButton" class="small-button" type="button">Delete</button>
      </div>
    </div>
    <div class="memory-control-row">
      <label>Saved 听写
        <select id="memoryListSelect" class="select-input"></select>
      </label>
      <div class="memory-actions">
        <span id="memoryListCount" class="pill">0/${TINGXIE_MAX_LISTS} saved</span>
        <button id="newMemoryListButton" class="small-button" type="button">+ New</button>
        <button id="renameListButton" class="small-button" type="button">Rename</button>
        <button id="deleteListButton" class="small-button" type="button">Delete</button>
      </div>
    </div>
    <p id="profileMemoryStatus" class="help-text" role="status" aria-live="polite">Loading saved memory…</p>
  `;
  hostCard.prepend(box);

  $('memoryProfileSelect').addEventListener('change', event => switchProfile(event.target.value));
  $('memoryListSelect').addEventListener('change', event => switchSavedList(event.target.value));
  $('addProfileButton').addEventListener('click', addProfile);
  $('renameProfileButton').addEventListener('click', renameProfile);
  $('deleteProfileButton').addEventListener('click', deleteProfile);
  $('newMemoryListButton').addEventListener('click', startNewSavedList);
  $('renameListButton').addEventListener('click', renameSavedList);
  $('deleteListButton').addEventListener('click', deleteSavedList);

  $('loadLastButton').removeEventListener('click', legacyLoadLastList);
  $('loadLastButton').addEventListener('click', loadLastList);
  $('newListButton').removeEventListener('click', legacyResetForNewList);
  $('newListButton').addEventListener('click', resetForNewList);
  $('wordList').addEventListener('input', scheduleDraftSave);

  document.documentElement.dataset.tingxieProfileMemory = 'true';
}

function initializeProfileMemory() {
  tingxieMemory = loadProfileMemory();
  persistProfileMemory();
  installProfileMemoryUi();
  applyProfileWords(activeProfile(), { resetSession: false });
}

initializeProfileMemory();

window.__tingxieProfileMemory = {
  version: TINGXIE_MEMORY_VERSION,
  maxProfiles: TINGXIE_MAX_PROFILES,
  maxLists: TINGXIE_MAX_LISTS,
  snapshot: () => JSON.parse(JSON.stringify(tingxieMemory)),
  activeProfile: () => JSON.parse(JSON.stringify(activeProfile())),
  saveDraft: saveDraftImmediately,
  saveList: words => saveCurrentList(words),
  switchProfile,
  switchList: switchSavedList
};
