'use strict';

const TINGXIE_CLOUD_SYNC_VERSION = '20260802-3';
const TINGXIE_MEMORY_STORAGE_KEY = 'tingxie:profileMemory:v1';
const TINGXIE_CHECKLIST_STORAGE_KEY = 'tingxie:skippedWords:v1';
const TINGXIE_SAVE_MODE_KEY = 'hcl:saveMode';
const TINGXIE_USERNAME_KEY = 'hcl:simpleUsername';
const TINGXIE_INTERNAL_EMAIL_SUFFIX = '@users.chineseflashcards.app';
const TINGXIE_CLOUD_CHILD_KEY = 'TingXie';

const TINGXIE_FIREBASE_CONFIG = {
  apiKey: 'AIzaSyAhQzUiDlZazIKi3180eT2BTXdaD5h81sI',
  authDomain: 'chinese-flashcards-63883.firebaseapp.com',
  projectId: 'chinese-flashcards-63883',
  storageBucket: 'chinese-flashcards-63883.firebasestorage.app',
  messagingSenderId: '869052621203',
  appId: '1:869052621203:web:f79f36422ffcf5b9d54866',
  measurementId: 'G-07RY3MSQ5P'
};

let tingxieSaveMode = safeLocalGet(TINGXIE_SAVE_MODE_KEY) || 'guest';
let tingxieSimpleUsername = normalizeCloudUsername(safeLocalGet(TINGXIE_USERNAME_KEY) || '');
let tingxieCloudUser = null;
let tingxieCloudAdapter = null;
let tingxieCloudReady = false;
let tingxieCloudBusy = false;
let tingxieCloudApplying = false;
let tingxieCloudWatchTimer = null;
let tingxieCloudUploadTimer = null;
let tingxieLastCloudSignature = '';

function safeLocalGet(key) {
  try { return localStorage.getItem(key); } catch { return null; }
}

function safeLocalSet(key, value) {
  try { localStorage.setItem(key, value); } catch { /* storage unavailable */ }
}

function safeLocalRemove(key) {
  try { localStorage.removeItem(key); } catch { /* storage unavailable */ }
}

function parseCloudJson(value, fallback) {
  if (!value) return fallback;
  try {
    const parsed = JSON.parse(value);
    return parsed == null ? fallback : parsed;
  } catch {
    return fallback;
  }
}

function cloneCloudValue(value) {
  return JSON.parse(JSON.stringify(value));
}

function normalizeCloudUsername(value) {
  return String(value || '').trim().toLowerCase();
}

function cloudUsernameIsValid(value) {
  return /^[a-zA-Z0-9_-]{3,30}$/.test(String(value || ''));
}

function accountEmailFromCloudInput() {
  let raw = String(document.getElementById('tingxieEmailInput')?.value || '').trim().toLowerCase();
  if (!raw) throw new Error('Enter a User ID or email.');
  if (raw.includes('@')) return raw;
  if (!/^[a-zA-Z0-9._-]{3,40}$/.test(raw)) {
    throw new Error('User ID must be 3–40 letters, numbers, dots, underscores, or hyphens.');
  }
  return `${raw}${TINGXIE_INTERNAL_EMAIL_SUFFIX}`;
}

function displayCloudAccount(user) {
  const email = String(user?.email || user?.displayName || 'Signed in');
  return email.endsWith(TINGXIE_INTERNAL_EMAIL_SUFFIX)
    ? email.slice(0, -TINGXIE_INTERNAL_EMAIL_SUFFIX.length)
    : email;
}

function cloudModeLabel() {
  if (tingxieSaveMode === 'guest') return 'Guest · this browser only';
  if (tingxieSaveMode === 'username') return tingxieSimpleUsername || 'Username';
  if (tingxieSaveMode === 'auth') return tingxieCloudUser ? displayCloudAccount(tingxieCloudUser) : 'Waiting for sign-in';
  return 'Guest · this browser only';
}

function cloudDocPath() {
  if (tingxieSaveMode === 'username' && cloudUsernameIsValid(tingxieSimpleUsername)) {
    return ['publicUsers', tingxieSimpleUsername, 'children', TINGXIE_CLOUD_CHILD_KEY, 'profile', 'memory'];
  }
  if (tingxieSaveMode === 'auth' && tingxieCloudUser?.uid) {
    return ['users', tingxieCloudUser.uid, 'children', TINGXIE_CLOUD_CHILD_KEY, 'profile', 'memory'];
  }
  return null;
}

