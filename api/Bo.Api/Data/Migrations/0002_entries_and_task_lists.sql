-- Tracked entries: one row per thing recorded, in whichever area (the areas/
-- folder defines each area's fields). data holds the validated field values.
create table entries (
    id          uuid primary key default gen_random_uuid(),
    user_id     uuid not null references users(id),
    area        text not null,
    at          timestamptz not null,
    data        jsonb not null default '{}',
    source      text not null default 'manual' check (source in ('manual', 'typed', 'voice')),
    raw         text,
    created_at  timestamptz not null default now(),
    updated_at  timestamptz not null default now()
);

create index entries_user_area_at_idx on entries (user_id, area, at desc);
create index entries_user_at_idx on entries (user_id, at desc);

-- Tasks belong to one list (areas/tasks/area.json names them). Existing tasks
-- land on personal.
alter table tasks add column list text not null default 'personal';
create index tasks_user_list_idx on tasks (user_id, list, done_at);
