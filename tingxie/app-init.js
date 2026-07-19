function bindEvents() {
  $('sourceImage').addEventListener('change', event => {
    state.sourceFile = event.target.files?.[0] || null;
    setImagePreview(state.sourceFile, $('sourcePreview'));
    $('scanSourceButton').disabled = !state.sourceFile;
    $('sourceProgress').classList.add('hidden');
  });

  $('answerImage').addEventListener('change', event => {
    state.answerFile = event.target.files?.[0] || null;
    setImagePreview(state.answerFile, $('answerPreview'));
    $('scanAnswerButton').disabled = !state.answerFile;
    $('answerProgress').classList.add('hidden');
  });

  $('scanSourceButton').addEventListener('click', async () => {
    const button = $('scanSourceButton');
    button.disabled = true;
    button.textContent = 'Reading photo…';
    try {
      const text = await runOcr(state.sourceFile, 'source');
      const items = uniqueItems(extractItems(text));
      if (!items.length) throw new Error('No Chinese words were found. Try a clearer photo or type the list manually.');
      $('wordList').value = items.join('\n');
      updateWordCount();
      showToast(`Found ${items.length} possible item${items.length === 1 ? '' : 's'}. Please check them.`);
    } catch (error) {
      showToast(error.message || 'The photo could not be read.');
      $('sourceProgressText').textContent = error.message || 'OCR failed.';
    } finally {
      button.disabled = !state.sourceFile;
      button.textContent = 'Read words from photo';
    }
  });

  $('scanAnswerButton').addEventListener('click', async () => {
    const button = $('scanAnswerButton');
    button.disabled = true;
    button.textContent = 'Reading handwriting…';
    try {
      const text = await runOcr(state.answerFile, 'answer');
      const items = extractItems(text);
      $('answerText').value = items.join('\n');
      compareAnswers();
      showToast('First-pass marking is ready. Confirm uncertain rows.');
    } catch (error) {
      showToast(error.message || 'The handwriting could not be read.');
      $('answerProgressText').textContent = error.message || 'OCR failed.';
    } finally {
      button.disabled = !state.answerFile;
      button.textContent = 'Read handwritten answers';
    }
  });

  $('wordList').addEventListener('input', updateWordCount);
  $('loadLastButton').addEventListener('click', loadLastList);

  $('startDictationButton').addEventListener('click', () => {
    const words = extractItems($('wordList').value);
    if (!words.length) return;
    saveCurrentList(words);
    beginDictation(words, 'full');
  });

  $('speakButton').addEventListener('click', speakCurrentItem);
  $('nextButton').addEventListener('click', nextItem);
  $('previousButton').addEventListener('click', previousItem);
  $('voiceNextButton').addEventListener('click', () => toggleVoiceNext());
  $('exitDictationButton').addEventListener('click', () => {
    stopRecognition();
    window.speechSynthesis?.cancel();
    state.voiceEnabled = false;
    setPanel('setup');
  });

  $('skipOcrButton').addEventListener('click', () => {
    $('answerText').focus();
    showToast('Enter one written answer per line, then tap Compare again.');
  });
  $('compareButton').addEventListener('click', compareAnswers);
  $('saveMarkingButton').addEventListener('click', saveMarkingAndReview);

  $('retestButton').addEventListener('click', () => {
    const words = uniqueItems(state.mistakes.map(item => item.expected));
    if (words.length) beginDictation(words, 'mistakes');
  });
  $('newListButton').addEventListener('click', resetForNewList);

  ['voiceSelect', 'rateSelect', 'repeatSelect', 'commandLanguage'].forEach(id => {
    $(id).addEventListener('change', () => {
      saveSettings();
      if (id === 'commandLanguage' && state.voiceEnabled) {
        stopRecognition();
        setTimeout(startListening, 250);
      }
    });
  });

  document.querySelectorAll('.step').forEach(step => {
    step.addEventListener('click', () => {
      const target = step.dataset.step;
      if (target === 'setup') {
        stopRecognition();
        window.speechSynthesis?.cancel();
        setPanel('setup');
      } else if (target === 'dictation' && state.sessionWords.length) {
        setPanel('dictation');
        renderDictation();
      } else if (target === 'marking' && state.sessionWords.length) {
        stopRecognition();
        setPanel('marking');
      } else if (target === 'review' && (state.markRows.length || state.mistakes.length)) {
        setPanel('review');
        renderReview();
      } else {
        showToast('Complete the earlier step first.');
      }
    });
  });

  window.addEventListener('beforeinstallprompt', event => {
    event.preventDefault();
    state.deferredInstallPrompt = event;
    $('installButton').classList.remove('hidden');
  });

  $('installButton').addEventListener('click', async () => {
    if (!state.deferredInstallPrompt) return;
    state.deferredInstallPrompt.prompt();
    await state.deferredInstallPrompt.userChoice;
    state.deferredInstallPrompt = null;
    $('installButton').classList.add('hidden');
  });

  document.addEventListener('visibilitychange', () => {
    if (document.hidden) {
      stopRecognition();
      window.speechSynthesis?.cancel();
      state.isSpeaking = false;
    }
  });
}

function init() {
  loadSettings();
  bindEvents();
  updateWordCount();
  renderHistory();

  if (speechSupported()) {
    populateVoices();
    window.speechSynthesis.onvoiceschanged = populateVoices;
  } else {
    $('voiceSelect').replaceChildren(new Option('Speech unavailable', ''));
    $('startDictationButton').title = 'This browser does not support speech synthesis.';
  }

  if (!recognitionSupported()) {
    $('voiceNextButton').textContent = 'Voice “next” unavailable — use buttons';
    $('voiceNextButton').disabled = true;
  }

  if ('serviceWorker' in navigator && location.protocol.startsWith('http')) {
    navigator.serviceWorker.register('./sw.js').catch(() => { /* app still works without offline cache */ });
  }
}

init();
