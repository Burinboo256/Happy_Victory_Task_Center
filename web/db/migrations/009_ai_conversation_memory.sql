CREATE TABLE hvr_ai_memory_sessions (
  environment text NOT NULL,
  user_id text NOT NULL,
  binding uuid NOT NULL,
  role text NOT NULL,
  epoch uuid NOT NULL DEFAULT gen_random_uuid(),
  PRIMARY KEY(environment,user_id),
  UNIQUE(environment,user_id,epoch),
  FOREIGN KEY(environment,user_id) REFERENCES hvr_ai_accounts(environment,user_id) ON DELETE CASCADE
);

CREATE TABLE hvr_ai_memory_turns (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  environment text NOT NULL,
  user_id text NOT NULL,
  epoch uuid NOT NULL,
  event_id text NOT NULL,
  question text NOT NULL CHECK(length(question)<=2000),
  answer text CHECK(length(answer)<=4500),
  task_ids jsonb NOT NULL,
  task_refs jsonb NOT NULL,
  focus_ids jsonb NOT NULL DEFAULT '[]',
  expires_at timestamptz NOT NULL DEFAULT clock_timestamp()+interval '30 minutes',
  UNIQUE(environment,event_id),
  FOREIGN KEY(environment,user_id,epoch) REFERENCES hvr_ai_memory_sessions(environment,user_id,epoch) ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX hvr_ai_memory_recent ON hvr_ai_memory_turns(environment,user_id,id DESC);
CREATE INDEX hvr_ai_memory_expiry ON hvr_ai_memory_turns(expires_at);
-- Keep the identifier after memory deletion so a cleared, in-flight answer cannot be sent.
ALTER TABLE hvr_ai_events ADD COLUMN memory_turn_id bigint;
