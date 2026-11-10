-- Reusable checklists: tick things off, then start over for next time. The
-- first is the travel packing list. items is an ordered JSON array of
-- {id, text, done}; one person edits it, so the whole list is one row.
create table checklists (
    id uuid primary key default gen_random_uuid(),
    user_id uuid not null references users(id) on delete cascade,
    title text not null,
    items jsonb not null default '[]',
    sort int not null default 0,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now()
);
create index checklists_user on checklists(user_id, sort);

-- The owner's packing list, as given (2026-11-10).
insert into checklists (user_id, title, items)
select u.id, 'Packing list', (
    select jsonb_agg(jsonb_build_object('id', gen_random_uuid(), 'text', t, 'done', false) order by n)
    from unnest(array['CPAP', 'Waterboy and Spark', 'Clothes', 'Zyn', 'Mac charger', 'Razor',
                      'Hair stuff', 'Headphones', 'Toothbrush and toothpaste']) with ordinality as x(t, n))
from users u;
