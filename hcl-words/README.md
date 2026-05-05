# Higher Chinese Word Bank Companion App

This is a separate companion app for the existing `chineseflashcard` GitHub Pages app.

## How to install

Upload this folder as:

```text
chineseflashcard/
  index.html
  hcl-words/
    index.html
    README.md
```

Then visit:

```text
https://edyeo82.github.io/chineseflashcard/hcl-words/
```

## What it does

- Does not overwrite the original app.
- Tries to load the original app's `../index.html` and extract `flashcardData`.
- Adds a starter word / phrase / sentence bank.
- Supports Child 1 to Child 5 local progress tracking.
- Supports Characters, Words, Sentences, and Mixed Review modes.

## Important source note

The original app says its character data was parsed from:

```text
https://www.moe.gov.sg/-/media/files/primary/2015characterlistprimaryhigherchinese.pdf
```

This companion app adds a starter vocabulary layer. It is not yet a complete official MOE textbook vocabulary list.
The best next step is to add school spelling lists and textbook lesson words.
