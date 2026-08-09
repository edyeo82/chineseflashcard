'use strict';

const TINGXIE_CLASS_PACK_FAMILY_IMPORT_VERSION = '20260809-2';
const TINGXIE_FAMILY_MEMORY_KEY = 'tingxie:profileMemory:v1';
const TINGXIE_FAMILY_PROFILE_KEY = 'tingxie:profile:v1';
const TINGXIE_FAMILY_MAX_PROFILES = 5;
const TINGXIE_FAMILY_MAX_LISTS = 10;
const NEW_CHILD_VALUE = '__new_child__';

function familyClone(value) {
  return JSON.parse(JSON.stringify(value));
}

function familyParse(value, fallback) {
  if (!value) return fallback;
  try {
    const parsed = JSON.parse(value);
    return parsed == null ? fallback : parsed;
  } catch {
    return fallback;
  }
}

function familyNow() {
  return new Date().toISOString();
}

function familyId(prefix) {
  if (window.crypto?.randomUUID) return `${prefix}-${window.crypto.randomUUID()}`;
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

function familyWords(words) {
  const source = Array.isArray(words) ? words : [];
  const seen = new Set();
  const result = [];
  source.forEach(value => {
    const word = String(value || '').trim();
    if (!word) return;
    const key = typeof normalizeChinese === 'function' ? normalizeChinese(word) : word.replace(/\s+/g, '');
    if (!key || seen.has(key)) return;
    seen.add(key);
    result.push(word);
  });
  return result;
}

function familyWordSignature(words) {
  return familyWords(words).map(word => typeof normalizeChinese === 'function' ? normalizeChinese(word) : word.replace(/\s+/g, '')).join('|');
}

function readFamilyMemory() {
  const stored = familyParse(localStorage.getItem(TINGXIE_FAMILY_MEMORY_KEY), null)
    || window.__tingxieProfileMemory?.snapshot?.();
  if (stored && Array.isArray(stored.profiles) && stored.profiles.length) return familyClone(stored);
  return {
    version: 1,
    activeProfileId: null,
    profiles: []
  };
}

function writeFamilyMemory(memory) {
  localStorage.setItem(TINGXIE_FAMILY_MEMORY_KEY, JSON.stringify(memory));
}

function profileIsEmpty(profile) {
  return Array.isArray(profile?.lists) && profile.lists.length === 0
    && Array.isArray(profile?.history) && profile.history.length === 0
    && (!Array.isArray(profile?.draftWords) || profile.draftWords.length === 0);
}

function reusableDefaultProfile(memory) {
  if (memory.profiles.length !== 1) return null;
  const profile = memory.profiles[0];
  if (!profileIsEmpty(profile)) return null;
  return /^Child\s+\d+$/i.test(String(profile.name || '').trim()) ? profile : null;
}

function cleanChildName(value) {
  return String(value || '').replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 30);
}

function makeFamilyProfile(name) {
  const now = familyNow();
  return {
    id: familyId('child'),
    name,
    createdAt: now,
    updatedAt: now,
    activeListId: null,
    draftWords: [],
    lists: [],
    history: []
  };
}

function uniqueImportedTitle(profile, requestedTitle, packTitle) {
  const title = String(requestedTitle || 'Shared 听写').trim().slice(0, 50) || 'Shared 听写';
  const used = new Set((profile.lists || []).map(list => String(list.title || '').trim().toLowerCase()));
  if (!used.has(title.toLowerCase())) return title;

  const withPack = `${title} · ${String(packTitle || 'Class').trim()}`.slice(0, 50);
  if (!used.has(withPack.toLowerCase())) return withPack;

  for (let number = 2; number < 100; number += 1) {
    const suffix = ` (${number})`;
    const candidate = `${title.slice(0, Math.max(1, 50 - suffix.length))}${suffix}`;
    if (!used.has(candidate.toLowerCase())) return candidate;
  }
  return `${title.slice(0, 42)} · shared`;
}

