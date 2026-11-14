-- RSVP-only guests may register without a practice password.
ALTER TABLE participants ALTER COLUMN password_hash DROP NOT NULL;
