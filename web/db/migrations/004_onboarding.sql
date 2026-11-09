-- Workflow detail is stored in Neon; Tasks and its ownership remain in Airtable.
CREATE TABLE hvr_workflows (
  environment text NOT NULL REFERENCES hvr_instances(environment),
  resource text NOT NULL,
  version integer NOT NULL CHECK (version > 0),
  payload jsonb NOT NULL,
  operation_key text NOT NULL,
  PRIMARY KEY (environment, resource)
);
CREATE TABLE hvr_workflow_history (
  environment text NOT NULL,
  resource text NOT NULL,
  version integer NOT NULL,
  operation_key text NOT NULL,
  actor_id text NOT NULL,
  actor_name text NOT NULL,
  summary text NOT NULL,
  payload jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY (environment, resource, version),
  UNIQUE (environment, operation_key),
  FOREIGN KEY (environment, resource) REFERENCES hvr_workflows(environment, resource)
);
