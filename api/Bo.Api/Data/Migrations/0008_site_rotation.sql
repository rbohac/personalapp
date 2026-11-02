-- Shots alternate sides. A schedule's rotation lists the sites in order;
-- the next one is the site after the last dose's (from its entry), so
-- saying "left" or "right" when logging is all it takes.
alter table schedules add column rotation text[] not null default '{}';

update schedules set rotation = '{left-thigh,right-thigh}'
where area = 'shots' and match_text ilike 'testosterone' and rotation = '{}';
update schedules set rotation = '{left-abdomen,right-abdomen}'
where area = 'shots' and match_text ilike 'tirzepatide' and rotation = '{}';
