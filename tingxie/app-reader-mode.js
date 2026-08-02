'use strict';

const TINGXIE_READER_MODE_VERSION = '20260802-1';
const TINGXIE_RATE_MIGRATION_KEY = 'tingxie:readerRateScale:v2';
const TINGXIE_LEGACY_TEST_MODE = new URLSearchParams(location.search).get('test') === 'deterministic';

if (!TINGXIE_LEGACY_TEST_MODE) {
  const legacyBeginDictation = beginDictation;
  const legacyNextItem = nextItem;
  const legacyRenderDictation = renderDictation;

  function migrateAndInstallSlowerRates() {
    const select = $('rateSelect');
    if (!select) return;

    const oldValue = String(select.value || '');
    const migrated = localStorage.getItem(TINGXIE_RATE_MIGRATION_KEY) === '1';
    let nextValue = oldValue;

    if (!migrated) {
      const legacyMap = {
        '0.65': '0.48',
        '0.82': '0.65',
        '1': '0.82',
        '1.00': '0.82'
      };
      nextValue = legacyMap[oldValue] || '0.48';
      localStorage.setItem(TINGXIE_RATE_MIGRATION_KEY, '1');
    }

    select.replaceChildren(
      new Option('Very slow', '0.38'),
      new Option('Slow', '0.48'),
      new Option('Normal', '0.65'),
      new Option('Fast', '0.82')
    );

    const allowed = new Set(['0.38', '0.48', '0.65', '0.82']);
    select.value = allowed.has(nextValue) ? nextValue : '0.48';
    saveSettings();
  }

  function stopReaderAudio() {
    stopRecognition();
    state.voiceEnabled = false;
    state.recognitionActive = false;
    state.isSpeaking = false;
    window.speechSynthesis?.cancel();
    $('voiceNextButton').textContent = '🎤 Enable voice “next”';
  }

  function installReaderUi() {
    const subtitle = document.querySelector('.app-header .subtitle');
    if (subtitle) subtitle.textContent = 'Prepare → Listen → Repeat';

    const setupTitle = $('setupTitle');
    if (setupTitle) setupTitle.textContent = 'Prepare the reading list';

    const startButton = $('startDictationButton');
    if (startButton) startButton.textContent = 'Start reading aloud';

    const dictationTitle = $('dictationTitle');
    if (dictationTitle) dictationTitle.textContent = 'Listen to the list';

    const hiddenWordHint = document.querySelector('.hidden-word p');
    if (hiddenWordHint) hiddenWordHint.textContent = 'Listen, write it down, then move to the next item.';

    const setupStep = document.querySelector('.step[data-step="setup"]');
    const readingStep = document.querySelector('.step[data-step="dictation"]');
    const markingStep = document.querySelector('.step[data-step="marking"]');
    const reviewStep = document.querySelector('.step[data-step="review"]');
    if (setupStep) setupStep.innerHTML = '<span>1</span>Prepare';
    if (readingStep) readingStep.innerHTML = '<span>2</span>Listen';
    [markingStep, reviewStep].forEach(step => {
      if (!step) return;
      step.hidden = true;
      step.setAttribute('aria-hidden', 'true');
      step.tabIndex = -1;
    });

    ['markingPanel', 'reviewPanel'].forEach(id => {
      const panel = $(id);
      if (!panel) return;
      panel.hidden = true;
      panel.setAttribute('aria-hidden', 'true');
    });

    const controlGrid = document.querySelector('#dictationPanel .control-grid');
    if (controlGrid && !$('readerExtraControls')) {
      const extra = document.createElement('div');
      extra.id = 'readerExtraControls';
      extra.className = 'reader-extra-controls';
      extra.innerHTML = `
        <button id="shuffleReaderButton" class="secondary-button" type="button">🔀 Shuffle</button>
        <button id="restartReaderButton" class="secondary-button" type="button">↺ Back to start</button>
      `;
      controlGrid.insertAdjacentElement('afterend', extra);
      $('shuffleReaderButton').addEventListener('click', shuffleReadingOrder);
      $('restartReaderButton').addEventListener('click', restartReadingFromBeginning);
    }

    if (!document.querySelector('style[data-tingxie-reader-mode]')) {
      const style = document.createElement('style');
      style.dataset.tingxieReaderMode = 'true';
      style.textContent = `
        .step[hidden], .panel[hidden] { display: none !important; }
        .stepper:has(.step[hidden]) { grid-template-columns: repeat(2, minmax(0, 1fr)); }
        .reader-extra-controls {
          display: grid;
          grid-template-columns: repeat(2, minmax(0, 1fr));
          gap: 10px;
          margin-top: 10px;
        }
        .reader-extra-controls button { min-height: 48px; }
        @media (max-width: 520px) {
          .reader-extra-controls { grid-template-columns: 1fr; }
        }
      `;
      document.head.appendChild(style);
    }

    document.documentElement.dataset.tingxieReaderMode = 'true';
  }

  function fisherYates(items) {
    const shuffled = items.slice();
    for (let index = shuffled.length - 1; index > 0; index -= 1) {
      const swapIndex = Math.floor(Math.random() * (index + 1));
      [shuffled[index], shuffled[swapIndex]] = [shuffled[swapIndex], shuffled[index]];
    }
    return shuffled;
  }

  function shuffleReadingOrder() {
    if (state.sessionWords.length < 2) {
      showToast('Add at least two items before shuffling.');
      return;
    }

    stopReaderAudio();
    const before = state.sessionWords.join('\u0000');
    let shuffled = fisherYates(state.sessionWords);
    if (shuffled.join('\u0000') === before) {
      [shuffled[0], shuffled[1]] = [shuffled[1], shuffled[0]];
    }
    state.sessionWords = shuffled;
    state.currentIndex = 0;
    state.readerShuffled = true;
    $('heardCommand').textContent = '';
    renderDictation();
    showToast('List shuffled. Starting again from item 1.');
    setTimeout(speakCurrentItem, 140);
  }

  function restartReadingFromBeginning() {
    if (!state.sessionWords.length) return;
    stopReaderAudio();
    state.currentIndex = 0;
    $('heardCommand').textContent = '';
    renderDictation();
    showToast('Back to the start of this list.');
    setTimeout(speakCurrentItem, 140);
  }

  function finishReadingList() {
    stopReaderAudio();
    setPanel('setup');
    showToast('Finished reading the list. Start again whenever you are ready.');
  }

  beginDictation = function beginReaderSession(words, mode = 'full') {
    state.readerOriginalWords = words.slice();
    state.readerShuffled = false;
    legacyBeginDictation(words, mode);
  };

  renderDictation = function renderReaderSession() {
    legacyRenderDictation();
    if ($('sessionLabel')) {
      $('sessionLabel').textContent = state.readerShuffled ? 'Shuffled order' : 'Original order';
    }
    if ($('nextButton') && state.currentIndex === state.sessionWords.length - 1) {
      $('nextButton').textContent = 'Finish ✓';
    }
  };

  nextItem = function nextReaderItem() {
    if (state.currentIndex >= state.sessionWords.length - 1) {
      finishReadingList();
      return;
    }
    legacyNextItem();
  };

  migrateAndInstallSlowerRates();
  installReaderUi();

  window.__tingxieReaderMode = {
    version: TINGXIE_READER_MODE_VERSION,
    shuffle: shuffleReadingOrder,
    restart: restartReadingFromBeginning,
    finish: finishReadingList,
    snapshot: () => ({
      words: state.sessionWords.slice(),
      originalWords: Array.isArray(state.readerOriginalWords) ? state.readerOriginalWords.slice() : [],
      currentIndex: state.currentIndex,
      shuffled: Boolean(state.readerShuffled),
      rate: $('rateSelect')?.value || null,
      panel: Object.entries(panels).find(([, panel]) => panel.classList.contains('active'))?.[0] || null
    })
  };
}
