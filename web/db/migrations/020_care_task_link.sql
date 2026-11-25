-- A failed operation has no outstanding writes. Pending and completed receipts
-- reserve the reminder across users, including during Airtable recovery.
CREATE UNIQUE INDEX hvr_one_task_per_care_event ON hvr_operations(environment, resource)
WHERE action = 'create' AND resource LIKE 'care-event:%' AND state <> 'failed';
