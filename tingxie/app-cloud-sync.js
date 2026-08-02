'use strict';

const TINGXIE_CLOUD_SYNC_VERSION = '20260802-3';
const TINGXIE_MEMORY_STORAGE_KEY = 'tingxie:profileMemory:v1';
const TINGXIE_CHECKLIST_STORAGE_KEY = 'tingxie:skippedWords:v1';
const TINGXIE_SAVE_MODE_KEY = 'hcl:saveMode';
const TINGXIE_USERNAME_KEY = 'hcl:simpleUsername';
const TINGXIE_INTERNAL_EMAIL_SUFFIX = '@users.chineseflashcards.app';
const TINGXIE_CLOUD_CHILD_KEY = 'TingXie';
const TINGXIE_APPLIED_PATH_KEY = 'tingxie:cloudAppliedPath';

const TINGXIE_FIREBASE_CONFIG = {
  apiKey: 'AIzaSyAhQzUiDlZazIKi3180eT2BTXdaD5h81sI',
  authDomain: 'chinese-flashcards-63883.firebaseapp.com',
  projectId: 'chinese-flashcards-63883',
  storageBucket: 'chinese-flashcards-63883.firebasestorage.app',
  messagingSenderId: '869052621203',
  appId: '1:869052621203:web:f79f36422ffcf5b9d54866',
  measurementId: 'G-07RY3MSQ5P'
};

let cloudMode = localGet(TINGXIE_SAVE_MODE_KEY) || 'guest';
let cloudUsername = normalizeUsername(localGet(TINGXIE_USERNAME_KEY) || '');
let cloudUser = null;
let cloudAdapter = null;
let cloudReady = false;
let cloudBusy = false;
let cloudApplying = false;
let watchTimer = null;
let uploadTimer = null;
let lastCloudSignature = '';

function localGet(key) {
  try { return localStorage.getItem(key); } catch { return null; }
}

function localSet(key, value) {
  try { localStorage.setItem(key, value); } catch { /* storage unavailable */ }
}