function makeImportedList(profile, sharedList, packTitle) {
  const now = familyNow();
  const words = familyWords(sharedList?.words);
  return {
    id: familyId('list'),
    title: uniqueImportedTitle(profile, sharedList?.title, packTitle),
    customTitle: true,
    words,
    createdAt: now,
    updatedAt: now,
    lastPracticedAt: null,
    attempts: 0,
    bestScore: null,
    lastScore: null,
    lastTotal: null,
    mistakes: []
  };
}

function profileById(memory, id) {
  return memory.profiles.find(profile => profile.id === id) || null;
}

function createOrReuseChild(memory, requestedName) {
  const name = cleanChildName(requestedName);
  if (!name) throw new Error('Enter the child’s name.');
  if (memory.profiles.some(profile => String(profile.name || '').trim().toLowerCase() === name.toLowerCase())) {
    throw new Error('That child profile already exists. Choose it from the list instead.');
  }

  const reusable = reusableDefaultProfile(memory);
  if (reusable) {
    reusable.name = name;
    reusable.updatedAt = familyNow();
    return reusable;
  }

  if (memory.profiles.length >= TINGXIE_FAMILY_MAX_PROFILES) {
    throw new Error(`This family already has ${TINGXIE_FAMILY_MAX_PROFILES} child profiles. Choose an existing child.`);
  }
  const profile = makeFamilyProfile(name);
  memory.profiles.push(profile);
  return profile;
}

function importPackIntoProfile(memory, profile, pack) {
  profile.lists = Array.isArray(profile.lists) ? profile.lists : [];
  profile.history = Array.isArray(profile.history) ? profile.history : [];
  profile.draftWords = Array.isArray(profile.draftWords) ? profile.draftWords : [];

  const signatures = new Map(profile.lists.map(list => [familyWordSignature(list.words), list]));
  const result = {
    added: 0,
    duplicates: 0,
    noRoom: 0,
    firstListId: null,
    importedIds: []
  };

  (pack?.lists || []).forEach(sharedList => {
    const words = familyWords(sharedList?.words);
    if (!words.length) return;
    const signature = familyWordSignature(words);
    const existing = signatures.get(signature);
    if (existing) {
      result.duplicates += 1;
      if (!result.firstListId) result.firstListId = existing.id;
      return;
    }
    if (profile.lists.length >= TINGXIE_FAMILY_MAX_LISTS) {
      result.noRoom += 1;
      return;
    }
    const list = makeImportedList(profile, { ...sharedList, words }, pack?.title);
    profile.lists.push(list);
    signatures.set(signature, list);
    result.added += 1;
    result.importedIds.push(list.id);
    if (!result.firstListId) result.firstListId = list.id;
  });

  const now = familyNow();
  profile.updatedAt = now;
  if (result.firstListId) profile.activeListId = result.firstListId;
  memory.activeProfileId = profile.id;
  memory.version = 1;
  return result;
}

async function syncImportedFamilyToCloud() {
  const cloud = window.__tingxieCloudSync;
  if (!cloud || cloud.mode?.() === 'guest' || !cloud.path?.()) {
    return { cloud: false, message: 'Saved on this device. Turn on family sync to use it on other devices.' };
  }
  try {
    await cloud.upload?.({ silent: true });
    return { cloud: true, message: 'Saved and synced to this family account.' };
  } catch (error) {
    console.error('Class pack family cloud sync failed', error);
    return { cloud: false, message: 'Saved on this device. Cloud sync will retry when available.' };
  }
}

async function importCurrentClassPack(target) {
  const pack = window.__tingxieClassPack?.pack?.();
  if (!pack?.lists?.length) throw new Error('This shared class pack has no lists to save.');
  const memory = readFamilyMemory();
  let profile;

  if (target?.newChild) profile = createOrReuseChild(memory, target.name);
  else {
    profile = profileById(memory, target?.profileId);
    if (!profile) throw new Error('Choose a child profile.');
  }

  const result = importPackIntoProfile(memory, profile, pack);
  writeFamilyMemory(memory);
  localStorage.setItem(TINGXIE_FAMILY_PROFILE_KEY, profile.name);
  const sync = await syncImportedFamilyToCloud();
  return {
    ...result,
    profileId: profile.id,
    profileName: profile.name,
    profileListCount: profile.lists.length,
    familyProfileCount: memory.profiles.length,
    cloud: sync.cloud,
    syncMessage: sync.message
  };
}

