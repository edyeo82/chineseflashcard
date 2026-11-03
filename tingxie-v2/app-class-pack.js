'use strict';

const TINGXIE_CLASS_PACK_VERSION = '20260809-1';
const TINGXIE_CLASS_PACK_PROGRESS_KEY = 'tingxie:classPackProgress:v1';
const TINGXIE_CLASS_PACK_HASH_KEY = 'classpack';
const TINGXIE_CLASS_PACK_MAX_LISTS = 10;

let classPack = null;
let classPackListId = null;
let classPackProgress = loadClassPackProgress();

const originalClassPackFunctions = {
  saveCurrentList: window.saveCurrentList,
  saveHistory: window.saveHistory,
  saveDraftImmediately: window.saveDraftImmediately,
  scheduleDraftSave: window.scheduleDraftSave,
  currentMemoryContext: window.currentMemoryContext,
  currentSkippedSet: window.currentSkippedSet,
  persistSkippedSet: window.persistSkippedSet,
  transferSkippedContext: window.transferSkippedContext
};

function isClassPackActive() {
  return Boolean(classPack && classPackListId);
}

function cleanClassPackText(value, maxLength = 80) {
  return String(value || '').replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, maxLength);
}

function cleanClassPackWords(words) {
  const values = Array.isArray(words) ? words : [];
  return uniqueItems(values.map(item => String(item || '').trim()).filter(Boolean)).slice(0, 120);
}

function newClassPackId() {
  if (window.crypto?.randomUUID) return window.crypto.randomUUID();
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
}

function normalizeClassPack(raw) {
  if (!raw || Number(raw.v) !== 1 || !Array.isArray(raw.lists)) return null;
  const lists = raw.lists.slice(0, TINGXIE_CLASS_PACK_MAX_LISTS).map((list, index) => {
    const words = cleanClassPackWords(list?.words);
    return {
      id: `list-${index + 1}`,
      title: cleanClassPackText(list?.title || `听写 ${index + 1}`, 60) || `听写 ${index + 1}`,
      words
    };
  }).filter(list => list.words.length);
  if (!lists.length) return null;
  return {
    v: 1,
    id: cleanClassPackText(raw.id, 80) || newClassPackId(),
    title: cleanClassPackText(raw.title || 'Class 听写 pack', 80) || 'Class 听写 pack',
    lists
  };
}

