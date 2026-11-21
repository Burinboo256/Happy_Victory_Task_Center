-- Control plane only. Slugs remain stable when display names change.
ALTER TABLE hvr_workspaces ADD COLUMN slug text;
CREATE UNIQUE INDEX hvr_workspaces_slug ON hvr_workspaces(environment,slug);

CREATE FUNCTION hvr_assign_workspace_slug() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  stem text;
  candidate text;
  suffix integer := 1;
  taken boolean;
BEGIN
  IF TG_OP='UPDATE' AND NEW.slug IS NOT NULL THEN RETURN NEW; END IF;
  stem := trim(both '-' from left(regexp_replace(lower(coalesce(nullif(NEW.slug,''),NEW.name)), '[^a-z0-9]+', '-', 'g'), 48));
  IF stem='' THEN stem := 'space-' || replace(NEW.id::text,'-',''); END IF;
  IF stem=ANY(ARRAY['api','login','register','spaces','tasks','forms','local','inbox','followups','calendar','reports','team','history','notifications','assets','robots','sitemap','favicon']) THEN
    stem := 'space-' || stem;
  END IF;
  PERFORM pg_advisory_xact_lock(hashtext(TG_TABLE_SCHEMA || ':' || NEW.environment || ':space-slug'));
  candidate := stem;
  LOOP
    EXECUTE format('SELECT EXISTS(SELECT 1 FROM %I.hvr_workspaces WHERE environment=$1 AND slug=$2 AND id<>$3)',TG_TABLE_SCHEMA)
      INTO taken USING NEW.environment,candidate,NEW.id;
    EXIT WHEN NOT taken;
    suffix := suffix+1;
    candidate := stem || '-' || suffix::text;
  END LOOP;
  NEW.slug := candidate;
  RETURN NEW;
END $$;
CREATE TRIGGER hvr_workspace_slug BEFORE INSERT OR UPDATE OF slug ON hvr_workspaces
  FOR EACH ROW EXECUTE FUNCTION hvr_assign_workspace_slug();
DO $$
DECLARE row_record record;
BEGIN
  FOR row_record IN SELECT environment,id FROM hvr_workspaces ORDER BY created_at,id LOOP
    UPDATE hvr_workspaces SET slug=NULL WHERE environment=row_record.environment AND id=row_record.id;
  END LOOP;
END $$;
ALTER TABLE hvr_workspaces ALTER COLUMN slug SET NOT NULL;
ALTER TABLE hvr_workspaces ADD CONSTRAINT hvr_workspace_slug_format
  CHECK (length(slug)<=64 AND slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$');
