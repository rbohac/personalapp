# Walks

Whether a walk happened, and how long or far.

## How it's said

- "went for a walk"
- "walked 30 minutes"
- "two mile walk with the dog"
- "no walk today, raining" → done `false`, reason in `notes`

## Rules

- `done` is true unless the text says it didn't happen.
- Distance is in miles; convert kilometres (1 km = 0.62 mi, one decimal).
- Who came along or where goes in `notes`.
