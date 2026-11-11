ALTER TABLE participants ADD COLUMN IF NOT EXISTS password_hash TEXT;

DELETE FROM login_sessions
WHERE participant_id IN (SELECT id FROM participants WHERE password_hash IS NULL);

DELETE FROM recordings
WHERE participant_id IN (SELECT id FROM participants WHERE password_hash IS NULL);

DELETE FROM participants WHERE password_hash IS NULL;

ALTER TABLE participants ALTER COLUMN password_hash SET NOT NULL;

DROP INDEX IF EXISTS participants_email;
CREATE UNIQUE INDEX IF NOT EXISTS participants_email_unique ON participants(email);
