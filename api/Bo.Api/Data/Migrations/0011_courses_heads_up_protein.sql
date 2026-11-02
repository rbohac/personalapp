-- Courses, heads-ups and a goal whose target comes from another reading.
--
-- intervals: a schedule whose gaps change (a patch every other day three
-- times, then weekly) — the gap after dose n is intervals[n]; when they run
-- out, the course is finished. Empty = every_days forever.
-- heads_up_days: push this many days before a dose is due (Leqvio).
alter table schedules add column intervals int[] not null default '{}';
alter table schedules add column doses_done int not null default 0;
alter table schedules add column heads_up_days int not null default 0;

-- target_from: "area.field" — the target is that field's latest value (the
-- protein goal is 1 g per pound of the latest weight). target is the fallback.
alter table goals add column target_from text;

-- The owner's new schedules and protein goal (others get them from the
-- starter files). Times are 8:00 local; edit on the phone.
insert into schedules (user_id, title, area, match_text, every_days, at_minute, next_due, intervals, heads_up_days)
select u.id, x.title, x.area, x.match, x.every, 480, x.next_due, x.intervals, x.heads_up
from users u
cross join lateral (values
    ('Sermorelin', 'shots', 'sermorelin', 7, null::date, '{}'::int[], 0),
    ('Wolverine patch', 'medications', 'wolverine', 2,
        (now() at time zone coalesce(u.time_zone, 'America/New_York'))::date, '{2,2,7,7,7}'::int[], 0),
    ('Leqvio', 'shots', 'leqvio', 182, null::date, '{}'::int[], 14)
) as x(title, area, match, every, next_due, intervals, heads_up)
where u.schedules_seeded
  and not exists (select 1 from schedules s where s.user_id = u.id and s.match_text = x.match);

insert into goals (user_id, title, area, measure, field, target, target_from, period, sort)
select u.id, 'Protein', 'nutrition', 'total', 'protein', 200, 'weight.pounds', 'day',
       coalesce((select max(sort) + 1 from goals g where g.user_id = u.id), 0)
from users u
where u.goals_seeded
  and not exists (select 1 from goals g where g.user_id = u.id and g.area = 'nutrition');
