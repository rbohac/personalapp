-- Sermorelin is Monday to Friday, alternating belly sides, and never on the
-- same side as a tirzepatide shot taken the same day. Tirzepatide's dose is
-- self-adjusted, so the reminder shows the last dose logged.
--
-- weekdays: days a daily schedule is due (0 = Sunday … 6 = Saturday); empty = every day.
-- dose: what Done logs and the reminder shows until a dose is logged.
-- opposite_of: another schedule whose site, on a day both are given, this one
--   must not share (left vs right).
alter table schedules add column weekdays int[] not null default '{}';
alter table schedules add column dose text;
-- When dose was last set by hand: a later logged dose wins, an earlier one doesn't.
alter table schedules add column dose_set_at timestamptz;
alter table schedules add column opposite_of uuid references schedules(id) on delete set null;

update schedules s set
    every_days = 1, next_due = null, shifted_from = null, intervals = '{}',
    weekdays = '{1,2,3,4,5}', dose = '15 units (0.15 ml)',
    rotation = '{left-abdomen,right-abdomen}',
    opposite_of = (select t.id from schedules t where t.user_id = s.user_id and t.match_text = 'tirzepatide' limit 1)
where s.match_text = 'sermorelin';

update schedules set dose = '30 units' where match_text = 'tirzepatide' and dose is null;
