# 听写小老师 V2 — AI OCR without user setup

V2 is separate from the [original Ting Xie](../tingxie/README.md). All V1 files, saved data, and cloud-sync paths remain untouched.

**V2:** https://edyeo82.github.io/chineseflashcard/tingxie-v2/

## Learner experience

1. Take or select a photo of the Chinese 听写 words.
2. Tap **✨ Read photo with AI**.
3. Review/edit the Chinese words and start practice.
4. Optionally photograph handwritten answers for preliminary marking, then confirm them manually.

**No login, API key, account creation, payment details, or AI settings are required for learners.**

## Backend: Firebase AI Logic + Gemini Developer API

The V2 frontend uses the existing `chinese-flashcards-63883` Firebase project through Firebase AI Logic's managed proxy, not a public Gemini API key. The model is `gemini-3.5-flash-lite` (subject to model free-tier quotas). The Google Firebase API configuration is public by design, but no private Gemini API key is checked into GitHub.

**Important: The frontend has been committed, but the Firebase project has not been activated for AI. Until a project administrator completes the one-time setup below, scanning shows a clear owner-activation error and manual word entry continues to work.**

### One-time site-owner setup — not done by users

1. Open [Firebase Console](https://console.firebase.google.com/) and select project **chinese-flashcards-63883**.
2. Under **AI Services → AI Logic**, select **Get started** and enable the **Gemini Developer API**. If you need its free tier, the Firebase project should remain on the no-cost Spark plan. If on Blaze, verify applicable charges before proceeding.
3. In Google Cloud, create a **reCAPTCHA Enterprise web site key**, with `edyeo82.github.io` as an allowed domain. Choose score-based/invisible protection, not a checkbox challenge.
4. In Firebase **Security → App Check**, register the **existing Firebase Web app** (app ID in `ai-config.js`) with that reCAPTCHA Enterprise site key. Ensure **Firebase AI Logic** enforcement is enabled (required since November 2, 2026).
5. Set the **public** `appCheckSiteKey` in `tingxie-v2/ai-config.js` to your reCAPTCHA Enterprise site key, commit and redeploy GitHub Pages. This site key is safe to publish; **never commit any Gemini/Google Cloud secret key**.
6. Confirm one real mobile scan. Monitor AI usage/quota in Firebase/Google Cloud.

No Cloudflare Worker or family access code is used in the default V2 scanning path. The `worker/` example is leftover from the earlier proof-of-concept and is not deployed or called by this version.

### Why App Check?

Google began requiring Firebase App Check enforcement for Firebase AI Logic on **November 2, 2026**. Without the production Web attestation provider, the Firebase proxy rejects AI requests. App Check limits unauthorized use of the shared quota, though it does not replace monitoring or per-IP/user request throttling.

## Privacy and limits

* Only photos actively scanned are sent through Firebase AI Logic to Google's models; no image is saved by the V2 app.
* The old Tesseract OCR engine is not loaded for normal V2 use.
* The Gemini Developer API free tier has limits, can become unavailable, and may use free-tier data for model improvement: crop names and identifiable details out of photos.
* AI can hallucinate or misread Chinese characters, especially handwriting. Parents should always review extracted words and corrected marks.
* Separate V2 browser storage keys and Firestore paths prevent V2 from overwriting V1 saved data.

**References:** https://firebase.google.com/docs/ai-logic/get-started ; https://firebase.google.com/docs/ai-logic/app-check ; https://firebase.google.com/docs/ai-logic/models