function currentLocalCloudData() {
  return {
    version: 1,
    memory: parseCloudJson(safeLocalGet(TINGXIE_MEMORY_STORAGE_KEY), null),
    checklist: parseCloudJson(safeLocalGet(TINGXIE_CHECKLIST_STORAGE_KEY), {}) || {}
  };
}

function cloudDataSignature(data = currentLocalCloudData()) {
  return JSON.stringify({
    memory: data?.memory || null,
    checklist: data?.checklist || {}
  });
}

function hasUsefulMemory(data) {
  const profiles = data?.memory?.profiles;
  if (!Array.isArray(profiles) || !profiles.length) return false;
  return profiles.some(profile =>
    (Array.isArray(profile?.lists) && profile.lists.length) ||
    (Array.isArray(profile?.draftWords) && profile.draftWords.length) ||
    String(profile?.name || '').trim() !== 'Child 1'
  );
}

function setCloudStatus(message, isError = false) {
  const status = document.getElementById('tingxieCloudStatus');
  if (!status) return;
  status.textContent = message;
  status.classList.toggle('cloud-error', isError);
}

function setCloudBusy(isBusy) {
  tingxieCloudBusy = isBusy;
  [
    'tingxieGuestMode', 'tingxieUsernameMode', 'tingxieGoogleSignIn',
    'tingxieEmailSignIn', 'tingxieEmailCreate', 'tingxieSignOut',
    'tingxieCopyLocalToCloud', 'tingxieRefreshCloud'
  ].forEach(id => {
    const element = document.getElementById(id);
    if (element) element.disabled = isBusy;
  });
}

function updateCloudUi() {
  const usernameInput = document.getElementById('tingxieUsernameInput');
  if (usernameInput && document.activeElement !== usernameInput) usernameInput.value = tingxieSimpleUsername;

  document.getElementById('tingxieGuestCard')?.classList.toggle('active', tingxieSaveMode === 'guest');
  document.getElementById('tingxieUsernameCard')?.classList.toggle('active', tingxieSaveMode === 'username');
  document.getElementById('tingxieAuthCard')?.classList.toggle('active', tingxieSaveMode === 'auth');

  const warning = document.getElementById('tingxieUsernameWarning');
  if (warning) warning.hidden = tingxieSaveMode !== 'username';

  const signOutButton = document.getElementById('tingxieSignOut');
  if (signOutButton) signOutButton.disabled = tingxieCloudBusy || !tingxieCloudUser;

  const badge = document.getElementById('tingxieCloudModeBadge');
  if (badge) badge.textContent = cloudModeLabel();
}

function installTopLearningAppsLink() {
  const link = document.getElementById('learningHubLink');
  const titleBlock = document.querySelector('.app-header > div');
  if (!link || !titleBlock) return;

  link.textContent = '← Learning apps';
  link.setAttribute('aria-label', 'Return to all learning apps');
  titleBlock.prepend(link);

  const style = document.createElement('style');
  style.dataset.tingxieTopHubLink = 'true';
  style.textContent = `
    #learningHubLink {
      position: static !important;
      inset: auto !important;
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
    #learningHubLink:hover, #learningHubLink:focus-visible {
      text-decoration: underline !important;
      transform: none !important;
    }
  `;
  document.head.appendChild(style);
  document.documentElement.dataset.tingxieHubLinkPlacement = 'top';
}

