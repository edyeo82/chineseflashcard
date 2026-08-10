'use strict';

const TINGXIE_SIMPLE_SYNC_VERSION = '20260810-1';
const SIMPLE_MEMORY_KEY = 'tingxie:profileMemory:v1';
const SIMPLE_CHECKLIST_KEY = 'tingxie:skippedWords:v1';
const SIMPLE_SAVE_MODE_KEY = 'hcl:saveMode';
const SIMPLE_USERNAME_KEY = 'hcl:simpleUsername';
const SIMPLE_APPLIED_PATH_KEY = 'tingxie:simpleCloudAppliedPath';
const SIMPLE_CLOUD_CHILD_KEY = 'TingXie';

const SIMPLE_FIREBASE_CONFIG = {
  apiKey: 'AIzaSyAhQzUiDlZazIKi3180eT2BTXdaD5h81sI',
  authDomain: 'chinese-flashcards-63883.firebaseapp.com',
  projectId: 'chinese-flashcards-63883',
  storageBucket: 'chinese-flashcards-63883.firebasestorage.app',
  messagingSenderId: '869052621203',
  appId: '1:869052621203:web:f79f36422ffcf5b9d54866',
  measurementId: 'G-07RY3MSQ5P'
};

let simpleMode = localGet(SIMPLE_SAVE_MODE_KEY) === 'username' ? 'username' : 'guest';
let simpleUsername = normalizeFamilyUsername(localGet(SIMPLE_USERNAME_KEY) || '');
let simpleAdapter = null;
let simpleReady = false;
let simpleBusy = false;
let simpleApplying = false;
let simpleWatchTimer = null;
let simpleUploadTimer = null;
let simpleLastSignature = '';

function localGet(key) {
  try { return localStorage.getItem(key); } catch { return null; }
}

function localSet(key, value) {
  try { localStorage.setItem(key, value); } catch { /* storage unavailable */ }
}

function parseJson(value, fallback) {
  if (!value) return fallback;
  try {
    const parsed = JSON.parse(value);
    return parsed == null ? fallback : parsed;
  } catch {
    return fallback;
  }
}

function cloneSimple(value) {
  return JSON.parse(JSON.stringify(value));
}

function normalizeFamilyUsername(value) {
  return String(value || '').trim().toLowerCase();
}

function familyUsernameValid(value) {
  return /^[a-zA-Z0-9_-]{3,30}$/.test(String(value || ''));
}

function simplePath() {
  if (simpleMode !== 'username' || !familyUsernameValid(simpleUsername)) return null;
  return ['publicUsers', simpleUsername, 'children', SIMPLE_CLOUD_CHILD_KEY, 'profile', 'memory'];
}

function simplePathKey() {
  return simplePath()?.join('/') || '';
}

function simpleLocalData() {
  return {
    version: 1,
    memory: parseJson(localGet(SIMPLE_MEMORY_KEY), null),
    checklist: parseJson(localGet(SIMPLE_CHECKLIST_KEY), {}) || {}
  };
}

function simpleSignature(data = simpleLocalData()) {
  return JSON.stringify({ memory: data?.memory || null, checklist: data?.checklist || {} });
}

function simpleStatus(message, error = false) {
  const element = document.getElementById('tingxieCloudStatus');
  if (!element) return;
  element.textContent = message;
  element.classList.toggle('cloud-error', error);
}

function simpleBadge() {
  const badge = document.getElementById('tingxieCloudModeBadge');
  if (!badge) return;
  badge.textContent = simpleMode === 'username' && familyUsernameValid(simpleUsername)
    ? `Family: ${simpleUsername}`
    : 'This device only';
}

function setSimpleBusy(value) {
  simpleBusy = value;
  ['tingxieUsernameInput', 'tingxieUsernameMode', 'tingxieGuestMode'].forEach(id => {
    const element = document.getElementById(id);
    if (element) element.disabled = value;
  });
}

