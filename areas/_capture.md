# How to read a capture

A capture is one short thing the owner typed or said into Bo, often by voice,
so expect dictation slips ("one twenty over eighty", "for" for "four").

- **Turn it into one or more captures**, one per area it mentions. "Took my BP,
  128 over 82, and my morning meds" is two: blood pressure and medications.
- **Only use the areas below.** If a reading or event fits none of them, file
  it in **unsorted** with the words as said — never drop it. Something that
  isn't a reading at all (a greeting, a question) gets no captures and a
  `note`.
- **Fields:** use the area's field keys exactly. Give every value as a string
  in plain form: numbers as digits ("72"), booleans as "true"/"false", choices
  as one of the listed options. Leave out a field the text doesn't give,
  unless the area's guidance says how to infer it or the field has a default.
- **Never invent a number.** If a reading is ambiguous or missing, leave it
  out; Bo shows what's missing and the owner fixes it.
- **Time (`at`):** when it happened, as ISO 8601 with the offset of the local
  time given below. "This morning" is 8:00, "at lunch" 12:00, "last night"
  21:00 the previous day, "yesterday" with no time 12:00 yesterday. With no
  time mentioned, return null (meaning now).
- **Tasks:** "remind me to…", "add a task…", "I need to…" go to the tasks area
  with `task` filled in. Words like "for home" or "for Cranberry" pick the
  list. A reminder time goes in `remindAt`; a deadline ("by Friday") in
  `dueAt`, at 17:00 local when no time is given.
- `note` is for one short line to the owner only when something needs their
  attention (an assumption you made, a reading out of range). Otherwise null.

## Worked examples

Each shows a capture and the exact answer expected. They assume this context:
`Local time now: 2026-11-03T19:30:00-06:00 (America/Chicago, Tuesday)`.

**"BP 128 over 82 pulse 70"**

```json
{"captures":[{"area":"blood-pressure","at":null,"fields":[{"key":"systolic","value":"128"},{"key":"diastolic","value":"82"},{"key":"pulse","value":"70"}],"task":null}],"note":null}
```

**"this morning I took my blood pressure one thirty one over eighty five left arm, then walked thirty minutes"**

```json
{"captures":[{"area":"blood-pressure","at":"2026-11-03T08:00:00-06:00","fields":[{"key":"systolic","value":"131"},{"key":"diastolic","value":"85"},{"key":"arm","value":"left"}],"task":null},{"area":"walks","at":"2026-11-03T08:00:00-06:00","fields":[{"key":"done","value":"true"},{"key":"minutes","value":"30"}],"task":null}],"note":null}
```

**"tirzepatide, right"** — a bare side means that shot's usual spot (the belly):

```json
{"captures":[{"area":"shots","at":null,"fields":[{"key":"event","value":"taken"},{"key":"medication","value":"tirzepatide"},{"key":"site","value":"right-abdomen"}],"task":null}],"note":null}
```

**"Spo2 96 temp 97.9, and 25 grams of protein from a shake"**

```json
{"captures":[{"area":"vitals","at":null,"fields":[{"key":"spo2","value":"96"},{"key":"temp","value":"97.9"}],"task":null},{"area":"nutrition","at":null,"fields":[{"key":"protein","value":"25"},{"key":"food","value":"shake"}],"task":null}],"note":null}
```

**"my left knee is about a 6 out of 10 today"** — no area for pain yet, so it's kept unsorted:

```json
{"captures":[{"area":"unsorted","at":null,"fields":[{"key":"text","value":"my left knee is about a 6 out of 10 today"},{"key":"about","value":"knee pain"}],"task":null}],"note":null}
```

**"remind me to call the plumber tomorrow at 9 for home"**

```json
{"captures":[{"area":"tasks","at":null,"fields":[],"task":{"title":"Call the plumber","list":"home","dueAt":null,"remindAt":"2026-11-04T09:00:00-06:00"}}],"note":null}
```

**"blood pressure 135"** — only one number, so nothing is recorded:

```json
{"captures":[],"note":"A blood pressure reading needs two numbers, like 135/85."}
```

**"what a nice day"** — nothing to log:

```json
{"captures":[],"note":"Nothing to log in that."}
```
