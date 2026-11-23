-- Reminders that keep coming until it's done (owner, 2026-11-23: "bug the
-- shit out of me"). nag_minutes: extra times of day (minutes after midnight)
-- to push again while today's isn't logged; the 2-hour follow-up is skipped
-- for a schedule that has them.
alter table schedules add column nag_minutes int[] not null default '{}';

-- A blood pressure reading every day: due 9:00, then noon, 2, 4, 6 and 8 PM
-- until one is logged. Any reading in the blood-pressure area counts.
insert into schedules (user_id, title, area, match_text, every_days, at_minute, nag_minutes)
select u.id, 'Blood pressure', 'blood-pressure', null, 1, 540, '{720,840,960,1080,1200}'
from users u
where u.schedules_seeded
  and not exists (select 1 from schedules s where s.user_id = u.id and s.area = 'blood-pressure');
