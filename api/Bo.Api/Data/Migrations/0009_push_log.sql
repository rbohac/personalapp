-- Every server push attempt, so "why didn't I get a reminder?" has an
-- answer on the phone (Settings › Notifications). Expo answers twice: a
-- ticket when it accepts the push, and a receipt once Apple has taken it
-- (or refused — wrong credentials show up only there). Kept 30 days.
create table push_log (
    id          uuid primary key default gen_random_uuid(),
    user_id     uuid not null references users(id),
    at          timestamptz not null default now(),
    title       text not null,
    devices     int not null,
    -- sent (Expo accepted, receipt pending), delivered (Apple took it),
    -- failed, no-devices, disabled.
    outcome     text not null,
    detail      text,
    ticket_ids  text[] not null default '{}'
);

create index push_log_user_at_idx on push_log (user_id, at desc);
create index push_log_pending_idx on push_log (at) where outcome = 'sent';
