CREATE INDEX IF NOT EXISTS `event_log_session_type_sequence_idx` ON `event_log` (`session_id`,`event_type`,`sequence`);
