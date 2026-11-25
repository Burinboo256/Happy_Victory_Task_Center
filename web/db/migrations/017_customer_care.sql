CREATE TABLE hvr_care_policies (
  id uuid PRIMARY KEY,
  environment text NOT NULL,
  customer text NOT NULL,
  reference text NOT NULL,
  agent_id text NOT NULL,
  kind text NOT NULL,
  started date NOT NULL,
  ends date,
  closed boolean NOT NULL DEFAULT false,
  UNIQUE (environment, agent_id, reference),
  CHECK (ends IS NULL OR ends >= started)
);
CREATE INDEX hvr_care_owner ON hvr_care_policies(environment, agent_id);
CREATE TABLE hvr_care_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  policy_id uuid NOT NULL REFERENCES hvr_care_policies(id),
  kind text NOT NULL,
  due date NOT NULL,
  recipient text NOT NULL CHECK (recipient IN ('team','agent')),
  note text NOT NULL DEFAULT '',
  outcome text,
  result_note text,
  completed_at timestamptz,
  completed_by text
);
CREATE INDEX hvr_care_queue ON hvr_care_events(policy_id, due);
CREATE TABLE hvr_care_operations (
  environment text NOT NULL,
  actor text NOT NULL,
  id uuid NOT NULL,
  payload_hash text NOT NULL,
  PRIMARY KEY(environment, actor, id)
);
