# Higher Chinese Word Bank

A companion web app for the existing Chinese Flashcards site. It helps Primary School pupils practise Higher Chinese characters, words, phrases and useful sentence patterns.

The original Chinese Flashcards app focuses mainly on single characters. This companion app adds a word-bank layer so that children can practise vocabulary and phrases useful for reading, oral and composition.

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
2. Choose the level.
3. Choose the mode:
   - Words / 词语
   - Characters / 字
   - Sentences / 句子
   - Mixed review
4. Look at the Chinese word, phrase or character on the card.
5. Tap the centre of the card to reveal or hide the pinyin, English meaning and example sentence.

## Card controls

- Tap left side of the card: previous card
- Tap centre of the card: reveal / hide answer
- Tap right side of the card: next card
- Swipe right: mark as known, remove from the active deck, and move to next card
- Swipe left: mark as practise again and move to next card
- I know this & Next: mark as known, remove from the active deck, and move to next card
- Practise again & Next: mark for more practice and move to next card
- Shuffle: randomise the current active deck

When the app reaches the end of the active deck, it automatically returns to the first active card.

## Known words

Each child profile has its own saved progress in the browser.

When a card is marked as **known**, it is removed from the active swipe/practice deck so time is not wasted revisiting it.

Open **Known words for selected child** to see words already marked as known. If a word was marked as known by mistake, use **Unknown / practise again** to move it back into the active practice deck.

Progress is saved locally in the browser using localStorage. It is not uploaded to a server.

## Source note

The character mode attempts to reuse the original app's `../index.html` `flashcardData`. The original app says its characters were parsed from the MOE Primary Higher Chinese character-list PDF.

The word bank is a starter vocabulary and sentence layer. It is not yet a complete official textbook vocabulary list. To improve coverage, add actual school spelling lists, textbook lesson vocabulary and useful composition/oral phrases over time.
