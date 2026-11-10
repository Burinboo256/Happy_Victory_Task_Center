ALTER TABLE hvr_line_accounts ADD COLUMN recipient_role text NOT NULL DEFAULT 'Secretary'
  CHECK(recipient_role IN ('Secretary','Agent'));
ALTER TABLE hvr_line_deliveries ADD COLUMN event_type text NOT NULL DEFAULT 'new_task'
  CHECK(event_type IN ('new_task','task_completed'));

CREATE OR REPLACE FUNCTION hvr_queue_new_task_line() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE task_snapshot jsonb;
BEGIN
  IF NEW.state<>'completed' OR OLD.state='completed'
    OR NEW.result->>'id' IS NULL
    OR NOT EXISTS(SELECT 1 FROM hvr_line_settings WHERE environment=NEW.environment AND enabled)
  THEN RETURN NEW; END IF;

  IF NEW.action='create' THEN
    INSERT INTO hvr_line_deliveries(environment,operation_id,task_id,user_id,line_id,binding,summary,event_type)
    SELECT NEW.environment,NEW.id,NEW.result->>'id',a.user_id,a.line_id,a.binding,
      jsonb_build_object('title',NEW.payload->>'title','category',NEW.payload->>'category',
        'priority',NEW.payload->>'priority','dueDate',NEW.payload->>'dueDate','senderId',NEW.user_id),'new_task'
    FROM hvr_line_accounts a WHERE a.environment=NEW.environment AND a.enabled AND a.recipient_role='Secretary'
    ON CONFLICT(environment,operation_id,user_id) DO NOTHING;
  ELSIF NEW.action='status' AND NEW.payload->>'status'='Completed' THEN
    task_snapshot := NEW.steps->'snapshot'->'value'->'task';
    -- Only a genuine transition into Completed notifies the owner. A repeated save
    -- of Completed, an incomplete operation or an old completed task never backfills.
    IF task_snapshot->>'status'<>'Completed' AND task_snapshot->>'id'=NEW.result->>'id' THEN
      INSERT INTO hvr_line_deliveries(environment,operation_id,task_id,user_id,line_id,binding,summary,event_type)
      SELECT NEW.environment,NEW.id,NEW.result->>'id',a.user_id,a.line_id,a.binding,
        jsonb_build_object('title',task_snapshot->>'title','category',task_snapshot->>'category',
          'priority',task_snapshot->>'priority','senderId',NEW.user_id,
          'completedAt',NEW.steps->'snapshot'->'value'->>'completedAt'),'task_completed'
      FROM hvr_line_accounts a WHERE a.environment=NEW.environment AND a.enabled
        AND a.recipient_role='Agent' AND a.user_id=task_snapshot->>'agentId'
      ON CONFLICT(environment,operation_id,user_id) DO NOTHING;
    END IF;
  END IF;
  RETURN NEW;
END;
$$;