function installCloudSyncUi() {
  const memoryBox = document.getElementById('profileMemoryBox');
  if (!memoryBox || document.getElementById('tingxieCloudSyncBox')) return;

  const box = document.createElement('details');
  box.id = 'tingxieCloudSyncBox';
  box.className = 'tingxie-cloud-sync-box';
  box.innerHTML = `
    <summary>
      <span>☁ Sync profiles and lists across devices</span>
      <span id="tingxieCloudModeBadge" class="pill">Guest · this browser only</span>
    </summary>
    <p class="tingxie-cloud-intro">Use the same Username or Sign-in account as Chinese Flashcards. Guest data remains only in this browser.</p>
    <div class="tingxie-cloud-grid">
      <section id="tingxieGuestCard" class="tingxie-cloud-card">
        <strong>Guest</strong>
        <button id="tingxieGuestMode" class="small-button" type="button">Use</button>
      </section>
      <section id="tingxieUsernameCard" class="tingxie-cloud-card">
        <strong>Username</strong>
        <input id="tingxieUsernameInput" class="text-input" maxlength="30" autocomplete="username" placeholder="e.g. family123">
        <button id="tingxieUsernameMode" class="small-button" type="button">Use</button>
      </section>
      <section id="tingxieAuthCard" class="tingxie-cloud-card tingxie-cloud-auth-card">
        <strong>Sign in</strong>
        <div class="tingxie-auth-fields">
          <input id="tingxieEmailInput" class="text-input" autocomplete="username" placeholder="User ID or email">
          <input id="tingxiePasswordInput" class="text-input" type="password" autocomplete="current-password" placeholder="Password">
        </div>
        <div class="tingxie-auth-actions">
          <button id="tingxieGoogleSignIn" class="primary-button" type="button">Google</button>
          <button id="tingxieEmailCreate" class="small-button" type="button">Create</button>
          <button id="tingxieEmailSignIn" class="small-button" type="button">Sign in</button>
          <button id="tingxieSignOut" class="small-button" type="button">Sign out</button>
        </div>
      </section>
    </div>
    <p id="tingxieUsernameWarning" class="tingxie-cloud-warning" hidden>Simple Username mode is not private. Anyone who knows the username may access its Ting Xie lists. Use nicknames only, or use Sign in for private storage.</p>
    <div class="tingxie-cloud-actions">
      <button id="tingxieCopyLocalToCloud" class="secondary-button" type="button">Copy this browser to cloud</button>
      <button id="tingxieRefreshCloud" class="secondary-button" type="button">Reload from cloud</button>
    </div>
    <p id="tingxieCloudStatus" class="help-text" role="status" aria-live="polite">Cloud sync is starting…</p>
  `;
  memoryBox.insertAdjacentElement('afterend', box);

  const style = document.createElement('style');
  style.dataset.tingxieCloudSync = 'true';
  style.textContent = `
    .tingxie-cloud-sync-box {
      margin: 12px 0 18px;
      padding: 12px 14px;
      border: 1px solid rgba(35, 118, 112, .2);
      border-radius: 16px;
      background: rgba(248, 253, 252, .86);
    }
    .tingxie-cloud-sync-box > summary {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 10px;
      cursor: pointer;
      font-weight: 850;
    }
    .tingxie-cloud-intro { margin: 12px 0; color: var(--muted); font-size: .84rem; line-height: 1.45; }
    .tingxie-cloud-grid { display: grid; grid-template-columns: .7fr 1.3fr; gap: 9px; }
    .tingxie-cloud-card {
      display: grid;
      gap: 8px;
      padding: 11px;
      border: 1px solid var(--border);
      border-radius: 13px;
      background: white;
    }
    .tingxie-cloud-card.active { border-color: var(--primary); box-shadow: 0 0 0 3px rgba(35, 118, 112, .1); }
    .tingxie-cloud-auth-card { grid-column: 1 / -1; }
    .tingxie-auth-fields { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; }
    .tingxie-auth-actions { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 8px; }
    .tingxie-auth-actions button { min-height: 42px; padding: 7px; }
    .tingxie-cloud-warning { margin: 10px 0 0; padding: 9px; border-radius: 11px; background: #fff7e6; color: #6f4300; font-size: .78rem; line-height: 1.4; }
    .tingxie-cloud-actions { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 11px; }
    .tingxie-cloud-actions button { min-height: 42px; }
    #tingxieCloudStatus { margin: 9px 0 0; }
    #tingxieCloudStatus.cloud-error { color: #9b1c1c; font-weight: 750; }
    @media (max-width: 560px) {
      .tingxie-cloud-grid, .tingxie-auth-fields { grid-template-columns: 1fr; }
      .tingxie-cloud-auth-card { grid-column: auto; }
      .tingxie-auth-actions { grid-template-columns: 1fr 1fr; }
      .tingxie-cloud-sync-box > summary { align-items: flex-start; }
    }
  `;
  document.head.appendChild(style);

  document.getElementById('tingxieGuestMode').addEventListener('click', () => switchCloudMode('guest'));
  document.getElementById('tingxieUsernameMode').addEventListener('click', useCloudUsername);
  document.getElementById('tingxieGoogleSignIn').addEventListener('click', signInCloudGoogle);
  document.getElementById('tingxieEmailSignIn').addEventListener('click', signInCloudEmail);
  document.getElementById('tingxieEmailCreate').addEventListener('click', createCloudEmailAccount);
  document.getElementById('tingxieSignOut').addEventListener('click', signOutCloudAccount);
  document.getElementById('tingxieCopyLocalToCloud').addEventListener('click', copyLocalToCloud);
  document.getElementById('tingxieRefreshCloud').addEventListener('click', () => loadCloudData({ force: true }));

  updateCloudUi();
}