function loadClassPackProgress() {
  try {
    const parsed = JSON.parse(localStorage.getItem(TINGXIE_CLASS_PACK_PROGRESS_KEY) || '{}');
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

function saveClassPackProgress() {
  localStorage.setItem(TINGXIE_CLASS_PACK_PROGRESS_KEY, JSON.stringify(classPackProgress));
}

function classPackProgressKey() {
  if (!isClassPackActive()) return null;
  return `${classPack.id}:${classPackListId}`;
}

function currentClassPackSkippedSet() {
  const key = classPackProgressKey();
  if (!key) return new Set();
  const valid = new Set((currentAllWords?.() || []).map(wordStorageKey));
  return new Set((classPackProgress[key] || []).filter(item => valid.has(item)));
}

function persistClassPackSkippedSet(set) {
  const key = classPackProgressKey();
  if (!key) return;
  const values = [...set].filter(Boolean);
  if (values.length) classPackProgress[key] = values;
  else delete classPackProgress[key];
  saveClassPackProgress();
}

function installClassPackIsolation() {
  if (typeof originalClassPackFunctions.saveCurrentList === 'function') {
    window.saveCurrentList = function classPackSafeSaveCurrentList(...args) {
      if (isClassPackActive()) return null;
      return originalClassPackFunctions.saveCurrentList(...args);
    };
  }
  if (typeof originalClassPackFunctions.saveHistory === 'function') {
    window.saveHistory = function classPackSafeSaveHistory(...args) {
      if (isClassPackActive()) return null;
      return originalClassPackFunctions.saveHistory(...args);
    };
  }
  if (typeof originalClassPackFunctions.saveDraftImmediately === 'function') {
    window.saveDraftImmediately = function classPackSafeSaveDraft(...args) {
      if (isClassPackActive()) return null;
      return originalClassPackFunctions.saveDraftImmediately(...args);
    };
  }
  if (typeof originalClassPackFunctions.scheduleDraftSave === 'function') {
    window.scheduleDraftSave = function classPackSafeScheduleDraft(...args) {
      if (isClassPackActive()) return null;
      return originalClassPackFunctions.scheduleDraftSave(...args);
    };
  }
  if (typeof originalClassPackFunctions.currentMemoryContext === 'function') {
    window.currentMemoryContext = function classPackMemoryContext(...args) {
      if (isClassPackActive()) return `classpack:${classPack.id}:${classPackListId}`;
      return originalClassPackFunctions.currentMemoryContext(...args);
    };
  }
  if (typeof originalClassPackFunctions.currentSkippedSet === 'function') {
    window.currentSkippedSet = function classPackSkippedSet(...args) {
      if (isClassPackActive()) return currentClassPackSkippedSet();
      return originalClassPackFunctions.currentSkippedSet(...args);
    };
  }
  if (typeof originalClassPackFunctions.persistSkippedSet === 'function') {
    window.persistSkippedSet = function classPackPersistSkipped(set, ...args) {
      if (isClassPackActive()) {
        persistClassPackSkippedSet(set);
        return;
      }
      return originalClassPackFunctions.persistSkippedSet(set, ...args);
    };
  }
  if (typeof originalClassPackFunctions.transferSkippedContext === 'function') {
    window.transferSkippedContext = function classPackTransferSkipped(...args) {
      if (isClassPackActive()) return;
      return originalClassPackFunctions.transferSkippedContext(...args);
    };
  }
}

function bytesToBase64Url(bytes) {
  let binary = '';
  for (let offset = 0; offset < bytes.length; offset += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(offset, Math.min(bytes.length, offset + 0x8000)));
  }
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

function base64UrlToBytes(value) {
  const padded = String(value || '').replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(value.length / 4) * 4, '=');
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return bytes;
}

async function gzipBytes(bytes) {
  if (!('CompressionStream' in window)) return null;
  const stream = new Blob([bytes]).stream().pipeThrough(new CompressionStream('gzip'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

async function gunzipBytes(bytes) {
  if (!('DecompressionStream' in window)) throw new Error('Compressed class links are not supported in this browser.');
  const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

async function encodeClassPack(pack) {
  const raw = new TextEncoder().encode(JSON.stringify(pack));
  try {
    const compressed = await gzipBytes(raw);
    if (compressed && compressed.length < raw.length) return `g.${bytesToBase64Url(compressed)}`;
  } catch {}
  return `b.${bytesToBase64Url(raw)}`;
}

async function decodeClassPack(value) {
  const [mode, encoded] = String(value || '').split('.', 2);
  if (!encoded || !['g', 'b'].includes(mode)) throw new Error('Invalid class pack link.');
  const bytes = base64UrlToBytes(encoded);
  const decoded = mode === 'g' ? await gunzipBytes(bytes) : bytes;
  return normalizeClassPack(JSON.parse(new TextDecoder().decode(decoded)));
}

function profileToClassPack(profile, title) {
  const lists = [...(profile?.lists || [])]
    .filter(list => Array.isArray(list.words) && list.words.length)
    .sort((left, right) => (Date.parse(left.createdAt || 0) || 0) - (Date.parse(right.createdAt || 0) || 0))
    .slice(0, TINGXIE_CLASS_PACK_MAX_LISTS)
    .map((list, index) => ({
      id: `list-${index + 1}`,
      title: cleanClassPackText(list.title || `听写 ${index + 1}`, 60) || `听写 ${index + 1}`,
      words: cleanClassPackWords(list.words)
    }));
  return normalizeClassPack({
    v: 1,
    id: newClassPackId(),
    title,
    lists
  });
}

async function buildClassPackShareUrl(pack) {
  const encoded = await encodeClassPack(pack);
  const url = new URL(location.pathname, location.origin);
  url.hash = `${TINGXIE_CLASS_PACK_HASH_KEY}=${encoded}`;
  return url.toString();
}

async function shareCurrentProfileAsClassPack() {
  const profile = window.__tingxieProfileMemory?.activeProfile?.();
  if (!profile) {
    showToast('Child profiles are still loading.');
    return;
  }
  const savedLists = (profile.lists || []).filter(list => Array.isArray(list.words) && list.words.length);
  if (!savedLists.length) {
    showToast('Save at least one 听写 list before sharing a class pack.');
    return;
  }

  const suggestedTitle = `${profile.name} · 听写`;
  const requestedTitle = window.prompt('Name this class pack:', suggestedTitle);
  if (requestedTitle == null) return;
  const title = cleanClassPackText(requestedTitle || suggestedTitle, 80) || suggestedTitle;
  const pack = profileToClassPack(profile, title);
  if (!pack) {
    showToast('There are no saved lists to share.');
    return;
  }

  const shareUrl = await buildClassPackShareUrl(pack);
  const shareData = {
    title: pack.title,
    text: `${pack.title} · ${pack.lists.length} 听写 list${pack.lists.length === 1 ? '' : 's'}`,
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
    try {
      await navigator.clipboard.writeText(shareUrl);
      showToast(`Class pack link copied · ${pack.lists.length} lists.`);
    } catch {
      window.prompt('Copy this class pack link:', shareUrl);
    }
  }
}

function installClassPackShareButton() {
  const box = document.getElementById('profileMemoryBox');
  const heading = box?.querySelector('.profile-memory-heading');
  if (!box || !heading || document.getElementById('shareClassPackButton')) return;

  const row = document.createElement('div');
  row.className = 'class-pack-share-row';
  row.innerHTML = `
    <button id="shareClassPackButton" class="secondary-button" type="button">📤 Share class pack</button>
    <p>Shares all saved lists in this child profile (up to 10). Scores, history and skipped checkboxes are never included.</p>
  `;
  heading.insertAdjacentElement('afterend', row);
  document.getElementById('shareClassPackButton').addEventListener('click', shareCurrentProfileAsClassPack);

  const style = document.createElement('style');
  style.dataset.tingxieClassPackShare = 'true';
  style.textContent = `
    .class-pack-share-row { display: grid; grid-template-columns: auto minmax(0,1fr); gap: 10px; align-items: center; }
    .class-pack-share-row p { margin: 0; color: var(--muted); font-size: .78rem; line-height: 1.4; }
    @media (max-width: 620px) { .class-pack-share-row { grid-template-columns: 1fr; } }
  `;
  document.head.appendChild(style);
}

function activeClassPackList() {
  return classPack?.lists.find(list => list.id === classPackListId) || classPack?.lists[0] || null;
}

function renderClassPackList() {
  const list = activeClassPackList();
  if (!list) return;
  const wordList = document.getElementById('wordList');
  wordList.value = list.words.join('\n');
  wordList.readOnly = true;
  wordList.setAttribute('aria-readonly', 'true');
  const select = document.getElementById('classPackListSelect');
  if (select) select.value = list.id;
  const position = classPack.lists.findIndex(item => item.id === list.id) + 1;
  const count = document.getElementById('classPackListCount');
  if (count) count.textContent = `${position} of ${classPack.lists.length}`;
  if (typeof updateWordCount === 'function') updateWordCount();
  if (typeof renderWordChecklist === 'function') renderWordChecklist();
}

function switchClassPackList(listId) {
  if (!classPack?.lists.some(list => list.id === listId)) return;
  classPackListId = listId;
  renderClassPackList();
}

function exitClassPack() {
  const url = new URL(location.href);
  url.hash = '';
  location.href = url.toString();
}

function installClassPackModeUi() {
  const setup = document.getElementById('setupPanel');
  const rightCard = setup?.querySelector('.two-column > .card:last-child');
  if (!setup || !rightCard || document.getElementById('classPackBox')) return;

  document.body.classList.add('tingxie-class-pack-mode');
  document.documentElement.dataset.tingxieClassPack = 'true';

  const box = document.createElement('section');
  box.id = 'classPackBox';
  box.className = 'class-pack-box';
  box.innerHTML = `
    <div class="class-pack-heading">
      <div>
        <span class="pill">Shared class pack</span>
        <h3 id="classPackTitle"></h3>
        <p>This shared pack is read-only. Your own saved profiles, lists and checkbox progress are not changed.</p>
      </div>
      <button id="exitClassPackButton" class="small-button" type="button">Back to my lists</button>
    </div>
    <div class="class-pack-picker">
      <label>Choose 听写 list
        <select id="classPackListSelect" class="select-input"></select>
      </label>
      <span id="classPackListCount" class="pill"></span>
    </div>
    <p class="class-pack-progress-note">Checkboxes in this class pack are personal to this browser and are never sent back to the person who shared the link.</p>
  `;
  rightCard.prepend(box);
  document.getElementById('classPackTitle').textContent = classPack.title;

  const select = document.getElementById('classPackListSelect');
  classPack.lists.forEach((list, index) => select.add(new Option(`${index + 1}. ${list.title}`, list.id)));
  select.addEventListener('change', event => switchClassPackList(event.target.value));
  document.getElementById('exitClassPackButton').addEventListener('click', exitClassPack);

  const setupTitle = document.getElementById('setupTitle');
  if (setupTitle) setupTitle.textContent = 'Class reading pack';
  const wordLabel = document.querySelector('label[for="wordList"]');
  if (wordLabel) wordLabel.textContent = 'Shared words or phrases';

  const style = document.createElement('style');
  style.dataset.tingxieClassPackMode = 'true';
  style.textContent = `
    .class-pack-box { display: grid; gap: 14px; margin-bottom: 16px; padding: 16px; border: 1px solid rgba(72,92,160,.24); border-radius: 16px; background: rgba(245,247,255,.96); }
    .class-pack-heading { display: flex; justify-content: space-between; align-items: flex-start; gap: 14px; }
    .class-pack-heading h3 { margin: 8px 0 4px; font-size: 1.16rem; }
    .class-pack-heading p, .class-pack-progress-note { margin: 0; color: var(--muted); font-size: .82rem; line-height: 1.45; }
    .class-pack-picker { display: grid; grid-template-columns: minmax(0,1fr) auto; gap: 10px; align-items: end; }
    .class-pack-picker label { font-size: .82rem; font-weight: 800; }
    .class-pack-picker select { width: 100%; margin-top: 5px; }
    .tingxie-class-pack-mode #setupPanel .two-column > .card:first-child { display: none !important; }
    .tingxie-class-pack-mode #loadLastButton { display: none !important; }
    .tingxie-class-pack-mode #wordList { background: #f7f7f5; }
    @media (max-width: 620px) {
      .class-pack-heading, .class-pack-picker { display: grid; grid-template-columns: 1fr; }
      #exitClassPackButton { justify-self: start; }
    }
  `;
  document.head.appendChild(style);
}

async function activateClassPackFromHash() {
  const hash = String(location.hash || '').replace(/^#/, '');
  if (!hash.startsWith(`${TINGXIE_CLASS_PACK_HASH_KEY}=`)) return false;
  try {
    const encoded = hash.slice(TINGXIE_CLASS_PACK_HASH_KEY.length + 1);
    const decoded = await decodeClassPack(encoded);
    if (!decoded) throw new Error('The class pack is empty.');
    classPack = decoded;
    classPackListId = decoded.lists[0].id;
    installClassPackModeUi();
    renderClassPackList();
    showToast(`Opened “${decoded.title}” · ${decoded.lists.length} lists.`);
    return true;
  } catch (error) {
    showToast(`Class pack could not be opened: ${error.message}`);
    return false;
  }
}

installClassPackIsolation();
installClassPackShareButton();

window.__tingxieClassPack = {
  version: TINGXIE_CLASS_PACK_VERSION,
  isActive: isClassPackActive,
  pack: () => classPack ? JSON.parse(JSON.stringify(classPack)) : null,
  currentList: () => activeClassPackList() ? JSON.parse(JSON.stringify(activeClassPackList())) : null,
  currentContext: () => isClassPackActive() ? `classpack:${classPack.id}:${classPackListId}` : null,
  skipped: () => [...currentClassPackSkippedSet()],
  createShareUrl: async (profile, title) => {
    const pack = profileToClassPack(profile, title || `${profile?.name || 'Class'} · 听写`);
    return pack ? buildClassPackShareUrl(pack) : null;
  },
  switchList: switchClassPackList,
  ready: activateClassPackFromHash()
};
