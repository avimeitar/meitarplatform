-- sales managers may edit the lists (sources, reasons, status names) and who meets the clients
UPDATE "Role" SET "permissions" = array_append("permissions", 'lists.manage')
WHERE "key" = 'manager' AND NOT ('lists.manage' = ANY("permissions"));
