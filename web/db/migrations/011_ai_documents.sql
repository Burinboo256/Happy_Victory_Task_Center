ALTER TABLE hvr_ai_memory_turns ADD COLUMN document_refs jsonb NOT NULL DEFAULT '[]' CHECK (jsonb_typeof(document_refs)='array');
ALTER TABLE hvr_ai_events ADD COLUMN document_context jsonb;
