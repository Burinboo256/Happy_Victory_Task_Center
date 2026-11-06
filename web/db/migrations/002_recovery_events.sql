CREATE TABLE hvr_recovery_events (
  event_id uuid PRIMARY KEY,
  environment text NOT NULL,
  operation_id uuid NOT NULL,
  action text NOT NULL CHECK (action IN ('mark-stopped', 'reconcile')),
  operator_label text NOT NULL,
  evidence_ref text NOT NULL,
  confirmed_steps jsonb NOT NULL DEFAULT '[]',
  from_state text NOT NULL,
  to_state text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  FOREIGN KEY (environment, operation_id) REFERENCES hvr_operations(environment, id)
);
CREATE INDEX hvr_recovery_events_operation ON hvr_recovery_events(environment, operation_id);