function importSummary(result) {
  const pieces = [];
  if (result.added) pieces.push(`${result.added} added`);
  if (result.duplicates) pieces.push(`${result.duplicates} already there`);
  if (result.noRoom) pieces.push(`${result.noRoom} could not fit`);
  if (!pieces.length) pieces.push('No new lists were added');
  return `${result.profileName}: ${pieces.join(' · ')}. ${result.profileListCount}/${TINGXIE_FAMILY_MAX_LISTS} lists saved. ${result.syncMessage}`;
}

function openImportedProfile() {
  const url = new URL(location.href);
  url.hash = '';
  location.href = url.toString();
}

function renderFamilyTargetChoices() {
  const select = document.getElementById('classPackFamilyProfileSelect');
  if (!select) return;
  const memory = readFamilyMemory();
  select.replaceChildren();
  memory.profiles.forEach(profile => {
    const count = Array.isArray(profile.lists) ? profile.lists.length : 0;
    select.add(new Option(`${profile.name} · ${count}/${TINGXIE_FAMILY_MAX_LISTS} lists`, profile.id));
  });

  const canReuseDefault = Boolean(reusableDefaultProfile(memory));
  if (memory.profiles.length < TINGXIE_FAMILY_MAX_PROFILES || canReuseDefault) {
    select.add(new Option('+ New child profile', NEW_CHILD_VALUE));
  }

  if (canReuseDefault) select.value = NEW_CHILD_VALUE;
  else if (memory.activeProfileId && memory.profiles.some(profile => profile.id === memory.activeProfileId)) select.value = memory.activeProfileId;
  else if (memory.profiles[0]) select.value = memory.profiles[0].id;
  updateFamilyImportForm();
}

function updateFamilyImportForm() {
  const select = document.getElementById('classPackFamilyProfileSelect');
  const newRow = document.getElementById('classPackNewChildRow');
  const capacity = document.getElementById('classPackFamilyCapacity');
  const confirm = document.getElementById('classPackFamilySaveConfirm');
  if (!select || !newRow || !capacity || !confirm) return;

  const memory = readFamilyMemory();
  const isNew = select.value === NEW_CHILD_VALUE;
  newRow.hidden = !isNew;
  let available = TINGXIE_FAMILY_MAX_LISTS;
  let label = 'New child';
  if (!isNew) {
    const profile = profileById(memory, select.value);
    const count = profile?.lists?.length || 0;
    available = Math.max(0, TINGXIE_FAMILY_MAX_LISTS - count);
    label = profile?.name || 'Child';
  }
  const packCount = window.__tingxieClassPack?.pack?.()?.lists?.length || 0;
  capacity.textContent = isNew
    ? `${label} can receive all ${Math.min(packCount, TINGXIE_FAMILY_MAX_LISTS)} shared lists.`
    : `${label} has space for ${available} more list${available === 1 ? '' : 's'}. Existing lists are never deleted.`;
  confirm.textContent = `Save ${packCount} shared list${packCount === 1 ? '' : 's'}`;
}

