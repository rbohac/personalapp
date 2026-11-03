-- The overnight-snacking goal: nights logged without a snack, out of 7 a
-- week. A night counts when its sleep entry says no snack (or doesn't say).
insert into goals (user_id, title, area, measure, target, exclude_field, exclude_values, period, sort)
select u.id, 'Nights without snacking', 'sleep', 'days', 7, 'snack', '{yes,carbs}', 'week',
       coalesce((select max(sort) + 1 from goals g where g.user_id = u.id), 0)
from users u
where u.goals_seeded
  and not exists (select 1 from goals g where g.user_id = u.id and g.area = 'sleep');
