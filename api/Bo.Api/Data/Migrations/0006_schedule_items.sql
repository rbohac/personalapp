-- Ticking off a daily schedule's list item by item: one row per item per
-- day that has been touched. taken links the entry it logged; later holds
-- the time to remind; skipped is a decision not to take it today. An item
-- with no row is still to take (unless a logged entry names it).
create table schedule_marks (
    schedule_id uuid not null references schedules(id) on delete cascade,
    day         date not null,
    item        text not null,
    state       text not null check (state in ('taken', 'skipped', 'later')),
    entry_id    uuid references entries(id) on delete set null,
    remind_at   timestamptz,
    reminded_at timestamptz,
    updated_at  timestamptz not null default now(),
    primary key (schedule_id, day, item)
);

create index schedule_marks_reminders_idx on schedule_marks (remind_at) where state = 'later' and reminded_at is null;

-- The starter morning-meds schedule counted any medication entry; now its
-- items do, and saying "took my morning meds" counts as the whole list.
update schedules set match_text = 'morning meds'
where title = 'Morning meds & vitamins' and match_text is null and every_days = 1;
