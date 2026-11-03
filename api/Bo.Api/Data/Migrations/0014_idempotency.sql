-- The phone queues changes made offline and sends each with an
-- Idempotency-Key. If an answer is lost and the change is sent again, the
-- stored answer is returned instead of doing it twice. Kept a week.
create table idempotency_keys (
    user_id      uuid not null references users(id),
    key          text not null,
    status       int not null,
    content_type text,
    body         text,
    created_at   timestamptz not null default now(),
    primary key (user_id, key)
);
