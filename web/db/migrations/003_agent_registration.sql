ALTER TABLE hvr_oauth ADD COLUMN registration jsonb;
CREATE TABLE hvr_registrations (
  environment text NOT NULL REFERENCES hvr_instances(environment),
  subject text NOT NULL,
  email text NOT NULL,
  profile jsonb NOT NULL,
  state text NOT NULL CHECK (state IN ('writing', 'complete', 'review')),
  user_id text,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY (environment, subject),
  UNIQUE (environment, email)
);
