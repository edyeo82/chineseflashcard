'use strict';

const TINGXIE_LIST_PARSER_FIX_VERSION = '20260722-2';

function stripWorksheetItemNumber(value) {
  let result = String(value || '');

  // Explicit question labels are safe to remove.
  result = result.replace(/^\s*第\s*(?:\d+|[一二三四五六七八九十百]+)\s*[题題]\s*/, '');

  // Arabic worksheet numbers may use punctuation or a separating space.
  result = result.replace(/^\s*\d{1,2}\s*(?:(?:[.、:：)）\]\-])\s*|\s+(?=[\u3400-\u9fff]))/, '');

  // Chinese-number labels are removed only when punctuation proves that they
  // are numbering. A bare 一, 五, 十, etc. may be part of the real answer.
  result = result.replace(/^\s*[一二三四五六七八九十百]{1,4}\s*[.、:：)）\]\-]\s*/, '');
  return result;
}

cleanOcrLine = function cleanOcrLinePreservingChineseNumerals(value) {
  return stripWorksheetItemNumber(removeHanSpaces(value))
    .replace(/[|｜]/g, '')
    .replace(/^[-—–•·*]+\s*/, '')
    .replace(/\s{2,}/g, ' ')
    .trim();
};

window.__tingxieListParserFix = {
  version: TINGXIE_LIST_PARSER_FIX_VERSION,
  stripWorksheetItemNumber,
  parse: value => uniqueItems(extractItems(value))
};

document.documentElement.dataset.tingxieListParserFix = 'true';
