-- Invalidate existing plaintext session tokens; new logins store SHA-256 hashes.
TRUNCATE login_sessions;
UPDATE participants SET expires_at = 0;

ALTER TABLE recordings
    DROP CONSTRAINT IF EXISTS recordings_participant_id_fkey;
ALTER TABLE recordings
    ADD CONSTRAINT recordings_participant_id_fkey
    FOREIGN KEY (participant_id) REFERENCES participants(id) ON DELETE CASCADE;

ALTER TABLE login_sessions
    DROP CONSTRAINT IF EXISTS login_sessions_participant_id_fkey;
ALTER TABLE login_sessions
    ADD CONSTRAINT login_sessions_participant_id_fkey
    FOREIGN KEY (participant_id) REFERENCES participants(id) ON DELETE CASCADE;

CREATE TABLE IF NOT EXISTS rate_limits (
    bucket TEXT PRIMARY KEY,
    count INTEGER NOT NULL,
    window_start BIGINT NOT NULL
);

CREATE INDEX IF NOT EXISTS recordings_participant ON recordings(participant_id);
