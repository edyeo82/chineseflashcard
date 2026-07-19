'use strict';

// JSON.parse(null) returns null instead of throwing. On a fresh browser that
// made loadSettings() read `rate` from null and stopped initialization before
// the photo and OCR button handlers were attached.
safeJsonParse = function safeJsonParseWithFallback(value, fallback) {
  if (value === null || value === undefined || value === '') return fallback;
  try {
    const parsed = JSON.parse(value);
    return parsed === null || parsed === undefined ? fallback : parsed;
  } catch {
    return fallback;
  }
};

const OCR_SCRIPT_SOURCES = [
  'https://cdn.jsdelivr.net/npm/tesseract.js@5/dist/tesseract.min.js',
  'https://unpkg.com/tesseract.js@5/dist/tesseract.min.js'
];

let ocrWorker = null;
let ocrWorkerPromise = null;

function setOcrMessage(prefix, message, percent = 0) {
  const progressBlock = $(`${prefix}Progress`);
  const progressBar = $(`${prefix}ProgressBar`);
  const progressText = $(`${prefix}ProgressText`);
  progressBlock.classList.remove('hidden');
  progressBar.style.width = `${Math.max(0, Math.min(100, percent))}%`;
  progressText.textContent = message;
}

function loadExternalScript(url, timeoutMs = 15000) {
  return new Promise((resolve, reject) => {
    const existing = Array.from(document.scripts).find(script => script.src === url);
    if (existing && window.Tesseract) {
      resolve();
      return;
    }

    const script = document.createElement('script');
    const timeout = setTimeout(() => {
      script.remove();
      reject(new Error('OCR library download timed out.'));
    }, timeoutMs);

    script.src = url;
    script.async = true;
    script.onload = () => {
      clearTimeout(timeout);
      window.Tesseract ? resolve() : reject(new Error('OCR library loaded incorrectly.'));
    };
    script.onerror = () => {
      clearTimeout(timeout);
      script.remove();
      reject(new Error('OCR library download failed.'));
    };
    document.head.appendChild(script);
  });
}

async function ensureTesseract(prefix) {
  if (window.Tesseract?.createWorker) return window.Tesseract;

  setOcrMessage(prefix, 'Loading OCR engine…', 2);
  let lastError = null;
  for (const source of OCR_SCRIPT_SOURCES) {
    try {
      await loadExternalScript(source);
      if (window.Tesseract?.createWorker) return window.Tesseract;
    } catch (error) {
      lastError = error;
    }
  }

  throw new Error(lastError?.message || 'The OCR engine could not be loaded. Check the internet connection and try again.');
}

function withTimeout(promise, timeoutMs, message) {
  let timeout;
  const timeoutPromise = new Promise((_, reject) => {
    timeout = setTimeout(() => reject(new Error(message)), timeoutMs);
  });
  return Promise.race([promise, timeoutPromise]).finally(() => clearTimeout(timeout));
}

async function getOcrWorker(prefix) {
  if (ocrWorker) return ocrWorker;
  if (ocrWorkerPromise) return ocrWorkerPromise;

  ocrWorkerPromise = (async () => {
    const TesseractApi = await ensureTesseract(prefix);
    setOcrMessage(prefix, 'Starting OCR worker…', 5);

    const worker = await withTimeout(
      TesseractApi.createWorker('chi_sim', 1, {
        workerPath: 'https://cdn.jsdelivr.net/npm/tesseract.js@5/dist/worker.min.js',
        corePath: 'https://cdn.jsdelivr.net/npm/tesseract.js-core@5',
        langPath: 'https://tessdata.projectnaptha.com/4.0.0_fast',
        logger: payload => setOcrProgress(prefix, payload),
        errorHandler: error => console.error('Ting Xie OCR worker error', error)
      }),
      60000,
      'OCR setup took too long. Check the connection and try again.'
    );

    ocrWorker = worker;
    return worker;
  })();

  try {
    return await ocrWorkerPromise;
  } catch (error) {
    ocrWorkerPromise = null;
    ocrWorker = null;
    throw error;
  }
}

runOcr = async function robustRunOcr(file, prefix) {
  if (!file) throw new Error('Choose or take a photo first.');

  setOcrMessage(prefix, 'Preparing photo for OCR…', 1);
  const worker = await getOcrWorker(prefix);
  setOcrMessage(prefix, 'Reading Chinese words…', 12);

  try {
    const result = await withTimeout(
      worker.recognize(file),
      90000,
      'Reading the photo took too long. Try a closer, brighter photo.'
    );
    $(`${prefix}ProgressBar`).style.width = '100%';
    $(`${prefix}ProgressText`).textContent = 'Finished reading the photo.';
    return result?.data?.text || '';
  } catch (error) {
    console.error('Ting Xie OCR failed', error);
    try { await ocrWorker?.terminate(); } catch { /* ignore cleanup failure */ }
    ocrWorker = null;
    ocrWorkerPromise = null;
    throw new Error(error?.message || 'The photo could not be read. Try again with a clearer photo.');
  }
};

window.addEventListener('pagehide', () => {
  if (ocrWorker) {
    ocrWorker.terminate().catch(() => {});
    ocrWorker = null;
    ocrWorkerPromise = null;
  }
});
