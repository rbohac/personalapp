-- Testosterone twice a week: 4 days, then 3, repeating, with a half dose
-- each time; a full shot instead waits a whole week (a trip).
--
-- cycle: gaps that repeat after a normal dose ({4,3}); empty = every_days.
-- cycle_pos: which gap comes next. A full dose doesn't move it, so the
--   rhythm picks up where it was (Mon/Fri stays Mon/Fri).
-- dose_options: the amounts offered when logging ("0.4 ml", "0.5 ml").
-- full_dose: the full amount; logging it waits every_days instead.
alter table schedules add column cycle int[] not null default '{}';
alter table schedules add column cycle_pos int not null default 0;
alter table schedules add column dose_options text[] not null default '{}';
alter table schedules add column full_dose text;

-- The owner's testosterone, starting today (or in 4 days if today's is
-- already logged). Half dose by default; edit on the phone.
update schedules s set
    cycle = '{4,3}', every_days = 7,
    dose_options = '{0.4 ml,0.5 ml}', full_dose = '0.8 ml',
    dose = '0.4 ml', dose_set_at = now(), shifted_from = null, intervals = '{}',
    next_due = case
        when s.last_entry_at is not null
         and (s.last_entry_at at time zone coalesce(u.time_zone, 'America/New_York'))::date
           = (now() at time zone coalesce(u.time_zone, 'America/New_York'))::date
        then (now() at time zone coalesce(u.time_zone, 'America/New_York'))::date + 4
        else (now() at time zone coalesce(u.time_zone, 'America/New_York'))::date
    end,
    cycle_pos = case
        when s.last_entry_at is not null
         and (s.last_entry_at at time zone coalesce(u.time_zone, 'America/New_York'))::date
           = (now() at time zone coalesce(u.time_zone, 'America/New_York'))::date
        then 1 else 0
    end
from users u
where u.id = s.user_id and s.match_text = 'testosterone';