function installSimpleSyncUi() {
  const memoryBox = document.getElementById('profileMemoryBox');
  if (!memoryBox || document.getElementById('tingxieCloudSyncBox')) return;

  const box = document.createElement('details');
  box.id = 'tingxieCloudSyncBox';
  box.className = 'tingxie-cloud-sync-box simple-family-sync';
  box.open = true;
  box.dataset.defaultOpen = 'true';
  box.innerHTML = `
    <summary>
      <span>☁ Family sync</span>
      <span id="tingxieCloudModeBadge" class="pill">This device only</span>
    </summary>
    <p class="tingxie-cloud-intro"><strong>Use one family username on every device.</strong> Child profiles, 听写 lists and learned-word ticks will then save automatically across those devices.</p>
    <div class="simple-family-sync-row">
      <label for="tingxieUsernameInput">Family username
        <input id="tingxieUsernameInput" class="text-input" maxlength="30" autocomplete="username" autocapitalize="none" spellcheck="false" placeholder="e.g. yeofam">
      </label>
      <button id="tingxieUsernameMode" class="primary-button" type="button">Sync family</button>
    </div>
    <p class="simple-family-sync-note">Use a family nickname, not a full name. Anyone who knows this username can open the same family lists.</p>
    <div class="simple-family-sync-footer">
      <button id="tingxieGuestMode" class="text-button" type="button">Use only this device</button>
      <p id="tingxieCloudStatus" class="help-text" role="status" aria-live="polite">Your lists are saved on this device.</p>
    </div>
  `;
  memoryBox.insertAdjacentElement('afterend', box);

  const input = document.getElementById('tingxieUsernameInput');
  input.value = simpleUsername;
  input.addEventListener('keydown', event => {
    if (event.key === 'Enter') {
      event.preventDefault();
      useSimpleUsername();
    }
  });
  document.getElementById('tingxieUsernameMode').addEventListener('click', useSimpleUsername);
  document.getElementById('tingxieGuestMode').addEventListener('click', () => switchSimpleMode('guest'));

  const style = document.createElement('style');
  style.dataset.tingxieSimpleFamilySync = 'true';
  style.textContent = `
    .tingxie-cloud-sync-box {
      margin: 12px 0 18px;
      padding: 13px 14px;
      border: 1px solid rgba(35,118,112,.2);
      border-radius: 16px;
      background: rgba(248,253,252,.9);
    }
    .tingxie-cloud-sync-box > summary {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 10px;
      cursor: pointer;
      font-weight: 850;
    }
    .tingxie-cloud-intro { margin: 12px 0; color: var(--muted); font-size: .84rem; line-height: 1.5; }
    .tingxie-cloud-intro strong { color: var(--text); }
    .simple-family-sync-row {
      display: grid;
      grid-template-columns: minmax(0,1fr) auto;
      gap: 9px;
      align-items: end;
    }
    .simple-family-sync-row label { display: grid; gap: 5px; min-width: 0; font-size: .82rem; font-weight: 800; }
    .simple-family-sync-row .primary-button { min-height: 46px; white-space: nowrap; }
    .simple-family-sync-note { margin: 9px 0 0; color: var(--muted); font-size: .75rem; line-height: 1.4; }
    .simple-family-sync-footer { display: flex; align-items: center; justify-content: space-between; gap: 10px; margin-top: 10px; }
    .simple-family-sync-footer .help-text { margin: 0; text-align: right; }
    #tingxieCloudStatus.cloud-error { color: #9b1c1c; font-weight: 750; }
    @media (max-width: 560px) {
      .simple-family-sync-row { grid-template-columns: 1fr; }
      .simple-family-sync-row .primary-button { width: 100%; }
      .simple-family-sync-footer { display: grid; }
      .simple-family-sync-footer .help-text { text-align: left; }
      .tingxie-cloud-sync-box > summary { align-items: flex-start; }
    }
  `;
  document.head.appendChild(style);
  simpleBadge();
}

