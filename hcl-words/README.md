# Higher Chinese Word Bank

A companion practice app for the main Chinese flashcard site.

## Current behaviour

- Practice cards are original character cards from the main Chinese flashcard app.
- Level and Lesson follow the main app's structure.
- Examples are shown on reveal, not as separate swipe cards.
- Each child now has separate known-character progress using child-specific storage keys.
- Each child also remembers their own last selected level and lesson.
- Mobile select controls listen to both `change` and `input`, so switching children rebuilds the deck reliably on iPhone/iPad.

## Controls

- Tap centre of card: reveal / hide pinyin and examples.
- Tap left/right side or arrows: previous / next.
- Swipe right: know and remove from active practice.
- Swipe left: don't know and move on.
- Use Known characters to restore any character marked known by mistake.
