ALTER TABLE notify_targets ADD CONSTRAINT notify_targets_active_purpose_check CHECK (purpose IN ('content', 'alert')) NOT VALID;
