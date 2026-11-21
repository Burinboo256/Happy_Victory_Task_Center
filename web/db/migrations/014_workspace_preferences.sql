-- Control plane only: browser preference, never an authorization grant or LINE route.
CREATE TABLE hvr_workspace_preferences (
  environment text NOT NULL,
  user_id text NOT NULL,
  subject text NOT NULL,
  workspace_id uuid NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY(environment,user_id),
  FOREIGN KEY(environment,workspace_id) REFERENCES hvr_workspaces(environment,id) ON DELETE CASCADE
);
