-- A separate OA namespace: notification bindings never grant AI access.
CREATE TABLE hvr_ai_links (
  environment text NOT NULL REFERENCES hvr_instances(environment),
  user_id text NOT NULL,
  code_hash text NOT NULL,
  expires_at timestamptz NOT NULL,
  candidate_id text,
  PRIMARY KEY(environment,user_id),
  UNIQUE(environment,code_hash)
);
CREATE TABLE hvr_ai_accounts (
  environment text NOT NULL REFERENCES hvr_instances(environment),
  user_id text NOT NULL,
  line_id text NOT NULL,
  display_name text NOT NULL,
  binding uuid NOT NULL DEFAULT gen_random_uuid(),
  linked_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(environment,user_id),
  UNIQUE(environment,line_id)
);
CREATE TABLE hvr_ai_events (
  environment text NOT NULL REFERENCES hvr_instances(environment),
  event_id text NOT NULL,
  line_id text NOT NULL,
  ticket_hash text NOT NULL,
  reply_token text,
  user_id text,
  role text,
  binding uuid,
  task_ids jsonb NOT NULL DEFAULT '[]',
  direct_answer text,
  fallback_answer text NOT NULL,
  state text NOT NULL DEFAULT 'preparing' CHECK(state IN ('preparing','ready','sending','sent','failed')),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(environment,event_id),
  UNIQUE(environment,ticket_hash)
);
CREATE INDEX hvr_ai_recent ON hvr_ai_events(environment,line_id,created_at);
