# Higher Chinese Word Bank

A words-only web app for practising Higher Chinese words and phrases, with pinyin, English meanings and example sentences.

## Site URL

After publishing through GitHub Pages, the app is available at:

```text
https://edyeo82.github.io/chineseflashcard/hcl-words/
```

If the folder URL does not load immediately, use:

```text
https://edyeo82.github.io/chineseflashcard/hcl-words/index.html
```

## How to use

1. Choose the child profile.
2. Choose the Primary level.
3. Look at the Chinese word or phrase on the card.
4. Tap the centre of the card to reveal or hide the pinyin, English meaning and example sentence.

## Card controls

- Tap left side of the card: previous card
- Tap centre of the card: reveal / hide answer
- Tap right side of the card: next card
- Swipe right: show “I know this”, mark as known, remove from the active deck, and move to next card
- Swipe left: show “I need to revise this again”, mark for practice, and move to next card
- I know this & Next: mark as known, remove from the active deck, and move to next card
- Practise again & Next: mark for more practice and move to next card
- Shuffle: randomise the current active deck

When the app reaches the end of the active deck, it automatically returns to the first active card.

## Mobile behaviour

The page disables common accidental double-tap zoom behaviour on mobile, so card taps and swipes should feel more like a flashcard app.

## Underlined characters

Characters are underlined only when they appear in the same selected Primary level in the original character list.

For example:

- Primary 3 words underline characters found in Primary 3A / Primary 3B.
- Primary 4 words underline characters found in Primary 4A / Primary 4B.

## Known words

Each child profile has its own saved progress in the browser.

When a card is marked as **known**, it is removed from the active swipe/practice deck so time is not wasted revisiting it.

Open **Known words for selected child** to see words already marked as known. If a word was marked as known by mistake, use **Unknown / practise again** to move it back into the active practice deck.

Progress is saved locally in the browser using localStorage. It is not uploaded to a server.

## Source note

The character reference is taken from the original app's `../index.html` `flashcardData`. The word bank is a starter vocabulary layer. It is not yet a complete official textbook vocabulary list. To improve coverage, add actual school spelling lists and textbook lesson vocabulary over time.
