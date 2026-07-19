# 听写小老师 (Ting Xie)

A mobile-friendly, static GitHub Pages app for Chinese spelling practice.

## Workflow

1. Upload or photograph a Chinese spelling list.
2. Use in-browser OCR to create an editable one-item-per-line list.
3. Start dictation. The current word stays hidden while the browser reads it aloud in Mandarin.
4. Say **“next”** before the app advances, or use the large Next button.
5. Upload the completed handwritten work.
6. Use assisted OCR marking, review uncertain handwriting, and save wrong or missing words.
7. Retest only the mistakes.

## Privacy and limitations

- Practice lists, profile name, results, and history are stored in the browser using `localStorage`.
- Photos are processed in the browser. Tesseract.js and its language model are downloaded from public CDNs.
- Handwritten Chinese OCR is imperfect. The app marks uncertain matches as **Check OCR** so a parent or learner can confirm them.
- Voice commands use the browser Web Speech API. Browser support varies; the on-screen buttons always remain available.

## Deployment

The folder can be served directly by GitHub Pages at:

`https://edyeo82.github.io/chineseflashcard/tingxie/`
