# Sleep

One entry per night, logged the morning after (the entry's time is that
morning). Mostly filled from the *Last night* card on Home; by voice too.
The goal is **no overnight snacking, especially carbs**.

## How it's said

- "bed at 11:40, up at 7:10" → bed "23:40", wake "07:10"
- "was up from 1 to 4 and had some crackers" → awake "01:00–04:00",
  awake_minutes 180, snack "carbs"
- "up twice, about 20 minutes each, no snacks" → awake_minutes 40, snack "none"
- "CPAP 5.2 hours, score 71" → cpap_hours 5.2, cpap_score 71
- "napped an hour yesterday" → nap_minutes 60

## Rules

- Times are 24-hour "HH:mm". "11:40" at bedtime is 23:40; "1 to 4" in the
  night is 01:00–04:00.
- `snack`: "carbs" for anything starchy or sweet (crackers, bread, cereal,
  cookies, chips); "yes" for other food; "none" when they say they didn't.
  Leave it out when it isn't mentioned.
- `at` is the morning after: "last night" means this entry, dated today.
- One entry per night: several things about the same night go in one entry.