function jsonParse(value, fallback) {
  if (!value) return fallback;
  try {
    const parsed = JSON.parse(value);
    return parsed == null ? fallback : parsed;
  } catch {
    return fallback;
  }
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function normalizeUsername(value) {
  return String(value || '').trim().toLowerCase();
}

function usernameValid(value) {
  return /^[a-zA-Z0-9_-]{3,30}$/.test(String(value || ''));
}

function accountEmail() {
  let value = String(document.getElementById('tingxieEmailInput')?.value || '').trim().toLowerCase();
  if (!value) throw new Error('Enter a User ID or email.');
  if (value.includes('@')) return value;
  if (!/^[a-zA-Z0-9._-]{3,40}$/.test(value)) {
    throw new Error('User ID must be 3–40 letters, numbers, dots, underscores, or hyphens.');
  }
  return `${value}${TINGXIE_INTERNAL_EMAIL_SUFFIX}`;
}

function accountLabel() {
  if (cloudMode === 'guest') return 'Guest · this browser only';
  if (cloudMode === 'username') return cloudUsername || 'Username';
  if (cloudMode === 'auth') {
    const value = String(cloudUser?.email || cloudUser?.displayName || 'Waiting for sign-in');
    return value.endsWith(TINGXIE_INTERNAL_EMAIL_SUFFIX)
      ? value.slice(0, -TINGXIE_INTERNAL_EMAIL_SUFFIX.length)
      : value;
  }
  return 'Guest · this browser only';
}

function remotePath() {
  if (cloudMode === 'username' && usernameValid(cloudUsername)) {
    return ['publicUsers', cloudUsername, 'children', TINGXIE_CLOUD_CHILD_KEY, 'profile', 'memory'];
  }
  if (cloudMode === 'auth' && cloudUser?.uid) {
    return ['users', cloudUser.uid, 'children', TINGXIE_CLOUD_CHILD_KEY, 'profile', 'memory'];
  }
  return null;
}

function remotePathKey() {
  return remotePath()?.join('/') || '';
}

function localCloudData() {
  return {
    version: 1,
    memory: jsonParse(localGet(TINGXIE_MEMORY_STORAGE_KEY), null),
    checklist: jsonParse(localGet(TINGXIE_CHECKLIST_STORAGE_KEY), {}) || {}
  };
}

function signature(data = localCloudData()) {
  return JSON.stringify({ memory: data?.memory || null, checklist: data?.checklist || {} });
}

function status(message, error = false) {
  const element = document.getElementById('tingxieCloudStatus');
  if (!element) return;
  element.textContent = message;
  element.classList.toggle('cloud-error', error);
}

function setBusy(value) {
  cloudBusy = value;
  [
    'tingxieGuestMode', 'tingxieUsernameMode', 'tingxieGoogleSignIn',
    'tingxieEmailSignIn', 'tingxieEmailCreate', 'tingxieSignOut',
    'tingxieCopyLocalToCloud', 'tingxieRefreshCloud'
  ].forEach(id => {
    const element = document.getElementById(id);
    if (element) element.disabled = value;
  });
  updateUi();
}

function updateUi() {
  const usernameInput = document.getElementById('tingxieUsernameInput');
  if (usernameInput && document.activeElement !== usernameInput) usernameInput.value = cloudUsername;
  document.getElementById('tingxieGuestCard')?.classList.toggle('active', cloudMode === 'guest');
  document.getElementById('tingxieUsernameCard')?.classList.toggle('active', cloudMode === 'username');
  document.getElementById('tingxieAuthCard')?.classList.toggle('active', cloudMode === 'auth');
  const warning = document.getElementById('tingxieUsernameWarning');
  if (warning) warning.hidden = cloudMode !== 'username';
  const signOut = document.getElementById('tingxieSignOut');
  if (signOut) signOut.disabled = cloudBusy || !cloudUser;
  const badge = document.getElementById('tingxieCloudModeBadge');
  if (badge) badge.textContent = accountLabel();
}

function moveHubLinkToHeader() {
  const link = document.getElementById('learningHubLink');
  const header = document.querySelector('.app-header > div');
  if (!link || !header) return;
  link.textContent = '← Learning apps';
  link.setAttribute('aria-label', 'Return to all learning apps');
  header.prepend(link);
  const style = document.createElement('style');
  style.dataset.tingxieTopHubLink = 'true';
  style.textContent = `
    #learningHubLink {
      position: static !important; inset: auto !important; z-index: auto !important;
      display: inline-flex !important; width: auto !important; min-height: 0 !important;
      margin: 0 0 9px !important; padding: 0 !important; border: 0 !important;
      border-radius: 0 !important; background: transparent !important; box-shadow: none !important;
      backdrop-filter: none !important; color: var(--primary-dark) !important;
      font-size: .82rem !important; font-weight: 800 !important; text-decoration: none !important;
      transform: none !important;
    }
    #learningHubLink:hover, #learningHubLink:focus-visible { text-decoration: underline !important; transform: none !important; }
  `;
  document.head.appendChild(style);
  document.documentElement.dataset.tingxieHubLinkPlacement = 'top';
}

function installUi() {
  const memoryBox = document.getElementById('profileMemoryBox');
  if (!memoryBox || document.getElementById('tingxieCloudSyncBox')) return;
  const box = document.createElement('details');
  box.id = 'tingxieCloudSyncBox';
  box.className = 'tingxie-cloud-sync-box';
  box.innerHTML = `
    <summary><span>☁ Sync profiles and lists across devices</span><span id="tingxieCloudModeBadge" class="pill">Guest</span></summary>
    <p class="tingxie-cloud-intro">Use the same Username or Sign-in account as Chinese Flashcards. Guest data remains only in this browser.</p>
    <div class="tingxie-cloud-grid">
      <section id="tingxieGuestCard" class="tingxie-cloud-card"><strong>Guest</strong><button id="tingxieGuestMode" class="small-button" type="button">Use</button></section>
      <section id="tingxieUsernameCard" class="tingxie-cloud-card"><strong>Username</strong><input id="tingxieUsernameInput" class="text-input" maxlength="30" autocomplete="username" placeholder="e.g. family123"><button id="tingxieUsernameMode" class="small-button" type="button">Use</button></section>
      <section id="tingxieAuthCard" class="tingxie-cloud-card tingxie-cloud-auth-card">
        <strong>Sign in</strong>
        <div class="tingxie-auth-fields"><input id="tingxieEmailInput" class="text-input" autocomplete="username" placeholder="User ID or email"><input id="tingxiePasswordInput" class="text-input" type="password" autocomplete="current-password" placeholder="Password"></div>
        <div class="tingxie-auth-actions"><button id="tingxieGoogleSignIn" class="primary-button" type="button">Google</button><button id="tingxieEmailCreate" class="small-button" type="button">Create</button><button id="tingxieEmailSignIn" class="small-button" type="button">Sign in</button><button id="tingxieSignOut" class="small-button" type="button">Sign out</button></div>
      </section>
    </div>
    <p id="tingxieUsernameWarning" class="tingxie-cloud-warning" hidden>Simple Username mode is not private. Anyone who knows the username may access its Ting Xie lists. Use nicknames only, or use Sign in for private storage.</p>
    <div class="tingxie-cloud-actions"><button id="tingxieCopyLocalToCloud" class="secondary-button" type="button">Copy this browser to cloud</button><button id="tingxieRefreshCloud" class="secondary-button" type="button">Reload from cloud</button></div>
    <p id="tingxieCloudStatus" class="help-text" role="status" aria-live="polite">Cloud sync is starting…</p>
  `;
  memoryBox.insertAdjacentElement('afterend', box);

  const style = document.createElement('style');
  style.dataset.tingxieCloudSync = 'true';
  style.textContent = `
    .tingxie-cloud-sync-box { margin: 12px 0 18px; padding: 12px 14px; border: 1px solid rgba(35,118,112,.2); border-radius: 16px; background: rgba(248,253,252,.86); }
    .tingxie-cloud-sync-box > summary { display: flex; align-items: center; justify-content: space-between; gap: 10px; cursor: pointer; font-weight: 850; }
    .tingxie-cloud-intro { margin: 12px 0; color: var(--muted); font-size: .84rem; line-height: 1.45; }
    .tingxie-cloud-grid { display: grid; grid-template-columns: .7fr 1.3fr; gap: 9px; }
    .tingxie-cloud-card { display: grid; gap: 8px; padding: 11px; border: 1px solid var(--border); border-radius: 13px; background: white; }
    .tingxie-cloud-card.active { border-color: var(--primary); box-shadow: 0 0 0 3px rgba(35,118,112,.1); }
    .tingxie-cloud-auth-card { grid-column: 1 / -1; }
    .tingxie-auth-fields { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; }
    .tingxie-auth-actions { display: grid; grid-template-columns: repeat(4,minmax(0,1fr)); gap: 8px; }
    .tingxie-auth-actions button, .tingxie-cloud-actions button { min-height: 42px; }
    .tingxie-cloud-warning { margin: 10px 0 0; padding: 9px; border-radius: 11px; background: #fff7e6; color: #6f4300; font-size: .78rem; line-height: 1.4; }
    .tingxie-cloud-actions { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 11px; }
    #tingxieCloudStatus { margin: 9px 0 0; } #tingxieCloudStatus.cloud-error { color: #9b1c1c; font-weight: 750; }
    @media(max-width:560px){.tingxie-cloud-grid,.tingxie-auth-fields{grid-template-columns:1fr}.tingxie-cloud-auth-card{grid-column:auto}.tingxie-auth-actions{grid-template-columns:1fr 1fr}.tingxie-cloud-sync-box>summary{align-items:flex-start}}
  `;
  document.head.appendChild(style);

  document.getElementById('tingxieGuestMode').onclick = () => switchMode('guest');
  document.getElementById('tingxieUsernameMode').onclick = useUsername;
  document.getElementById('tingxieGoogleSignIn').onclick = signInGoogle;
  document.getElementById('tingxieEmailSignIn').onclick = signInEmail;
  document.getElementById('tingxieEmailCreate').onclick = createEmail;
  document.getElementById('tingxieSignOut').onclick = signOutAccount;
  document.getElementById('tingxieCopyLocalToCloud').onclick = copyLocalToCloud;
  document.getElementById('tingxieRefreshCloud').onclick = () => loadCloud();
  updateUi();
}

async function firebaseAdapter() {
  if (window.__tingxieCloudTestAdapter) return window.__tingxieCloudTestAdapter;
  const [appModule, authModule, firestoreModule] = await Promise.all([
    import('https://www.gstatic.com/firebasejs/10.12.5/firebase-app.js'),
    import('https://www.gstatic.com/firebasejs/10.12.5/firebase-auth.js'),
    import('https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js')
  ]);
  const app = appModule.getApps().length ? appModule.getApps()[0] : appModule.initializeApp(TINGXIE_FIREBASE_CONFIG);
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
    writeDoc: (path, payload) => firestoreModule.setDoc(firestoreModule.doc(db, ...path), { ...payload, updatedAt: firestoreModule.serverTimestamp() }, { merge: true })
  };
}

