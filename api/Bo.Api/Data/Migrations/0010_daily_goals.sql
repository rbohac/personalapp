-- A goal can be per day ("at least 15 minutes of household work a day")
-- as well as per week. Per-day goals show today and the last 7 days.
alter table goals add column period text not null default 'week' check (period in ('day', 'week'));

-- The owner's household goal, for anyone whose goals were already seeded
-- (new people get it from areas/_goals.json).
insert into goals (user_id, title, area, measure, field, target, period, sort)
select u.id, 'Brock Road upkeep', 'household', 'total', 'minutes', 15, 'day',
       coalesce((select max(sort) + 1 from goals g where g.user_id = u.id), 0)
from users u
where u.goals_seeded
  and not exists (select 1 from goals g where g.user_id = u.id and g.area = 'household');
