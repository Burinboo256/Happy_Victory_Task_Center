CREATE TABLE hvr_ai_drafts (
  environment text NOT NULL REFERENCES hvr_instances(environment),
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  user_id text NOT NULL,
  line_id text NOT NULL,
  binding uuid NOT NULL,
  role text NOT NULL,
  revision integer NOT NULL DEFAULT 0,
  state text NOT NULL DEFAULT 'collecting'
    CHECK(state IN ('collecting','ready','submitting','completed','cancelled','expired')),
  fields jsonb NOT NULL DEFAULT '{}',
  owner_name text NOT NULL DEFAULT '',
  generation_until timestamptz,
  task_id text,
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL DEFAULT now()+interval '30 minutes',
  PRIMARY KEY(environment,id)
);
CREATE UNIQUE INDEX hvr_ai_one_draft ON hvr_ai_drafts(environment,user_id)
  WHERE state IN ('collecting','ready','submitting');
ALTER TABLE hvr_ai_events ADD COLUMN draft_id uuid;
ALTER TABLE hvr_ai_events ADD COLUMN draft_revision integer;
ALTER TABLE hvr_ai_events ADD COLUMN reply_actions jsonb;
