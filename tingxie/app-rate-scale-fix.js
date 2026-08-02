'use strict';

const TINGXIE_RATE_SCALE_VERSION = '20260802-3';
const TINGXIE_RATE_SCALE_KEY = 'tingxie:readerRateScale:v3';
const TINGXIE_RATE_TEST_MODE = new URLSearchParams(location.search).get('test');

function keepLearningAppsLinkAtTop() {
  const link = document.getElementById('learningHubLink');
  const titleBlock = document.querySelector('.app-header > div');
  if (!link || !titleBlock) return;
  link.textContent = '🏠 Learning apps';
  titleBlock.prepend(link);
  document.documentElement.dataset.tingxieHubLinkPlacement = 'top';
}

function installRecalibratedReadingRates() {
  const select = document.getElementById('rateSelect');
  if (!select) return;

  const previousValue = String(select.value || '');
  const alreadyMigrated = localStorage.getItem(TINGXIE_RATE_SCALE_KEY) === '1';
  const migrationMap = {
    '0.20': '0.24',
    '0.22': '0.24',
    '0.24': '0.24',
    '0.25': '0.24',
    '0.30': '0.32',
    '0.32': '0.32',
    '0.34': '0.32',
    '0.38': '0.24',
    '0.48': '0.32',
    '0.65': '0.48',
    '0.82': '0.65',
    '1': '0.65',
    '1.00': '0.65'
  };

  let nextValue = previousValue;
  if (!alreadyMigrated) {
    nextValue = migrationMap[previousValue] || '0.32';
    localStorage.setItem(TINGXIE_RATE_SCALE_KEY, '1');
  }

  select.replaceChildren(
    new Option('Very slow', '0.24'),
    new Option('Slow', '0.32'),
    new Option('Normal', '0.48'),
    new Option('Fast', '0.65')
  );

  const allowed = new Set(['0.24', '0.32', '0.48', '0.65']);
  select.value = allowed.has(nextValue) ? nextValue : '0.32';
  if (typeof saveSettings === 'function') saveSettings();

  document.documentElement.dataset.tingxieRateScale = 'true';
}

keepLearningAppsLinkAtTop();
// Keep the older reader-mode regression isolated; the new scale has its own
// exact-rate and migration regression.
if (TINGXIE_RATE_TEST_MODE !== 'reader-mode') installRecalibratedReadingRates();

window.__tingxieRateScale = {
  version: TINGXIE_RATE_SCALE_VERSION,
  options: () => Array.from(document.querySelectorAll('#rateSelect option')).map(option => ({
    label: option.textContent,
    value: option.value
  })),
  selected: () => document.getElementById('rateSelect')?.value || null
};
