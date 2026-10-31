# Workouts

Whether a workout happened, and roughly what it was. Walks have their own area.

## How it's said

- "worked out" / "did my workout"
- "45 minutes of weights"
- "skipped the gym today" → done `false`
- "bike ride, an hour"

## Rules

- `done` is true unless the text says it was skipped or missed.
- `type` is a short word or two: "weights", "bike", "yoga", "run".
- "An hour" is 60 minutes, "half an hour" 30.
- A walk goes to **walks**, not here.
