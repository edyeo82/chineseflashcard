# 听写小老师 V2 — AI OCR

Separate release of the original Ting Xie at ../tingxie/. V1 source files have not been edited.

Live: https://edyeo82.github.io/chineseflashcard/tingxie-v2/

## Use free Gemini AI OCR

1. Create a Gemini API key using a free-tier project at https://aistudio.google.com/api-keys.
2. Open the V2 app. Expand AI photo reader, paste your personal key and Save.
3. Take a photo of the Chinese 听写 list and tap "Read photo with AI".
4. Review/edit the detected words, then use the original reader/practice features.
5. Optional: "mark handwritten answers using AI" for preliminary marking; correct doubtful rows yourself.

The key is stored in browser sessionStorage by default (not in GitHub). Checking "Remember credentials on this device" saves it in browser localStorage. Use only on trusted devices. Do NOT add the key to public GitHub source.

AI errors and hallucinations are possible: review spelling, omitted words and row order. Crop out student names. Photos are transmitted to Google on scanning; Google may use data on the free tier to improve products. Free quotas can change.

## Secure family backend (optional)

The worker/ directory contains a Cloudflare Worker that securely keeps the shared Gemini key server-side.

1. Deploy worker/worker.js with Cloudflare Workers (free tier may suffice).
2. Set Worker secrets GEMINI_API_KEY and FAMILY_ACCESS_CODE (use a long random code).
3. Set ALLOWED_ORIGIN in worker/wrangler.toml to the GitHub Pages origin, or to your custom domain if hosting there.
4. On the app's Advanced AI settings, enter your Worker HTTPS /ocr URL and FAMILY_ACCESS_CODE. The Gemini API key then stays out of the browser.
5. For public deployment, add rate limiting/Turnstile; family code and CORS alone are not complete abuse protection.

## Isolation from V1

* All V2 files are in tingxie-v2/.
* Browser localStorage and sessionStorage are namespaced with tingxie-v2: for V2 classic scripts.
* Cloud-sync uses a different Firestore child path TingXieV2 (not TingXie).
* V2 does not unregister V1 service workers or load browser Tesseract OCR.
* V1 saved lists do not automatically migrate to V2.

OCR end-to-end verification requires the user's API key, which was not provided. No test AI calls have been made.
