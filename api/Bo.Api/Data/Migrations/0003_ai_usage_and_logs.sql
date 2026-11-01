-- Every model call, in two halves with different lifetimes.
--
-- ai_usage: what it cost and how it went. Small, numeric, kept forever, so
-- spend can be charted across months and years. Provider-neutral: provider
-- and model are plain text, so OpenAI or a local model needs no change here.
create table ai_usage (
    id                  uuid primary key default gen_random_uuid(),
    user_id             uuid not null references users(id),
    at                  timestamptz not null default now(),
    feature             text not null,              -- 'capture' today
    provider            text,                       -- null when no model was called
    model               text,
    outcome             text not null check (outcome in
                          ('ok', 'refused', 'out_of_room', 'error', 'not_configured', 'over_budget')),
    parser              text not null check (parser in ('model', 'patterns')),
    input_tokens        integer not null default 0,
    output_tokens       integer not null default 0,
    cache_read_tokens   integer not null default 0,
    cache_write_tokens  integer not null default 0,
    cost_usd            numeric(12, 6),             -- null = model has no price entry (unknown, not free)
    latency_ms          integer,
    proposals           integer not null default 0
);

create index ai_usage_user_at_idx on ai_usage (user_id, at desc);

-- ai_logs: the words. What was said, what the model was sent and answered.
-- Deleted after Ai:LogRetentionDays (30) by the API's retention job; the
-- usage row it belongs to stays.
create table ai_logs (
    usage_id    uuid primary key references ai_usage(id) on delete cascade,
    at          timestamptz not null,
    input       text not null,                       -- exactly what was typed or said
    source      text,                                -- typed | voice
    request     text,                                -- the per-call message sent (not the fixed area guides)
    response    text,                                -- the model's raw answer
    proposals   jsonb,
    note        text,
    error       text
);

create index ai_logs_at_idx on ai_logs (at);

-- What was kept: an entry or task saved from a capture points at its call.
alter table entries add column ai_usage_id uuid references ai_usage(id);
alter table tasks add column ai_usage_id uuid references ai_usage(id);
create index entries_ai_usage_idx on entries (ai_usage_id) where ai_usage_id is not null;
create index tasks_ai_usage_idx on tasks (ai_usage_id) where ai_usage_id is not null;