async function simpleFirebaseAdapter() {
  if (window.__tingxieCloudTestAdapter) return window.__tingxieCloudTestAdapter;
  const [appModule, firestoreModule] = await Promise.all([
    import('https://www.gstatic.com/firebasejs/10.12.5/firebase-app.js'),
    import('https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js')
  ]);
  const app = appModule.getApps().length ? appModule.getApps()[0] : appModule.initializeApp(SIMPLE_FIREBASE_CONFIG);
  const db = firestoreModule.getFirestore(app);
  return {
    async readDoc(path) {
      const snapshot = await firestoreModule.getDoc(firestoreModule.doc(db, ...path));
      return snapshot.exists() ? snapshot.data() : null;
    },
    writeDoc: (path, payload) => firestoreModule.setDoc(
      firestoreModule.doc(db, ...path),
      { ...payload, updatedAt: firestoreModule.serverTimestamp() },
      { merge: true }
    )
  };
}

async function ensureSimpleAdapter() {
  if (!simpleAdapter) simpleAdapter = await simpleFirebaseAdapter();
  return simpleAdapter;
}

function backupSimpleLocal() {
  const memory = localGet(SIMPLE_MEMORY_KEY);
  const checklist = localGet(SIMPLE_CHECKLIST_KEY);
  if (memory) localSet('tingxie:preCloudBackup:memory', memory);
  if (checklist) localSet('tingxie:preCloudBackup:checklist', checklist);
  localSet('tingxie:preCloudBackup:time', new Date().toISOString());
}

function applySimpleRemote(remote) {
  if (!remote?.memory) return false;
  const pathKey = simplePathKey();
  if (pathKey && sessionStorage.getItem(SIMPLE_APPLIED_PATH_KEY) === pathKey) {
    sessionStorage.removeItem(SIMPLE_APPLIED_PATH_KEY);
    simpleLastSignature = simpleSignature();
    return false;
  }
  const nextSignature = simpleSignature({ memory: remote.memory, checklist: remote.checklist || {} });
  if (nextSignature === simpleSignature()) {
    simpleLastSignature = nextSignature;
    return false;
  }
  backupSimpleLocal();
  simpleApplying = true;
  localSet(SIMPLE_MEMORY_KEY, JSON.stringify(remote.memory));
  localSet(SIMPLE_CHECKLIST_KEY, JSON.stringify(remote.checklist || {}));
  simpleLastSignature = nextSignature;
  if (pathKey) sessionStorage.setItem(SIMPLE_APPLIED_PATH_KEY, pathKey);
  sessionStorage.setItem('tingxie:simpleCloudReloadNotice', simpleUsername);
  location.reload();
  return true;
}

async function simpleUpload(options = {}) {
  const path = simplePath();
  if (!path) {
    if (!options.silent) simpleStatus('Enter a family username first.', true);
    return false;
  }
  const adapter = await ensureSimpleAdapter();
  const local = simpleLocalData();
  await adapter.writeDoc(path, {
    version: 1,
    memory: cloneSimple(local.memory),
    checklist: cloneSimple(local.checklist),
    clientUpdatedAt: new Date().toISOString(),
    source: 'tingxie-web'
  });
  simpleLastSignature = simpleSignature(local);
  if (!options.silent) simpleStatus(`Synced for ${simpleUsername}.`);
  return true;
}

async function simpleLoadCloud() {
  const path = simplePath();
  if (!path) {
    simpleReady = false;
    simpleStatus('Enter a family username to sync across devices.', simpleMode === 'username');
    return;
  }
  setSimpleBusy(true);
  simpleStatus('Syncing family…');
  try {
    const adapter = await ensureSimpleAdapter();
    const remote = await adapter.readDoc(path);
    if (remote?.memory) {
      if (applySimpleRemote(remote)) return;
      simpleReady = true;
      simpleLastSignature = simpleSignature();
      simpleStatus(`Synced automatically for ${simpleUsername}.`);
    } else {
      await simpleUpload({ silent: true });
      simpleReady = true;
      simpleStatus(`Family sync started for ${simpleUsername}.`);
    }
    startSimpleWatcher();
  } catch (error) {
    console.error('Ting Xie family sync failed', error);
    simpleReady = false;
    simpleStatus('Could not sync right now. Your lists are still safe on this device.', true);
  } finally {
    setSimpleBusy(false);
    simpleBadge();
  }
}

