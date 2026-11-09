CREATE TABLE hvr_line_settings (
  environment text PRIMARY KEY REFERENCES hvr_instances(environment),
  enabled boolean NOT NULL DEFAULT false,
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE hvr_line_links (
  environment text NOT NULL REFERENCES hvr_instances(environment),
  user_id text NOT NULL,
  code_hash text NOT NULL,
  expires_at timestamptz NOT NULL,
  candidate_id text,
  PRIMARY KEY(environment,user_id),
  UNIQUE(environment,code_hash)
);
CREATE TABLE hvr_line_accounts (
  environment text NOT NULL REFERENCES hvr_instances(environment),
  user_id text NOT NULL,
  line_id text NOT NULL,
  display_name text NOT NULL,
  binding uuid NOT NULL DEFAULT gen_random_uuid(),
  enabled boolean NOT NULL DEFAULT false,
  linked_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(environment,user_id),
  UNIQUE(environment,line_id)
);
CREATE TABLE hvr_line_deliveries (
  environment text NOT NULL,
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  operation_id uuid NOT NULL,
  task_id text NOT NULL,
  user_id text NOT NULL,
  line_id text NOT NULL,
  binding uuid NOT NULL,
  summary jsonb NOT NULL,
  message jsonb,
  state text NOT NULL DEFAULT 'pending' CHECK(state IN ('pending','sending','accepted','failed','review','cancelled')),
  attempts integer NOT NULL DEFAULT 0,
  first_attempt_at timestamptz,
  next_attempt_at timestamptz NOT NULL DEFAULT now(),
  lease_until timestamptz,
  claim uuid,
  error_code text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(environment,id),
  UNIQUE(environment,operation_id,user_id),
  FOREIGN KEY(environment,operation_id) REFERENCES hvr_operations(environment,id)
);
CREATE INDEX hvr_line_queue ON hvr_line_deliveries(environment,state,next_attempt_at);

-- The outbox is committed in the SAME transaction as successful task completion.
-- Installing/enabling this feature never backfills existing completed operations.
CREATE FUNCTION hvr_queue_new_task_line() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.action='create' AND NEW.state='completed' AND OLD.state<>'completed'
    AND NEW.result->>'id' IS NOT NULL
    AND EXISTS(SELECT 1 FROM hvr_line_settings WHERE environment=NEW.environment AND enabled)
  THEN
    INSERT INTO hvr_line_deliveries(environment,operation_id,task_id,user_id,line_id,binding,summary)
    SELECT NEW.environment,NEW.id,NEW.result->>'id',a.user_id,a.line_id,a.binding,
      jsonb_build_object('title',NEW.payload->>'title','category',NEW.payload->>'category',
        'priority',NEW.payload->>'priority','dueDate',NEW.payload->>'dueDate','senderId',NEW.user_id)
    FROM hvr_line_accounts a WHERE a.environment=NEW.environment AND a.enabled
    ON CONFLICT(environment,operation_id,user_id) DO NOTHING;
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER hvr_new_task_line AFTER UPDATE OF state ON hvr_operations
  FOR EACH ROW EXECUTE FUNCTION hvr_queue_new_task_line();