async function makeFirebaseCloudAdapter() {
  const testAdapter = window.__tingxieCloudTestAdapter;
  if (testAdapter) return testAdapter;

  const [appModule, authModule, firestoreModule] = await Promise.all([
    import('https://www.gstatic.com/firebasejs/10.12.5/firebase-app.js'),
    import('https://www.gstatic.com/firebasejs/10.12.5/firebase-auth.js'),
    import('https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js')
  ]);

  const app = appModule.getApps().length
    ? appModule.getApps()[0]
    : appModule.initializeApp(TINGXIE_FIREBASE_CONFIG);
  const auth = authModule.getAuth(app);
  const db = firestoreModule.getFirestore(app);
  const provider = new authModule.GoogleAuthProvider();

  return {
    onAuthStateChanged: callback => authModule.onAuthStateChanged(auth, callback),
    signInGoogle: () => authModule.signInWithPopup(auth, provider),
    signInEmail: (email, password) => authModule.signInWithEmailAndPassword(auth, email, password),
    createEmail: (email, password) => authModule.createUserWithEmailAndPassword(auth, email, password),
    signOut: () => authModule.signOut(auth),
    async readDoc(path) {
      const snapshot = await firestoreModule.getDoc(firestoreModule.doc(db, ...path));
      return snapshot.exists() ? snapshot.data() : null;
    },
    async writeDoc(path, payload) {
      await firestoreModule.setDoc(
        firestoreModule.doc(db, ...path),
        { ...payload, updatedAt: firestoreModule.serverTimestamp() },
        { merge: true }
      );
    }
  };
}

async function ensureCloudAdapter() {
  if (tingxieCloudAdapter) return tingxieCloudAdapter;
  tingxieCloudAdapter = await makeFirebaseCloudAdapter();
  tingxieCloudAdapter.onAuthStateChanged?.(async user => {
    tingxieCloudUser = user || null;
    updateCloudUi();
    if (tingxieSaveMode === 'auth') {
      if (tingxieCloudUser) await loadCloudData();
      else {
        tingxieCloudReady = false;
        setCloudStatus('Sign in to load private cloud profiles and lists.');
      }
    }
  });
  return tingxieCloudAdapter;
}

function backupLocalMemoryBeforeCloud() {
  const memory = safeLocalGet(TINGXIE_MEMORY_STORAGE_KEY);
  const checklist = safeLocalGet(TINGXIE_CHECKLIST_STORAGE_KEY);
  if (memory) safeLocalSet('tingxie:preCloudBackup:memory', memory);
  if (checklist) safeLocalSet('tingxie:preCloudBackup:checklist', checklist);
  safeLocalSet('tingxie:preCloudBackup:time', new Date().toISOString());
}

function applyCloudData(remote) {
  if (!remote?.memory) return false;
  const next = { memory: remote.memory, checklist: remote.checklist || {} };
  const nextSignature = cloudDataSignature(next);
  if (nextSignature === cloudDataSignature()) {
    tingxieLastCloudSignature = nextSignature;
    return false;
  }

  backupLocalMemoryBeforeCloud();
  tingxieCloudApplying = true;
  safeLocalSet(TINGXIE_MEMORY_STORAGE_KEY, JSON.stringify(remote.memory));
  safeLocalSet(TINGXIE_CHECKLIST_STORAGE_KEY, JSON.stringify(remote.checklist || {}));
  tingxieLastCloudSignature = nextSignature;
  sessionStorage.setItem('tingxie:cloudReloadNotice', cloudModeLabel());
  location.reload();
  return true;
}

