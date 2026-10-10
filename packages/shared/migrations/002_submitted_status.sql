ALTER TABLE notifications
  DROP CONSTRAINT IF EXISTS notifications_status_check;

ALTER TABLE notifications
  ADD CONSTRAINT notifications_status_check
  CHECK (status IN (
    'pending',
    'queued',
    'processing',
    'submitted',
    'retrying',
    'delivered',
    'dead',
    'cancelled'
  ));
