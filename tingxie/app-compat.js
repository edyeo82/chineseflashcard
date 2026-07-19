'use strict';

// JSON.parse(null) returns null instead of throwing. On a fresh browser that
// made loadSettings() read properties such as `rate` from null and stopped all
// event handlers from being attached. Always return the caller's fallback for
// empty storage values or a parsed null value.
safeJsonParse = function safeJsonParseWithFallback(value, fallback) {
  if (value === null || value === undefined || value === '') return fallback;
  try {
    const parsed = JSON.parse(value);
    return parsed === null || parsed === undefined ? fallback : parsed;
  } catch {
    return fallback;
  }
};
