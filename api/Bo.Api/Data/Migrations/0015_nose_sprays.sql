-- Nose sprays, morning and night: two daily schedules on the same medicine.
--
-- entries.schedule_id: the schedule whose Done logged this entry. When two
-- daily schedules share a match ("nose spray" at 10:00 and at 22:00), a Done
-- counts for the one pressed, whatever the time; a dose said in words counts
-- for the one whose part of the day it falls in.
alter table entries add column schedule_id uuid references schedules(id) on delete set null;

-- The owner's two (others get them from the starter file). Nudges at 10 AM
-- and 10 PM if not taken yet; edit the times on the phone.
insert into schedules (user_id, title, area, match_text, every_days, at_minute)
select u.id, x.title, 'medications', 'nose spray', 1, x.at
from users u
cross join (values ('Morning nose sprays', 600), ('Night nose sprays', 1320)) as x(title, at)
where u.schedules_seeded
  and not exists (select 1 from schedules s where s.user_id = u.id and s.title = x.title);