async function ensureAdapter() {
  if (cloudAdapter) return cloudAdapter;
  cloudAdapter = await firebaseAdapter();
  cloudAdapter.onAuthStateChanged?.(async user => {
    cloudUser = user || null;
    updateUi();
    if (cloudMode === 'auth') {
      if (cloudUser) await loadCloud();
      else { cloudReady = false; status('Sign in to load private cloud profiles and lists.'); }
    }
  });
  return cloudAdapter;
}

function backupLocal() {
  const memory = localGet(TINGXIE_MEMORY_STORAGE_KEY);
  const checklist = localGet(TINGXIE_CHECKLIST_STORAGE_KEY);
  if (memory) localSet('tingxie:preCloudBackup:memory', memory);
  if (checklist) localSet('tingxie:preCloudBackup:checklist', checklist);
  localSet('tingxie:preCloudBackup:time', new Date().toISOString());
}

function applyRemote(remote) {
  if (!remote?.memory) return false;
  const pathKey = remotePathKey();
  if (pathKey && sessionStorage.getItem(TINGXIE_APPLIED_PATH_KEY) === pathKey) {
    sessionStorage.removeItem(TINGXIE_APPLIED_PATH_KEY);
    lastCloudSignature = signature();
    return false;
  }
  const nextSignature = signature({ memory: remote.memory, checklist: remote.checklist || {} });
  if (nextSignature === signature()) {
    lastCloudSignature = nextSignature;
    return false;
  }
  backupLocal();
  cloudApplying = true;
  localSet(TINGXIE_MEMORY_STORAGE_KEY, JSON.stringify(remote.memory));
  localSet(TINGXIE_CHECKLIST_STORAGE_KEY, JSON.stringify(remote.checklist || {}));
  lastCloudSignature = nextSignature;
  if (pathKey) sessionStorage.setItem(TINGXIE_APPLIED_PATH_KEY, pathKey);
  sessionStorage.setItem('tingxie:cloudReloadNotice', accountLabel());
  location.reload();
  return true;
}

