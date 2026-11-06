CREATE TABLE hvr_instances (
  environment text PRIMARY KEY CHECK (environment IN ('development', 'staging', 'production')),
  base_id text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE hvr_runtime (
  environment text PRIMARY KEY REFERENCES hvr_instances(environment),
  task_writes boolean NOT NULL DEFAULT false,
  jobs boolean NOT NULL DEFAULT false
);
CREATE TABLE hvr_sessions (
  environment text NOT NULL REFERENCES hvr_instances(environment),
  token_hash text NOT NULL,
  user_id text NOT NULL,
  subject text NOT NULL,
  csrf_token text NOT NULL,
  expires_at timestamptz NOT NULL,
  PRIMARY KEY (environment, token_hash)
);
CREATE INDEX hvr_sessions_expiry ON hvr_sessions(expires_at);
CREATE TABLE hvr_identity_bindings (
  environment text NOT NULL REFERENCES hvr_instances(environment),
  user_id text NOT NULL,
  subject text NOT NULL,
  PRIMARY KEY (environment, user_id),
  UNIQUE (environment, subject)
);
CREATE TABLE hvr_oauth (
  environment text NOT NULL REFERENCES hvr_instances(environment),
  state_hash text NOT NULL,
  binding_hash text NOT NULL,
  verifier text NOT NULL,
  nonce text NOT NULL,
  return_to text NOT NULL,
  expires_at timestamptz NOT NULL,
  PRIMARY KEY (environment, state_hash)
);
CREATE TABLE hvr_rate_limits (
  base_id text PRIMARY KEY,
  next_at timestamptz NOT NULL DEFAULT now(),
  blocked_until timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE hvr_operations (
  environment text NOT NULL REFERENCES hvr_instances(environment),
  id uuid NOT NULL,
  user_id text NOT NULL,
  request_id uuid NOT NULL,
  fingerprint text NOT NULL,
  resource text NOT NULL,
  action text NOT NULL,
  payload jsonb NOT NULL,
  steps jsonb NOT NULL DEFAULT '{}',
  state text NOT NULL DEFAULT 'pending' CHECK (state IN ('pending', 'running', 'review', 'completed', 'failed')),
  result jsonb,
  retry_at timestamptz,
  error_code text,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (environment, id),
  UNIQUE (environment, user_id, request_id)
);
CREATE INDEX hvr_operations_recovery ON hvr_operations(environment, state, retry_at);
-- A durable resource reservation survives Function death. It is never released by TTL.
CREATE TABLE hvr_resources (
  environment text NOT NULL,
  resource text NOT NULL,
  operation_id uuid NOT NULL,
  PRIMARY KEY (environment, resource),
  FOREIGN KEY (environment, operation_id) REFERENCES hvr_operations(environment, id)
);
