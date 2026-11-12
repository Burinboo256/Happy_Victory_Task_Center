CREATE TABLE hvr_documents (
  environment text NOT NULL,
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  import_key text,
  created_by text NOT NULL,
  revision integer NOT NULL DEFAULT 1 CHECK (revision > 0),
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active','paused')),
  current_version uuid,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY(environment,id),
  UNIQUE(environment,import_key)
);
CREATE TABLE hvr_document_versions (
  environment text NOT NULL,
  document_id uuid NOT NULL,
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  created_by text NOT NULL,
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','published','archived')),
  payload jsonb NOT NULL CHECK (jsonb_typeof(payload)='object'),
  reviewed_by text,
  reviewed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY(environment,id),
  UNIQUE(environment,document_id,id),
  FOREIGN KEY(environment,document_id) REFERENCES hvr_documents(environment,id)
);
ALTER TABLE hvr_documents ADD CONSTRAINT hvr_document_current
  FOREIGN KEY(environment,id,current_version) REFERENCES hvr_document_versions(environment,document_id,id);
CREATE UNIQUE INDEX hvr_document_one_published ON hvr_document_versions(environment,document_id) WHERE status='published';
CREATE INDEX hvr_document_versions_by_document ON hvr_document_versions(environment,document_id,created_at DESC);
CREATE TABLE hvr_document_favorites (
  environment text NOT NULL,
  user_id text NOT NULL,
  document_id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY(environment,user_id,document_id),
  FOREIGN KEY(environment,document_id) REFERENCES hvr_documents(environment,id)
);
CREATE TABLE hvr_document_events (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  environment text NOT NULL,
  document_id uuid NOT NULL,
  actor_id text NOT NULL,
  action text NOT NULL,
  before_revision integer,
  after_revision integer NOT NULL,
  version_id uuid,
  details jsonb NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  FOREIGN KEY(environment,document_id) REFERENCES hvr_documents(environment,id)
);
CREATE INDEX hvr_document_events_by_document ON hvr_document_events(environment,document_id,id DESC);