function installFamilyImportUi() {
  if (!window.__tingxieClassPack?.isActive?.()) return;
  const classBox = document.getElementById('classPackBox');
  if (!classBox || document.getElementById('classPackFamilyImport')) return;
  const pack = window.__tingxieClassPack.pack();

  const section = document.createElement('section');
  section.id = 'classPackFamilyImport';
  section.className = 'class-pack-family-import';
  section.innerHTML = `
    <button id="classPackFamilyToggle" class="primary-button" type="button">👧 Save class pack for my child</button>
    <div id="classPackFamilyPanel" class="class-pack-family-panel" hidden>
      <div>
        <strong>Save to your family account</strong>
        <p>Copy these ${pack.lists.length} shared lists into one child profile. The sender’s scores and checkbox progress are never copied.</p>
      </div>
      <label>Child profile
        <select id="classPackFamilyProfileSelect" class="select-input"></select>
      </label>
      <label id="classPackNewChildRow" hidden>New child’s name
        <input id="classPackNewChildName" class="text-input" maxlength="30" autocomplete="off" placeholder="e.g. Sarah">
      </label>
      <p id="classPackFamilyCapacity" class="help-text"></p>
      <button id="classPackFamilySaveConfirm" class="accent-button" type="button"></button>
      <p id="classPackFamilyStatus" class="help-text" role="status" aria-live="polite"></p>
      <button id="classPackOpenChildButton" class="secondary-button" type="button" hidden>Open child’s saved lists →</button>
    </div>
  `;
  classBox.appendChild(section);

  const style = document.createElement('style');
  style.dataset.tingxieClassPackFamilyImport = 'true';
  style.textContent = `
    .class-pack-family-import { display: grid; gap: 10px; padding-top: 2px; border-top: 1px solid rgba(72,92,160,.16); }
    .class-pack-family-panel { display: grid; gap: 10px; padding: 13px; border: 1px solid rgba(35,118,112,.2); border-radius: 13px; background: rgba(255,255,255,.92); }
    .class-pack-family-panel strong { display: block; margin-bottom: 3px; }
    .class-pack-family-panel p { margin: 0; line-height: 1.45; }
    .class-pack-family-panel label { display: grid; gap: 5px; font-size: .82rem; font-weight: 800; }
    #classPackFamilyToggle, #classPackFamilySaveConfirm, #classPackOpenChildButton { width: 100%; }
  `;
  document.head.appendChild(style);

  const toggle = document.getElementById('classPackFamilyToggle');
  const panel = document.getElementById('classPackFamilyPanel');
  toggle.addEventListener('click', () => {
    panel.hidden = !panel.hidden;
    if (!panel.hidden) {
      renderFamilyTargetChoices();
      document.getElementById('classPackNewChildName')?.focus();
    }
  });
  document.getElementById('classPackFamilyProfileSelect').addEventListener('change', updateFamilyImportForm);
  document.getElementById('classPackFamilySaveConfirm').addEventListener('click', async () => {
    const button = document.getElementById('classPackFamilySaveConfirm');
    const status = document.getElementById('classPackFamilyStatus');
    const select = document.getElementById('classPackFamilyProfileSelect');
    const isNew = select.value === NEW_CHILD_VALUE;
    button.disabled = true;
    status.textContent = 'Saving shared lists…';
    try {
      const result = await importCurrentClassPack({
        newChild: isNew,
        profileId: isNew ? null : select.value,
        name: isNew ? document.getElementById('classPackNewChildName').value : ''
      });
      status.textContent = importSummary(result);
      document.getElementById('classPackFamilyToggle').textContent = `✓ Saved for ${result.profileName}`;
      const open = document.getElementById('classPackOpenChildButton');
      open.hidden = false;
      open.textContent = `Open ${result.profileName}’s saved lists →`;
      renderFamilyTargetChoices();
      if (result.noRoom) showToast(`${result.noRoom} shared list${result.noRoom === 1 ? '' : 's'} could not fit because this child already has 10 lists.`);
      else showToast(`Saved class pack for ${result.profileName}.`);
    } catch (error) {
      status.textContent = error?.message || String(error);
      showToast(status.textContent);
    } finally {
      button.disabled = false;
    }
  });
  document.getElementById('classPackOpenChildButton').addEventListener('click', openImportedProfile);

  renderFamilyTargetChoices();
  document.documentElement.dataset.tingxieClassPackFamilyImport = 'true';
}

async function initializeClassPackFamilyImport() {
  await window.__tingxieClassPack?.ready;
  installFamilyImportUi();
}

initializeClassPackFamilyImport().catch(error => {
  console.error('Class pack family import failed', error);
});

window.__tingxieClassPackFamilyImport = {
  version: TINGXIE_CLASS_PACK_FAMILY_IMPORT_VERSION,
  importCurrent: importCurrentClassPack,
  memory: () => familyClone(readFamilyMemory()),
  install: installFamilyImportUi
};