function startSimpleWatcher() {
  clearInterval(simpleWatchTimer);
  let observed = simpleSignature();
  simpleWatchTimer = setInterval(() => {
    if (!simpleReady || simpleApplying || simpleMode !== 'username') return;
    const current = simpleSignature();
    if (current === observed) return;
    observed = current;
    clearTimeout(simpleUploadTimer);
    simpleStatus('Saving changes…');
    simpleUploadTimer = setTimeout(async () => {
      try {
        await simpleUpload({ silent: true });
        simpleStatus(`Synced automatically for ${simpleUsername}.`);
      } catch (error) {
        console.error(error);
        simpleStatus('Could not sync right now. Changes remain saved on this device.', true);
      }
    }, 650);
  }, 450);
}

async function switchSimpleMode(mode) {
  simpleMode = mode === 'username' ? 'username' : 'guest';
  localSet(SIMPLE_SAVE_MODE_KEY, simpleMode);
  simpleReady = false;
  clearInterval(simpleWatchTimer);
  simpleBadge();
  if (simpleMode === 'guest') {
    simpleStatus('Using this device only. Existing cloud data is not deleted.');
    return;
  }
  await simpleLoadCloud();
}

async function useSimpleUsername() {
  const input = document.getElementById('tingxieUsernameInput');
  const username = normalizeFamilyUsername(input?.value || '');
  if (!familyUsernameValid(username)) {
    simpleStatus('Use 3–30 letters, numbers, underscores or hyphens.', true);
    input?.focus();
    return;
  }
  simpleUsername = username;
  localSet(SIMPLE_USERNAME_KEY, username);
  await switchSimpleMode('username');
}

async function initializeSimpleFamilySync() {
  installSimpleSyncUi();
  const notice = sessionStorage.getItem('tingxie:simpleCloudReloadNotice');
  if (notice) {
    sessionStorage.removeItem('tingxie:simpleCloudReloadNotice');
    simpleStatus(`Family ${notice} is synced on this device.`);
  }
  if (simpleMode === 'username' && familyUsernameValid(simpleUsername)) {
    await simpleLoadCloud();
  } else {
    simpleMode = 'guest';
    localSet(SIMPLE_SAVE_MODE_KEY, 'guest');
    simpleBadge();
    simpleStatus('Your lists are saved on this device. Add a family username to use them on other devices too.');
  }
  document.documentElement.dataset.tingxieCloudSync = 'true';
  document.documentElement.dataset.tingxieSimpleFamilySync = 'true';
}

initializeSimpleFamilySync().catch(error => {
  console.error('Ting Xie simple family sync initialization failed', error);
  simpleStatus('Family sync could not start. Your lists are still safe on this device.', true);
  document.documentElement.dataset.tingxieCloudSync = 'error';
});

window.__tingxieCloudSync = {
  version: TINGXIE_SIMPLE_SYNC_VERSION,
  mode: () => simpleMode,
  username: () => simpleUsername,
  path: () => simplePath()?.slice() || null,
  localData: () => cloneSimple(simpleLocalData()),
  load: simpleLoadCloud,
  upload: simpleUpload,
  switchMode: switchSimpleMode
};

window.__tingxieSimpleFamilySync = {
  version: TINGXIE_SIMPLE_SYNC_VERSION,
  useUsername: useSimpleUsername,
  mode: () => simpleMode,
  username: () => simpleUsername
};
