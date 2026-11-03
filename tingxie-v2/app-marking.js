function renderMarkingRows() {
  const container = $('markingRows');
  container.replaceChildren();

  state.markRows.forEach((row, index) => {
    const rowElement = document.createElement('div');
    rowElement.className = `mark-row ${row.status}`;

    const number = document.createElement('div');
    number.className = 'row-number';
    number.textContent = String(index + 1);

    const expectedCell = document.createElement('div');
    expectedCell.className = 'answer-cell';
    const expectedLabel = document.createElement('small');
    expectedLabel.textContent = 'Expected';
    const expectedWord = document.createElement('strong');
    expectedWord.textContent = row.expected;
    expectedCell.append(expectedLabel, expectedWord);

    const actualCell = document.createElement('div');
    actualCell.className = 'answer-cell';
    const actualLabel = document.createElement('small');
    actualLabel.textContent = 'Detected / written';
    const actualInput = document.createElement('input');
    actualInput.className = 'answer-edit';
    actualInput.value = row.actual;
    actualInput.placeholder = 'Blank';
    actualInput.setAttribute('aria-label', `Detected answer for item ${index + 1}`);
    actualCell.append(actualLabel, actualInput);

    const statusSelect = document.createElement('select');
    statusSelect.className = 'status-select';
    statusSelect.setAttribute('aria-label', `Marking status for item ${index + 1}`);
    ['correct', 'wrong', 'missing', 'review'].forEach(status => {
      const option = new Option(statusLabel(status), status);
      statusSelect.add(option);
    });
    statusSelect.value = row.status;

    actualInput.addEventListener('input', () => {
      row.actual = actualInput.value.trim();
      const exact = normalizeChinese(row.actual) === normalizeChinese(row.expected);
      row.status = exact ? 'correct' : row.actual ? 'review' : 'missing';
      row.confidence = similarity(row.expected, row.actual);
      statusSelect.value = row.status;
      applyRowClass(rowElement, row.status);
      updateScore();
    });

    statusSelect.addEventListener('change', () => {
      row.status = statusSelect.value;
      applyRowClass(rowElement, row.status);
      updateScore();
    });

    rowElement.append(number, expectedCell, actualCell, statusSelect);
    container.append(rowElement);
  });

  $('markingTableWrap').classList.remove('hidden');
  updateScore();
}

function compareAnswers() {
  const expected = state.sessionWords.length ? state.sessionWords : state.words;
  if (!expected.length) {
    showToast('No spelling list is loaded.');
    return;
  }
  const actual = extractItems($('answerText').value);
  const aligned = alignAnswers(expected, actual);
  state.markRows = aligned.rows;
  state.extraAnswers = aligned.extras;
  renderMarkingRows();
}

function formatDate(isoValue) {
  const date = new Date(isoValue);
  return new Intl.DateTimeFormat(undefined, {
    day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit'
  }).format(date);
}

function saveHistory(entry) {
  const history = safeJsonParse(localStorage.getItem(STORAGE_KEYS.history), []);
  history.unshift(entry);
  localStorage.setItem(STORAGE_KEYS.history, JSON.stringify(history.slice(0, 20)));
}

function renderHistory() {
  const container = $('historyList');
  const history = safeJsonParse(localStorage.getItem(STORAGE_KEYS.history), []);
  container.replaceChildren();

  if (!history.length) {
    const empty = document.createElement('p');
    empty.textContent = 'No saved practice sessions yet.';
    container.append(empty);
    return;
  }

  history.forEach(item => {
    const row = document.createElement('div');
    row.className = 'history-item';
    const left = document.createElement('div');
    const title = document.createElement('p');
    title.textContent = `${item.profile || 'Learner'} · ${item.mode === 'mistakes' ? 'Retest' : 'Full list'}`;
    const time = document.createElement('small');
    time.textContent = formatDate(item.date);
    left.append(title, time);
    const score = document.createElement('strong');
    score.textContent = `${item.correct}/${item.total}`;
    row.append(left, score);
    container.append(row);
  });
}

function renderReview() {
  const container = $('mistakeCards');
  container.replaceChildren();
  $('mistakeCount').textContent = `${state.mistakes.length} item${state.mistakes.length === 1 ? '' : 's'}`;
  $('perfectCard').classList.toggle('hidden', state.mistakes.length !== 0);
  $('retestButton').disabled = state.mistakes.length === 0;

  state.mistakes.forEach((mistake, index) => {
    const card = document.createElement('article');
    card.className = 'mistake-card';

    const label = document.createElement('span');
    label.className = 'pill';
    label.textContent = mistake.status === 'review' ? 'Check / learn' : statusLabel(mistake.status);

    const word = document.createElement('div');
    word.className = 'word';
    word.textContent = mistake.expected;

    const written = document.createElement('div');
    written.className = 'written';
    if (mistake.actual) {
      written.textContent = `Written / detected: ${mistake.actual}`;
    } else {
      const muted = document.createElement('span');
      muted.textContent = 'No answer detected';
      written.append(muted);
    }

    const speak = document.createElement('button');
    speak.className = 'primary-button';
    speak.type = 'button';
    speak.textContent = '🔊 Hear this word';
    speak.addEventListener('click', () => speakText(mistake.expected, { repeat: 1, review: true }));

    card.append(label, word, written, speak);
    container.append(card);
  });

  renderHistory();
}

function saveMarkingAndReview() {
  if (!state.markRows.length) {
    showToast('Compare the answers before saving.');
    return;
  }

  state.mistakes = state.markRows.filter(row => row.status !== 'correct').map(row => ({ ...row }));
  const correct = state.markRows.filter(row => row.status === 'correct').length;
  const profile = $('profileName').value.trim();
  saveHistory({
    date: new Date().toISOString(),
    profile,
    mode: state.sessionMode,
    correct,
    total: state.markRows.length,
    mistakes: state.mistakes.map(item => item.expected)
  });
  setPanel('review');
  renderReview();
}

function loadLastList() {
  const saved = safeJsonParse(localStorage.getItem(STORAGE_KEYS.lastList), null);
  if (!saved || !Array.isArray(saved.words) || !saved.words.length) {
    showToast('No previous spelling list is saved yet.');
    return;
  }
  $('wordList').value = saved.words.join('\n');
  if (saved.profile) $('profileName').value = saved.profile;
  updateWordCount();
  showToast('Last list loaded.');
}

function saveCurrentList(words) {
  const profile = $('profileName').value.trim();
  localStorage.setItem(STORAGE_KEYS.lastList, JSON.stringify({ words, profile, savedAt: new Date().toISOString() }));
  localStorage.setItem(STORAGE_KEYS.profile, profile);
}

function resetForNewList() {
  stopRecognition();
  window.speechSynthesis?.cancel();
  state.words = [];
  state.sessionWords = [];
  state.markRows = [];
  state.mistakes = [];
  state.sourceFile = null;
  state.answerFile = null;
  $('sourceImage').value = '';
  $('answerImage').value = '';
  $('sourcePreview').classList.add('hidden');
  $('answerPreview').classList.add('hidden');
  $('wordList').value = '';
  $('answerText').value = '';
  $('sourceProgress').classList.add('hidden');
  $('answerProgress').classList.add('hidden');
  updateWordCount();
  setPanel('setup');
}
