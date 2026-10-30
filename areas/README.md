# Areas

Each folder here is one thing Bo tracks. The folder is the whole definition:

```
areas/<id>/
  area.json   what gets recorded: fields, types, units, how a row reads
  README.md   guidance for the capture parser: how you say it, what it means
```

The API reads this folder at startup (it ships inside the API's Docker
image), serves it to the app at `GET /areas`, validates every saved entry
against `area.json`, and hands every `README.md` to the model that turns
"took my BP, 120 over 80, pulse 72" into a blood-pressure entry.

Entries themselves are JSON documents in Postgres (`entries.data`), one row
per entry, so they're backed up with everything else. The folder defines the
shape; the database holds the data.

## Adding an area

1. Make `areas/<id>/` — the id is lowercase-with-dashes and never changes
   (saved entries point at it).
2. Write `area.json` (copy a sibling). Field `key`s are storage; never rename
   one that has data — add a new field instead.
3. Write `README.md`: what it is, how you'd say it out loud, and anything the
   parser should infer or never guess. Examples are the most useful part.
4. Deploy the API. The app picks the area up on its next launch.

No migration, no app release. A new area is two files.

## `area.json`

```jsonc
{
  "id": "walks",                 // must equal the folder name
  "name": "Walks",
  "icon": "walk-outline",        // an Ionicons name
  "kind": "log",                 // "log" (entries) or "tasks"
  "fields": [
    {
      "key": "minutes",          // storage name — never rename
      "label": "Minutes",
      "type": "integer",         // integer | number | text | choice | boolean
      "unit": "min",             // optional, shown after the value
      "min": 1, "max": 600,      // optional bounds (integer, number)
      "options": ["a", "b"],     // choice only
      "trueLabel": "Done",       // boolean only, how it reads
      "falseLabel": "Skipped",
      "default": true,           // optional, used when not said
      "required": false
    }
  ],
  // How an entry reads in a list. Segments are separated by " · "; a segment
  // with a field that has no value is dropped.
  "summary": "{done} · {minutes} min · {distance} mi",
  // Optional fallback patterns (case-insensitive .NET regex, named groups =
  // field keys), used only when the model can't be reached. They read the
  // numbers and nothing else, so a time or an arm said alongside is lost.
  "patterns": []
}
```

`_capture.md` holds the parser's general rules (times, several things in one
sentence, what to do when unsure). It applies to every area.