async function upload(options = {}) {
  const path = remotePath();
  if (!path) {
    if (!options.silent) status('Choose a Username or sign in before uploading.', true);
    return false;
  }
  const adapter = await ensureAdapter();
  const local = localCloudData();
  await adapter.writeDoc(path, {
    version: 1,
    memory: clone(local.memory),
    checklist: clone(local.checklist),
    clientUpdatedAt: new Date().toISOString(),
    source: 'tingxie-web'
  });
  lastCloudSignature = signature(local);
  if (!options.silent) status(`Cloud saved for ${accountLabel()}.`);
  return true;
}

async function loadCloud() {
  const path = remotePath();
  if (!path) {
    cloudReady = false;
    status(cloudMode === 'auth' ? 'Sign in to load private cloud profiles and lists.' : 'Enter a valid Username to load cloud profiles and lists.', cloudMode === 'username');
    return;
  }
  setBusy(true);
  status('Loading cloud profiles and lists…');
  try {
    const adapter = await ensureAdapter();
    const remote = await adapter.readDoc(path);
    if (remote?.memory) {
      if (applyRemote(remote)) return;
      cloudReady = true;
      lastCloudSignature = signature();
      status(`Cloud is up to date for ${accountLabel()}.`);
    } else {
      await upload({ silent: true });
      cloudReady = true;
      status(`Created cloud storage for ${accountLabel()} using this browser’s profiles and lists.`);
    }
    startWatcher();
  } catch (error) {
    console.error('Ting Xie cloud load failed', error);
    cloudReady = false;
    status(`Cloud sync failed: ${error?.message || error}`, true);
  } finally {
    setBusy(false);
  }
}

