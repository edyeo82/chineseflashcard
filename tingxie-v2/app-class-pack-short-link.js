'use strict';

const TINGXIE_SHORT_CLASS_LINK_VERSION = '20260810-3';
const SHORT_PACK_QUERY_KEY = 'pack';
const SHORT_PACK_PUBLIC_USER = 'tingxiepacks';
const SHORT_PACK_ID_LENGTH = 12;
const SHORT_PACK_ALPHABET = '23456789abcdefghjkmnpqrstuvwxyz';
const shortLinkTestMode = new URLSearchParams(location.search).get('test');
const shortLinksEnabled = !shortLinkTestMode || Boolean(window.__tingxieClassPackStoreTestAdapter);

const SHORT_PACK_FIREBASE_CONFIG = {
  apiKey: 'AIzaSyAhQzUiDlZazIKi3180eT2BTXdaD5h81sI',
  authDomain: 'chinese-flashcards-63883.firebaseapp.com',
  projectId: 'chinese-flashcards-63883',
  storageBucket: 'chinese-flashcards-63883.firebasestorage.app',
  messagingSenderId: '869052621203',
  appId: '1:869052621203:web:f79f36422ffcf5b9d54866',
  measurementId: 'G-07RY3MSQ5P'
};

const legacyLongClassPackUrlBuilder = buildClassPackShareUrl;
let shortPackAdapter = null;

function shortPackPath(id) {
  return ['publicUsers', SHORT_PACK_PUBLIC_USER, 'children', id, 'profile', 'memory'];
}

function validShortPackId(value) {
  return new RegExp(`^[${SHORT_PACK_ALPHABET}]{${SHORT_PACK_ID_LENGTH}}$`).test(String(value || ''));
}

function makeShortPackId() {
  const bytes = new Uint8Array(SHORT_PACK_ID_LENGTH);
  if (window.crypto?.getRandomValues) window.crypto.getRandomValues(bytes);
  else for (let index = 0; index < bytes.length; index += 1) bytes[index] = Math.floor(Math.random() * 256);
  return [...bytes].map(value => SHORT_PACK_ALPHABET[value % SHORT_PACK_ALPHABET.length]).join('');
}

async function firebaseShortPackAdapter() {
  if (window.__tingxieClassPackStoreTestAdapter) return window.__tingxieClassPackStoreTestAdapter;
  const [appModule, firestoreModule] = await Promise.all([
    import('https://www.gstatic.com/firebasejs/10.12.5/firebase-app.js'),
    import('https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js')
  ]);
  const app = appModule.getApps().length ? appModule.getApps()[0] : appModule.initializeApp(SHORT_PACK_FIREBASE_CONFIG);
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

async function getShortPackAdapter() {
  if (!shortPackAdapter) shortPackAdapter = await firebaseShortPackAdapter();
  return shortPackAdapter;
}

function shortClassPackUrl(id) {
  const url = new URL(location.pathname, location.origin);
  url.searchParams.set(SHORT_PACK_QUERY_KEY, id);
  return url.toString();
}

async function storeClassPackAndBuildShortUrl(pack) {
  if (!shortLinksEnabled) return legacyLongClassPackUrlBuilder(pack);
  try {
    const id = makeShortPackId();
    const adapter = await getShortPackAdapter();
    await adapter.writeDoc(shortPackPath(id), {
      version: 1,
      kind: 'tingxie-class-pack',
      pack: JSON.parse(JSON.stringify(pack)),
      clientCreatedAt: new Date().toISOString()
    });
    return shortClassPackUrl(id);
  } catch (error) {
    console.error('Could not create Firebase class-pack short link', error);
    if (typeof showToast === 'function') showToast('Could not create a short link. Using a full link instead.');
    return legacyLongClassPackUrlBuilder(pack);
  }
}

// Friendly sharing is loaded later and calls this global function, so replacing
// the builder here automatically upgrades the normal Share class pack button.
buildClassPackShareUrl = storeClassPackAndBuildShortUrl;

// A short-link class pack uses a query parameter instead of the old hash. Make
// Back to my lists remove both formats so it cannot reopen the same pack.
exitClassPack = function exitAnyClassPack() {
  const url = new URL(location.href);
  url.hash = '';
  url.searchParams.delete(SHORT_PACK_QUERY_KEY);
  location.href = url.toString();
};

async function activateShortClassPackFromQuery() {
  if (!shortLinksEnabled || isClassPackActive()) return false;
  const id = new URLSearchParams(location.search).get(SHORT_PACK_QUERY_KEY);
  if (!id) return false;
  if (!validShortPackId(id)) {
    showToast('This class pack link is invalid.');
    return false;
  }

  try {
    showToast('Loading shared class pack…');
    const adapter = await getShortPackAdapter();
    const remote = await adapter.readDoc(shortPackPath(id));
    const decoded = normalizeClassPack(remote?.pack);
    if (!decoded) throw new Error('The shared pack was not found or is empty.');
    classPack = decoded;
    classPackListId = decoded.lists[0].id;
    installClassPackModeUi();
    renderClassPackList();
    showToast(`Opened “${decoded.title}” · ${decoded.lists.length} lists.`);
    return true;
  } catch (error) {
    console.error('Could not open Firebase class-pack short link', error);
    showToast(`Class pack could not be opened: ${error?.message || String(error)}`);
    return false;
  }
}

const shortClassPackReady = activateShortClassPackFromQuery();

document.documentElement.dataset.tingxieShortClassLinks = shortLinksEnabled ? 'true' : 'legacy-test';

window.__tingxieClassPackShortLink = {
  version: TINGXIE_SHORT_CLASS_LINK_VERSION,
  ready: shortClassPackReady,
  enabled: shortLinksEnabled,
  path: id => shortPackPath(id).slice(),
  build: storeClassPackAndBuildShortUrl,
  legacyBuild: legacyLongClassPackUrlBuilder
};