async function uploadLocalCloudData(options = {}) {
  const path = cloudDocPath();
  if (!path) {
    if (!options.silent) setCloudStatus('Choose a Username or sign in before uploading.', true);
    return false;
  }
  const adapter = await ensureCloudAdapter();
  const local = currentLocalCloudData();
  const signature = cloudDataSignature(local);
  await adapter.writeDoc(path, {
    version: 1,
    memory: cloneCloudValue(local.memory),
    checklist: cloneCloudValue(local.checklist),
    clientUpdatedAt: new Date().toISOString(),
    source: 'tingxie-web'
  });
  tingxieLastCloudSignature = signature;
  if (!options.silent) setCloudStatus(`Cloud saved for ${cloudModeLabel()}.`);
  return true;
}

async function loadCloudData(options = {}) {
  const path = cloudDocPath();
  if (!path) {
    tingxieCloudReady = false;
    if (tingxieSaveMode === 'auth' && !tingxieCloudUser) setCloudStatus('Sign in to load private cloud profiles and lists.');
    else if (tingxieSaveMode === 'username') setCloudStatus('Enter a valid Username to load cloud profiles and lists.', true);
    return;
  }

  setCloudBusy(true);
  setCloudStatus('Loading cloud profiles and lists…');
  try {
    const adapter = await ensureCloudAdapter();
    const remote = await adapter.readDoc(path);
    if (remote?.memory) {
      if (applyCloudData(remote)) return;
      tingxieCloudReady = true;
      tingxieLastCloudSignature = cloudDataSignature();
      setCloudStatus(`Cloud is up to date for ${cloudModeLabel()}.`);
    } else {
      await uploadLocalCloudData({ silent: true });
      tingxieCloudReady = true;
      setCloudStatus(`Created cloud storage for ${cloudModeLabel()} using this browser’s profiles and lists.`);
    }
    startCloudWatcher();
  } catch (error) {
    console.error('Ting Xie cloud load failed', error);
    tingxieCloudReady = false;
    setCloudStatus(`Cloud sync failed: ${error?.message || error}`, true);
  } finally {
    setCloudBusy(false);
    updateCloudUi();
  }
}

function startCloudWatcher() {
  clearInterval(tingxieCloudWatchTimer);
  let observed = cloudDataSignature();
  tingxieCloudWatchTimer = setInterval(() => {
    if (!tingxieCloudReady || tingxieCloudApplying || tingxieSaveMode === 'guest') return;
    const signature = cloudDataSignature();
    if (signature === observed) return;
    observed = signature;
    clearTimeout(tingxieCloudUploadTimer);
    setCloudStatus('Saving changes to cloud…');
    tingxieCloudUploadTimer = setTimeout(async () => {
      try {
        await uploadLocalCloudData({ silent: true });
        setCloudStatus(`Cloud saved for ${cloudModeLabel()}.`);
      } catch (error) {
        console.error('Ting Xie cloud save failed', error);
        setCloudStatus(`Cloud save failed: ${error?.message || error}`, true);
      }
    }, 650);
  }, 450);
}

async function switchCloudMode(mode) {
  tingxieSaveMode = mode;
  safeLocalSet(TINGXIE_SAVE_MODE_KEY, mode);
  tingxieCloudReady = false;
  clearInterval(tingxieCloudWatchTimer);
  updateCloudUi();

  if (mode === 'guest') {
    setCloudStatus('Guest mode: profiles and lists stay in this browser. Existing cloud data is not deleted.');
    return;
  }
  await ensureCloudAdapter();
  await loadCloudData();
}

async function useCloudUsername() {
  const input = document.getElementById('tingxieUsernameInput');
  const username = normalizeCloudUsername(input?.value || '');
  if (!cloudUsernameIsValid(username)) {
    setCloudStatus('Username must be 3–30 characters using letters, numbers, underscores, or hyphens.', true);
    input?.focus();
    return;
  }
  tingxieSimpleUsername = username;
  safeLocalSet(TINGXIE_USERNAME_KEY, username);
  await switchCloudMode('username');
}

