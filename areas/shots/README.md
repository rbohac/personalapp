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
- Sites: "belly"/"stomach" is abdomen; "leg" is thigh. Without a side, use
  `other` and mention it in `note`.
- Always name the medication: the owner takes two weekly shots, so "took my
  shot" alone is ambiguous. With no medication named, use "shot" and say in
  `notes` that it wasn't named — a schedule only counts a named one.

## Known shots

Add what you take and the usual dose:

- tirzepatide (Mounjaro / Zepbound) — weekly
- testosterone — weekly
