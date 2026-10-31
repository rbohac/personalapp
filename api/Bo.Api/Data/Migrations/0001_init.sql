-- Phase 1: who you are, your tasks, and the phones that can be rung.
-- Every row carries user_id from day one, so a second user later is a
-- sign-in change rather than a data migration.

create table users (
    id          uuid primary key default gen_random_uuid(),
    email       text not null unique,
    name        text,
    created_at  timestamptz not null default now(),
    last_seen_at timestamptz not null default now()
);

create table tasks (
    id          uuid primary key default gen_random_uuid(),
    user_id     uuid not null references users(id),
    title       text not null check (length(trim(title)) > 0),
    notes       text,
    due_at      timestamptz,
    remind_at   timestamptz,
    done_at     timestamptz,
    created_at  timestamptz not null default now(),
    updated_at  timestamptz not null default now()
);

create index tasks_user_open_idx on tasks (user_id, done_at, due_at);

create table push_devices (
    installation_id text primary key,
    user_id         uuid not null references users(id),
    expo_token      text not null,
    platform        text not null,
    created_at      timestamptz not null default now(),
    last_seen_at    timestamptz not null default now()
);

create index push_devices_user_idx on push_devices (user_id);
