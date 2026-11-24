-- Per operational schema. No mode is enabled by this additive migration.
CREATE TABLE hvr_task_storage (
  environment text PRIMARY KEY REFERENCES hvr_instances(environment),
  base_id text NOT NULL,
  mode text NOT NULL DEFAULT 'airtable' CHECK (mode IN ('airtable','neon')),
  imported_at timestamptz,
  imported_hash text,
  activated_at timestamptz
);
CREATE TABLE hvr_task_records (
  environment text NOT NULL REFERENCES hvr_instances(environment),
  kind text NOT NULL CHECK (kind IN ('tasks','updates','followups','notifications')),
  id text NOT NULL CHECK (id ~ '^rec[A-Za-z0-9]{14}$'),
  fields jsonb NOT NULL,
  version bigint NOT NULL DEFAULT 1,
  airtable_id text,
  key_field text NOT NULL,
  key_value text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY(environment,kind,id),
  UNIQUE(environment,kind,key_field,key_value),
  UNIQUE(environment,kind,airtable_id)
);
CREATE INDEX hvr_task_records_agent ON hvr_task_records(environment,kind,(fields->'Agent'->>0));
CREATE INDEX hvr_task_records_parent ON hvr_task_records(environment,kind,(fields->'Task'->>0));
CREATE INDEX hvr_task_records_status ON hvr_task_records(environment,kind,(fields->>'Status'));
CREATE TABLE hvr_airtable_outbox (
  environment text NOT NULL,
  kind text NOT NULL,
  record_id text NOT NULL,
  version bigint NOT NULL,
  fields jsonb NOT NULL,
  state text NOT NULL DEFAULT 'pending' CHECK (state IN ('pending','synced','review')),
  attempts integer NOT NULL DEFAULT 0,
  next_attempt_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  last_synced_at timestamptz,
  error_code text,
  PRIMARY KEY(environment,kind,record_id,version),
  FOREIGN KEY(environment,kind,record_id) REFERENCES hvr_task_records(environment,kind,id)
);
CREATE INDEX hvr_airtable_outbox_due ON hvr_airtable_outbox(environment,state,next_attempt_at);
CREATE TABLE hvr_task_sync_reviews (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  environment text NOT NULL,
  kind text NOT NULL,
  record_id text NOT NULL,
  version bigint NOT NULL,
  evidence text NOT NULL,
  resolution text NOT NULL CHECK(resolution IN ('confirmed','retry')),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
