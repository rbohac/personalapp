-- Sermorelin stopped (owner, 2026-11-23): the schedule goes, with its marks
-- and nudges (cascade). Past doses stay in the log as history.
delete from schedules where match_text = 'sermorelin';

-- Anastrozole: a pill once a week on Mondays, starting today (a Monday).
-- Counted from the dose like the weekly shots: a late one asks whether to
-- keep Mondays.
insert into schedules (user_id, title, area, match_text, every_days, at_minute, next_due)
select u.id, 'Anastrozole', 'medications', 'anastrozole', 7, 480,
       (now() at time zone coalesce(u.time_zone, 'America/New_York'))::date
           + ((8 - extract(isodow from (now() at time zone coalesce(u.time_zone, 'America/New_York'))::date)::int) % 7)
from users u
where u.schedules_seeded
  and not exists (select 1 from schedules s where s.user_id = u.id and s.match_text = 'anastrozole');

-- So "anastrazole" said or typed is spelled right.
insert into vocabulary_terms (user_id, term, heard)
select u.id, 'anastrozole', '{anastrazole,an astrozole,anastrozol}'
from users u
where u.vocabulary_seeded
  and not exists (select 1 from vocabulary_terms v where v.user_id = u.id and lower(v.term) = 'anastrozole');