function startWatcher() {
  clearInterval(watchTimer);
  let observed = signature();
  watchTimer = setInterval(() => {
    if (!cloudReady || cloudApplying || cloudMode === 'guest') return;
    const current = signature();
    if (current === observed) return;
    observed = current;
    clearTimeout(uploadTimer);
    status('Saving changes to cloud…');
    uploadTimer = setTimeout(async () => {
      try { await upload({ silent: true }); status(`Cloud saved for ${accountLabel()}.`); }
      catch (error) { console.error(error); status(`Cloud save failed: ${error?.message || error}`, true); }
    }, 650);
  }, 450);
}

async function switchMode(mode) {
  cloudMode = mode;
  localSet(TINGXIE_SAVE_MODE_KEY, mode);
  cloudReady = false;
  clearInterval(watchTimer);
  updateUi();
  if (mode === 'guest') { status('Guest mode: profiles and lists stay in this browser. Existing cloud data is not deleted.'); return; }
  await ensureAdapter();
  await loadCloud();
}

async function useUsername() {
  const input = document.getElementById('tingxieUsernameInput');
  const username = normalizeUsername(input?.value || '');
  if (!usernameValid(username)) { status('Username must be 3–30 characters using letters, numbers, underscores, or hyphens.', true); input?.focus(); return; }
  cloudUsername = username;
  localSet(TINGXIE_USERNAME_KEY, username);
  await switchMode('username');
}

async function authAction(action, failureLabel) {
  try {
    setBusy(true);
    const adapter = await ensureAdapter();
    const password = document.getElementById('tingxiePasswordInput')?.value || '';
    const result = action === 'google' ? await adapter.signInGoogle() : action === 'create' ? await adapter.createEmail(accountEmail(), password) : await adapter.signInEmail(accountEmail(), password);
    if (result?.user) cloudUser = result.user;
    await switchMode('auth');
  } catch (error) {
    console.error(error);
    status(`${failureLabel}: ${error?.message || error}`, true);
  } finally { setBusy(false); }
}

const signInGoogle = () => authAction('google', 'Google sign-in failed');
const signInEmail = () => authAction('signin', 'Sign-in failed');
const createEmail = () => authAction('create', 'Account creation failed');

async function signOutAccount() {
  try {
    setBusy(true);
    const adapter = await ensureAdapter();
    await adapter.signOut();
    cloudUser = null;
    await switchMode('guest');
  } catch (error) { console.error(error); status(`Sign out failed: ${error?.message || error}`, true); }
  finally { setBusy(false); }
}

async function copyLocalToCloud() {
  if (!remotePath()) { status('Choose a Username or sign in before copying this browser to cloud.', true); return; }
  if (!window.confirm('Replace the cloud Ting Xie profiles and lists with the data currently in this browser?')) return;
  try { setBusy(true); await upload(); cloudReady = true; startWatcher(); }
  catch (error) { console.error(error); status(`Cloud copy failed: ${error?.message || error}`, true); }
  finally { setBusy(false); }
}

async function initializeCloudSync() {
  moveHubLinkToHeader();
  installUi();
  const notice = sessionStorage.getItem('tingxie:cloudReloadNotice');
  if (notice) { sessionStorage.removeItem('tingxie:cloudReloadNotice'); status(`Loaded cloud profiles and lists for ${notice}.`); }
  else if (cloudMode === 'guest') status('Guest mode: profiles and lists stay in this browser. Open this section to use the same Username or Sign-in as Chinese Flashcards.');
  updateUi();
  if (cloudMode === 'username' && usernameValid(cloudUsername)) { await ensureAdapter(); await loadCloud(); }
  else if (cloudMode === 'auth') { await ensureAdapter(); if (!cloudUser) status('Checking your Chinese Flashcards sign-in…'); }
  document.documentElement.dataset.tingxieCloudSync = 'true';
}

initializeCloudSync().catch(error => {
  console.error('Ting Xie cloud sync initialization failed', error);
  status(`Cloud sync could not start: ${error?.message || error}`, true);
  document.documentElement.dataset.tingxieCloudSync = 'error';
});

window.__tingxieCloudSync = {
  version: TINGXIE_CLOUD_SYNC_VERSION,
  mode: () => cloudMode,
  username: () => cloudUsername,
  path: () => remotePath()?.slice() || null,
  localData: () => clone(localCloudData()),
  load: loadCloud,
  upload,
  switchMode
};
