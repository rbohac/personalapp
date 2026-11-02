-- Weekly goals: a rule over a week of entries, worked out from what's
-- logged — never stored as done. "Walk at least 4 days", "walk at least
-- 10 miles", "lift at least 3 days". Weeks start Monday, local time.
create table goals (
    id             uuid primary key default gen_random_uuid(),
    user_id        uuid not null references users(id),
    title          text not null check (length(trim(title)) > 0),
    area           text not null,
    -- days: how many different days have an entry. total: the sum of a field.
    measure        text not null check (measure in ('days', 'total')),
    field          text,
    target         numeric not null check (target > 0),
    -- Entries whose `exclude_field` contains any of these don't count
    -- (lifting = workouts that aren't a run or a walk).
    exclude_field  text,
    exclude_values text[] not null default '{}',
    paused         boolean not null default false,
    sort           int not null default 0,
    created_at     timestamptz not null default now(),
    updated_at     timestamptz not null default now(),
    check (measure = 'days' or field is not null)
);

create index goals_user_idx on goals (user_id);

alter table users add column goals_seeded boolean not null default false;

-- One row per weekly push sent (mid-week check, end-of-week summary).
create table goal_nudges (
    user_id  uuid not null references users(id),
    week     date not null,
    kind     text not null,
    sent_at  timestamptz not null default now(),
    primary key (user_id, week, kind)
);
