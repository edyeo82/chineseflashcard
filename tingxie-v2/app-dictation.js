function speakText(text, options = {}) {
  if (!speechSupported()) {
    showToast('Speech is not supported in this browser.');
    return;
  }

  stopRecognition();
  window.speechSynthesis.cancel();
  state.isSpeaking = true;
  setVoiceStatus('speaking', options.review ? 'Playing pronunciation…' : 'Speaking the current word…');

  const repeatTotal = options.repeat || 1;
  let count = 0;

  const speakOnce = () => {
    const utterance = new SpeechSynthesisUtterance(text);
    const selectedVoice = state.voices[Number($('voiceSelect').value)] || null;
    if (selectedVoice) {
      utterance.voice = selectedVoice;
      utterance.lang = selectedVoice.lang;
    } else {
      utterance.lang = 'zh-CN';
    }
    utterance.rate = Number($('rateSelect').value) || 0.82;
    utterance.pitch = 1;
    utterance.volume = 1;

    utterance.onend = () => {
      count += 1;
      if (count < repeatTotal) {
        setTimeout(speakOnce, 420);
      } else {
        state.isSpeaking = false;
        if (!options.review) {
          if (state.voiceEnabled) startListening();
          else setVoiceStatus('', 'Word spoken. Tap Next or enable voice “next.”');
        }
      }
    };

    utterance.onerror = () => {
      state.isSpeaking = false;
      setVoiceStatus('error', 'The word could not be spoken. Try another Mandarin voice.');
    };

    window.speechSynthesis.speak(utterance);
  };

  speakOnce();
}

function speakCurrentItem() {
  const word = state.sessionWords[state.currentIndex];
  if (!word) return;
  const repeat = Number($('repeatSelect').value) || 1;
  speakText(word, { repeat });
}

function renderDictation() {
  const total = state.sessionWords.length;
  const position = Math.min(state.currentIndex + 1, total || 1);
  $('sessionLabel').textContent = state.sessionMode === 'mistakes' ? 'Mistakes retest' : 'Full list';
  $('dictationProgressText').textContent = `${position} of ${total}`;
  $('dictationProgressBar').style.width = `${total ? (position / total) * 100 : 0}%`;
  $('itemNumber').textContent = `第 ${position} 题`;
  $('previousButton').disabled = state.currentIndex === 0;
  $('nextButton').textContent = state.currentIndex === total - 1 ? 'Finish →' : 'Next →';
}

function beginDictation(words, mode = 'full') {
  state.words = words.slice();
  state.sessionWords = words.slice();
  state.sessionMode = mode;
  state.currentIndex = 0;
  state.markRows = [];
  state.extraAnswers = [];
  state.voiceEnabled = false;
  $('voiceNextButton').textContent = '🎤 Enable voice “next”';
  $('heardCommand').textContent = '';
  setPanel('dictation');
  renderDictation();
  saveSettings();
  setTimeout(speakCurrentItem, 180);
}

function prepareMarking() {
  stopRecognition();
  state.voiceEnabled = false;
  state.isSpeaking = false;
  window.speechSynthesis?.cancel();
  state.answerFile = null;
  $('answerImage').value = '';
  $('answerPreview').classList.add('hidden');
  $('scanAnswerButton').disabled = true;
  $('answerText').value = '';
  $('answerProgress').classList.add('hidden');
  $('markingTableWrap').classList.add('hidden');
  $('markSummary').classList.add('hidden');
  setPanel('marking');
  showToast('听写 complete. Take a photo of the written answers.');
}

function nextItem() {
  stopRecognition();
  if (state.currentIndex >= state.sessionWords.length - 1) {
    prepareMarking();
    return;
  }
  state.currentIndex += 1;
  $('heardCommand').textContent = '';
  renderDictation();
  setTimeout(speakCurrentItem, 160);
}

function previousItem() {
  if (state.currentIndex <= 0) return;
  stopRecognition();
  state.currentIndex -= 1;
  $('heardCommand').textContent = '';
  renderDictation();
  setTimeout(speakCurrentItem, 160);
}

