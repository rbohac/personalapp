# Nutrition

What was eaten or drunk, and its protein. Entries add up through the day
toward the protein goal (1 g per pound of body weight). The words of what
was eaten are kept on purpose — they're for asking questions later ("how
often do I have a shake?").

## How it's said

- "10 g of protein from a shake" → protein 10, food "shake"
- "protein bar, 20 grams" → protein 20, food "protein bar"
- "two eggs and toast for breakfast" → food "two eggs and toast", protein
  estimated
- "had a chicken breast" → food "chicken breast", protein estimated

## Rules

- `food` is what was eaten, in the owner's words, always filled in when said.
- When grams of protein are said, use them and leave `estimated` out.
- When they aren't, **estimate** from common values (an egg ≈ 6 g, a chicken
  breast ≈ 30 g, a cup of Greek yogurt ≈ 20 g) and set `estimated` to true.
  If there's no sensible estimate, leave protein out.
- Several foods in one sentence are one entry per food.
- `at` follows the usual rules: "for breakfast" is 8:00, "lunch" 12:00,
  "dinner" 18:00.
