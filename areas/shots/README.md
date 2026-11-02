# Shots

Injections: when one was taken (and where), and the supply — when you ran out
and when you refilled.

## How it's said

- "took my shot, left thigh"
- "did my injection this morning, 0.5 right abdomen"
- "I'm out of my shots" → event `ran-out`
- "picked up my refill" / "refilled my shots" → event `refilled`

## Rules

- `event` is `taken` unless the text is about running out or refilling.
- Sites: "belly"/"stomach" is abdomen; "leg" is thigh.
- **"Left" or "right" alone means that shot's usual spot** (listed below):
  "testosterone, right" is `right-thigh`; "tirzepatide, left" is
  `left-abdomen`. The owner alternates sides each week and the app reminds
  them which, so a bare side is the normal way to say it.
- With no side at all, leave `site` empty — don't guess; the app works out
  the rotation from the shots that have one.
- Always name the medication: the owner takes two weekly shots, so "took my
  shot" alone is ambiguous. With no medication named, use "shot" and say in
  `notes` that it wasn't named — a schedule only counts a named one.

## Known shots

Add what you take and the usual dose:

- tirzepatide (Mounjaro / Zepbound) — weekly, in the belly (abdomen),
  alternating left and right. The owner sets the dose, in **units** on the
  syringe (30 units now, stepping up 35, 40 …); keep it as said, "35 units".
  Often heard as "tor appetite", "teresa appetite".
- testosterone — weekly, in the thigh, alternating left and right
- sermorelin (sermorelin acetate, 2 mg/ml, 10 ml vial) — 15 units (0.15 ml),
  Monday to Friday, in the belly, alternating sides each day and never on
  the same side as a tirzepatide shot the same day. Often heard as "Sam
  Marlin". "sermorelin, left" is `left-abdomen`.
- Leqvio (inclisiran) — given by the doctor every few months; a past one
  said with its date ("my Leqvio was June 3rd") is logged at that date