function toggleVoiceNext(forceValue) {
  const nextValue = typeof forceValue === 'boolean' ? forceValue : !state.voiceEnabled;
  state.voiceEnabled = nextValue;
  $('voiceNextButton').textContent = nextValue ? '⏸ Stop voice “next”' : '🎤 Enable voice “next”';

  if (nextValue) {
    if (!recognitionSupported()) {
      state.voiceEnabled = false;
      $('voiceNextButton').textContent = '🎤 Enable voice “next”';
      setVoiceStatus('error', 'Voice commands are unavailable in this browser. Use the Next button.');
      return;
    }
    startListening();
  } else {
    stopRecognition();
    setVoiceStatus('', 'Voice “next” is paused. Use the buttons or enable it again.');
  }
}

function levenshtein(a, b) {
  const source = Array.from(a);
  const target = Array.from(b);
  const previous = Array(target.length + 1).fill(0).map((_, index) => index);

  for (let i = 1; i <= source.length; i += 1) {
    const current = [i];
    for (let j = 1; j <= target.length; j += 1) {
      const substitution = previous[j - 1] + (source[i - 1] === target[j - 1] ? 0 : 1);
      current[j] = Math.min(previous[j] + 1, current[j - 1] + 1, substitution);
    }
    for (let j = 0; j < current.length; j += 1) previous[j] = current[j];
  }
  return previous[target.length];
}

function similarity(a, b) {
  const left = normalizeChinese(a);
  const right = normalizeChinese(b);
  if (!left && !right) return 1;
  const maxLength = Math.max(Array.from(left).length, Array.from(right).length, 1);
  return 1 - levenshtein(left, right) / maxLength;
}

function pairCost(expected, actual) {
  const score = similarity(expected, actual);
  if (score === 1) return 0;
  if (score >= 0.75) return 0.42;
  if (score >= 0.5) return 0.82;
  return 1.12;
}

function alignAnswers(expectedItems, actualItems) {
  const n = expectedItems.length;
  const m = actualItems.length;
  const dp = Array.from({ length: n + 1 }, () => Array(m + 1).fill(null));
  dp[0][0] = { cost: 0, op: null };

  for (let i = 1; i <= n; i += 1) dp[i][0] = { cost: i * 0.96, op: 'missing' };
  for (let j = 1; j <= m; j += 1) dp[0][j] = { cost: j * 0.82, op: 'extra' };

  for (let i = 1; i <= n; i += 1) {
    for (let j = 1; j <= m; j += 1) {
      const choices = [
        { cost: dp[i - 1][j - 1].cost + pairCost(expectedItems[i - 1], actualItems[j - 1]), op: 'pair' },
        { cost: dp[i - 1][j].cost + 0.96, op: 'missing' },
        { cost: dp[i][j - 1].cost + 0.82, op: 'extra' }
      ];
      dp[i][j] = choices.reduce((best, choice) => choice.cost < best.cost ? choice : best);
    }
  }

  const rows = [];
  const extras = [];
  let i = n;
  let j = m;

  while (i > 0 || j > 0) {
    const cell = dp[i][j];
    if (cell.op === 'pair') {
      const expected = expectedItems[i - 1];
      const actual = actualItems[j - 1];
      const score = similarity(expected, actual);
      let status = 'wrong';
      if (score === 1) status = 'correct';
      else if (score >= 0.5) status = 'review';
      rows.unshift({ expected, actual, status, confidence: score });
      i -= 1;
      j -= 1;
    } else if (cell.op === 'missing') {
      rows.unshift({ expected: expectedItems[i - 1], actual: '', status: 'missing', confidence: 0 });
      i -= 1;
    } else {
      extras.unshift(actualItems[j - 1]);
      j -= 1;
    }
  }

  return { rows, extras };
}

function statusLabel(status) {
  return {
    correct: 'Correct',
    wrong: 'Wrong',
    missing: 'Missing',
    review: 'Check OCR'
  }[status] || status;
}

function updateScore() {
  const total = state.markRows.length;
  const correct = state.markRows.filter(row => row.status === 'correct').length;
  const review = state.markRows.filter(row => row.status === 'review').length;
  $('scoreBadge').textContent = `${correct} / ${total}`;
  $('markSummary').textContent = review
    ? `${review} row${review === 1 ? '' : 's'} need confirmation. Unconfirmed rows will be added to the learning list.`
    : state.extraAnswers.length
      ? `${state.extraAnswers.length} extra detected answer${state.extraAnswers.length === 1 ? '' : 's'}: ${state.extraAnswers.join('、')}`
      : 'All rows have a marking status.';
  $('markSummary').classList.remove('hidden');
}

function applyRowClass(rowElement, status) {
  rowElement.classList.remove('correct', 'wrong', 'missing', 'review');
  rowElement.classList.add(status);
}
