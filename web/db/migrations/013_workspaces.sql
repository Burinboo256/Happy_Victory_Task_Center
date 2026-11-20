-- Control plane only. Existing operational data stays in public for the RINLYN space.
CREATE TABLE hvr_workspace_control (
  environment text PRIMARY KEY REFERENCES hvr_instances(environment),
  fingerprint text NOT NULL
);
CREATE TABLE hvr_workspace_setups (
  environment text NOT NULL REFERENCES hvr_instances(environment),
  id uuid NOT NULL,
  base_id text NOT NULL,
  state text NOT NULL CHECK (state IN ('review','complete')),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY(environment,id),
  UNIQUE(environment,base_id)
);
CREATE TABLE hvr_workspaces (
  environment text NOT NULL REFERENCES hvr_instances(environment),
  id uuid NOT NULL,
  name text NOT NULL CHECK (length(name) BETWEEN 1 AND 80),
  schema_name text NOT NULL CHECK (schema_name='public' OR schema_name ~ '^hvr_ws_[a-f0-9]{32}$'),
  base_id text NOT NULL,
  control_id text NOT NULL,
  credentials text,
  active boolean NOT NULL DEFAULT true,
  is_default boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  last_drained_at timestamptz NOT NULL DEFAULT 'epoch',
  PRIMARY KEY(environment,id),
  UNIQUE(environment,base_id),
  UNIQUE(environment,control_id),
  UNIQUE(schema_name),
  CHECK ((is_default AND credentials IS NULL AND schema_name='public') OR
         (NOT is_default AND credentials IS NOT NULL AND schema_name<>'public'))
);
CREATE UNIQUE INDEX hvr_workspaces_default ON hvr_workspaces(environment) WHERE is_default;
CREATE TABLE hvr_workspace_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  environment text NOT NULL,
  workspace_id uuid NOT NULL,
  actor text NOT NULL,
  action text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  FOREIGN KEY(environment,workspace_id) REFERENCES hvr_workspaces(environment,id)
);
CREATE TABLE hvr_workspace_line_codes (
  environment text NOT NULL,
  code_hash text NOT NULL,
  kind text NOT NULL CHECK(kind IN ('ai','notifications')),
  workspace_id uuid NOT NULL,
  expires_at timestamptz NOT NULL,
  PRIMARY KEY(environment,kind,code_hash),
  FOREIGN KEY(environment,workspace_id) REFERENCES hvr_workspaces(environment,id)
);
CREATE TABLE hvr_workspace_line_routes (
  environment text NOT NULL,
  line_id text NOT NULL,
  workspace_id uuid NOT NULL,
  binding uuid NOT NULL,
  PRIMARY KEY(environment,line_id),
  FOREIGN KEY(environment,workspace_id) REFERENCES hvr_workspaces(environment,id)
);
CREATE TABLE hvr_workspace_ai_tickets (
  environment text NOT NULL,
  ticket_hash text NOT NULL,
  workspace_id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY(environment,ticket_hash),
  FOREIGN KEY(environment,workspace_id) REFERENCES hvr_workspaces(environment,id)
);
CREATE TABLE hvr_workspace_ai_events (
  environment text NOT NULL,
  event_id text NOT NULL,
  workspace_id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY(environment,event_id),
  FOREIGN KEY(environment,workspace_id) REFERENCES hvr_workspaces(environment,id)
);