async function signInCloudGoogle() {
  try {
    setCloudBusy(true);
    const adapter = await ensureCloudAdapter();
    await adapter.signInGoogle();
    await switchCloudMode('auth');
  } catch (error) {
    console.error(error);
    setCloudStatus(`Google sign-in failed: ${error?.message || error}`, true);
  } finally {
    setCloudBusy(false);
  }
}

async function signInCloudEmail() {
  try {
    setCloudBusy(true);
    const adapter = await ensureCloudAdapter();
    const password = document.getElementById('tingxiePasswordInput')?.value || '';
    await adapter.signInEmail(accountEmailFromCloudInput(), password);
    await switchCloudMode('auth');
  } catch (error) {
    console.error(error);
    setCloudStatus(`Sign-in failed: ${error?.message || error}`, true);
  } finally {
    setCloudBusy(false);
  }
}

async function createCloudEmailAccount() {
  try {
    setCloudBusy(true);
    const adapter = await ensureCloudAdapter();
    const password = document.getElementById('tingxiePasswordInput')?.value || '';
    await adapter.createEmail(accountEmailFromCloudInput(), password);
    await switchCloudMode('auth');
  } catch (error) {
    console.error(error);
    setCloudStatus(`Account creation failed: ${error?.message || error}`, true);
  } finally {
    setCloudBusy(false);
  }
}

async function signOutCloudAccount() {
  try {
    setCloudBusy(true);
    const adapter = await ensureCloudAdapter();
    await adapter.signOut();
    tingxieCloudUser = null;
    await switchCloudMode('guest');
  } catch (error) {
    console.error(error);
    setCloudStatus(`Sign out failed: ${error?.message || error}`, true);
  } finally {
    setCloudBusy(false);
  }
}

async function copyLocalToCloud() {
  const path = cloudDocPath();
  if (!path) {
    setCloudStatus('Choose a Username or sign in before copying this browser to cloud.', true);
    return;
  }
  const confirmed = window.confirm('Replace the cloud Ting Xie profiles and lists with the data currently in this browser?');
  if (!confirmed) return;
  try {
    setCloudBusy(true);
    await uploadLocalCloudData();
    tingxieCloudReady = true;
    startCloudWatcher();
  } catch (error) {
    console.error(error);
    setCloudStatus(`Cloud copy failed: ${error?.message || error}`, true);
  } finally {
    setCloudBusy(false);
  }
}

async function initializeTingXieCloudSync() {
  installTopLearningAppsLink();
  installCloudSyncUi();

  const reloadedMode = sessionStorage.getItem('tingxie:cloudReloadNotice');
  if (reloadedMode) {
    sessionStorage.removeItem('tingxie:cloudReloadNotice');
    setCloudStatus(`Loaded cloud profiles and lists for ${reloadedMode}.`);
  } else if (tingxieSaveMode === 'guest') {
    setCloudStatus('Guest mode: profiles and lists stay in this browser. Open this section to use the same Username or Sign-in as Chinese Flashcards.');
  }

  updateCloudUi();
  if (tingxieSaveMode === 'username' && cloudUsernameIsValid(tingxieSimpleUsername)) {
    await ensureCloudAdapter();
    await loadCloudData();
  } else if (tingxieSaveMode === 'auth') {
    await ensureCloudAdapter();
    if (!tingxieCloudUser) setCloudStatus('Checking your Chinese Flashcards sign-in…');
  }

  document.documentElement.dataset.tingxieCloudSync = 'true';
}

initializeTingXieCloudSync().catch(error => {
  console.error('Ting Xie cloud sync initialization failed', error);
  setCloudStatus(`Cloud sync could not start: ${error?.message || error}`, true);
  document.documentElement.dataset.tingxieCloudSync = 'error';
});

window.__tingxieCloudSync = {
  version: TINGXIE_CLOUD_SYNC_VERSION,
  mode: () => tingxieSaveMode,
  username: () => tingxieSimpleUsername,
  path: () => cloudDocPath()?.slice() || null,
  localData: () => cloneCloudValue(currentLocalCloudData()),
  load: () => loadCloudData({ force: true }),
  upload: () => uploadLocalCloudData(),
  switchMode: switchCloudMode
};
