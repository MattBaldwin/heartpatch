-- Rows written before #367 may hold an ICU legacy link name (Asia/Rangoon,
-- Europe/Kiev, …) that Postgres images without tzdata-legacy reject in
-- `at time zone`. Each becomes the zone it links to. The list is
-- ICU_LINK_TO_ZONE in src/lib/time.ts (migration-0041.test.ts ties them);
-- running it again changes nothing.
UPDATE "maps" SET "time_zone" = legacy.zone
FROM (VALUES
  ('Africa/Asmera', 'Africa/Asmara'),
  ('America/Buenos_Aires', 'America/Argentina/Buenos_Aires'),
  ('America/Catamarca', 'America/Argentina/Catamarca'),
  ('America/Coral_Harbour', 'America/Atikokan'),
  ('America/Cordoba', 'America/Argentina/Cordoba'),
  ('America/Godthab', 'America/Nuuk'),
  ('America/Indianapolis', 'America/Indiana/Indianapolis'),
  ('America/Jujuy', 'America/Argentina/Jujuy'),
  ('America/Kralendijk', 'America/Curacao'),
  ('America/Louisville', 'America/Kentucky/Louisville'),
  ('America/Lower_Princes', 'America/Curacao'),
  ('America/Marigot', 'America/Port_of_Spain'),
  ('America/Mendoza', 'America/Argentina/Mendoza'),
  ('America/St_Barthelemy', 'America/Port_of_Spain'),
  ('Arctic/Longyearbyen', 'Europe/Oslo'),
  ('Asia/Calcutta', 'Asia/Kolkata'),
  ('Asia/Katmandu', 'Asia/Kathmandu'),
  ('Asia/Rangoon', 'Asia/Yangon'),
  ('Asia/Saigon', 'Asia/Ho_Chi_Minh'),
  ('Atlantic/Faeroe', 'Atlantic/Faroe'),
  ('Europe/Bratislava', 'Europe/Prague'),
  ('Europe/Busingen', 'Europe/Zurich'),
  ('Europe/Kiev', 'Europe/Kyiv'),
  ('Europe/Mariehamn', 'Europe/Helsinki'),
  ('Europe/Podgorica', 'Europe/Belgrade'),
  ('Europe/San_Marino', 'Europe/Rome'),
  ('Europe/Vatican', 'Europe/Rome'),
  ('Pacific/Enderbury', 'Pacific/Kanton'),
  ('Pacific/Ponape', 'Pacific/Pohnpei'),
  ('Pacific/Truk', 'Pacific/Chuuk')
) AS legacy(link, zone)
WHERE "maps"."time_zone" = legacy.link;--> statement-breakpoint
UPDATE "users" SET "time_zone" = legacy.zone
FROM (VALUES
  ('Africa/Asmera', 'Africa/Asmara'),
  ('America/Buenos_Aires', 'America/Argentina/Buenos_Aires'),
  ('America/Catamarca', 'America/Argentina/Catamarca'),
  ('America/Coral_Harbour', 'America/Atikokan'),
  ('America/Cordoba', 'America/Argentina/Cordoba'),
  ('America/Godthab', 'America/Nuuk'),
  ('America/Indianapolis', 'America/Indiana/Indianapolis'),
  ('America/Jujuy', 'America/Argentina/Jujuy'),
  ('America/Kralendijk', 'America/Curacao'),
  ('America/Louisville', 'America/Kentucky/Louisville'),
  ('America/Lower_Princes', 'America/Curacao'),
  ('America/Marigot', 'America/Port_of_Spain'),
  ('America/Mendoza', 'America/Argentina/Mendoza'),
  ('America/St_Barthelemy', 'America/Port_of_Spain'),
  ('Arctic/Longyearbyen', 'Europe/Oslo'),
  ('Asia/Calcutta', 'Asia/Kolkata'),
  ('Asia/Katmandu', 'Asia/Kathmandu'),
  ('Asia/Rangoon', 'Asia/Yangon'),
  ('Asia/Saigon', 'Asia/Ho_Chi_Minh'),
  ('Atlantic/Faeroe', 'Atlantic/Faroe'),
  ('Europe/Bratislava', 'Europe/Prague'),
  ('Europe/Busingen', 'Europe/Zurich'),
  ('Europe/Kiev', 'Europe/Kyiv'),
  ('Europe/Mariehamn', 'Europe/Helsinki'),
  ('Europe/Podgorica', 'Europe/Belgrade'),
  ('Europe/San_Marino', 'Europe/Rome'),
  ('Europe/Vatican', 'Europe/Rome'),
  ('Pacific/Enderbury', 'Pacific/Kanton'),
  ('Pacific/Ponape', 'Pacific/Pohnpei'),
  ('Pacific/Truk', 'Pacific/Chuuk')
) AS legacy(link, zone)
WHERE "users"."time_zone" = legacy.link;
