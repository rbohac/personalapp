-- Schedules: things to take on a cadence (morning meds daily, a shot every
-- 7 days). A schedule is done when a matching entry is logged; nothing here
-- stores "done" separately. Nudges are server pushes, one row per push sent
-- so the same nudge never goes twice.

-- The server needs each person's clock to know when 8am is, and when not to
-- ring. Minutes after midnight, local time.
alter table users add column time_zone text;
alter table users add column quiet_start_minute int not null default 1320; -- 22:00
alter table users add column quiet_end_minute int not null default 450;    -- 07:30
alter table users add column schedules_seeded boolean not null default false;

create table schedules (
    id            uuid primary key default gen_random_uuid(),
    user_id       uuid not null references users(id),
    title         text not null check (length(trim(title)) > 0),
    -- The area whose entries count (medications, shots) and, optionally, the
    -- medication name an entry must contain. Null match = any entry there.
    area          text not null,
    match_text    text,
    every_days    int not null check (every_days between 1 and 365),
    at_minute     int not null check (at_minute between 0 and 1439),
    -- Every-N-days schedules only: the next day it's due. Daily ones are due every day.
    next_due      date,
    -- Set when a dose landed on a different day than planned and the cadence
    -- moved with it: the day it had been planned for, so "keep the old day" can undo it.
    shifted_from  date,
    -- The newest entry already counted, so one entry moves the schedule once.
    last_entry_at timestamptz,
    items         text[] not null default '{}',
    paused        boolean not null default false,
    snoozed_until timestamptz,
    created_at    timestamptz not null default now(),
    updated_at    timestamptz not null default now()
);

create index schedules_user_idx on schedules (user_id);

create table schedule_nudges (
    schedule_id uuid not null references schedules(id) on delete cascade,
    day         date not null,
    kind        text not null,
    sent_at     timestamptz not null default now(),
    primary key (schedule_id, day, kind)
);
