# Tasks

Things to do, each on one list. Tasks are stored as tasks (with reminders),
not as entries, so this area's `area.json` declares lists instead of fields.

## Lists

- **personal** — the default when no list is named
- **home** — the house: repairs, chores, errands for the house
- **cranberry** — anything for Cranberry

## How it's said

- "remind me to call the dentist tomorrow at 10" → personal, remindAt tomorrow 10:00
- "add a task for home: clean the gutters" → home
- "Cranberry: send the invoice by Friday" → cranberry, dueAt Friday 17:00
- "I need to renew the car registration" → personal

## Rules

- `title` is the thing to do, short, starting with a verb, without the list
  name or the timing words ("Clean the gutters", not "Add a task for home to
  clean the gutters").
- Pick the list from the words; when unsure, personal.
- "Remind me" sets `remindAt`. "By"/"before"/"due" sets `dueAt`.
