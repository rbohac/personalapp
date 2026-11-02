-- Words Bo listens for, one list per person, edited on the phone.
-- areas/_vocabulary.json is the starter list: it's copied in the first time a
-- person's list is read (vocabulary_seeded marks that), and after that the
-- list is theirs — deleting a starter word keeps it deleted.
create table vocabulary_terms (
    id          uuid primary key default gen_random_uuid(),
    user_id     uuid not null references users(id),
    term        text not null,
    heard       text[] not null default '{}',
    created_at  timestamptz not null default now(),
    updated_at  timestamptz not null default now()
);

create unique index vocabulary_terms_user_term_idx on vocabulary_terms (user_id, lower(term));

alter table users add column vocabulary_seeded boolean not null default false;
