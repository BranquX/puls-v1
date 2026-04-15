-- Proactive messages (weekly reports, automated insights)
CREATE TABLE IF NOT EXISTS proactive_messages (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  business_id uuid NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  type text NOT NULL DEFAULT 'weekly_report',
  title text NOT NULL,
  body text NOT NULL,
  meta jsonb DEFAULT '{}',
  read_at timestamp,
  created_at timestamp DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_proactive_messages_business ON proactive_messages(business_id);

ALTER TABLE proactive_messages ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "users_own_proactive_messages" ON proactive_messages;
CREATE POLICY "users_own_proactive_messages" ON proactive_messages
  USING (business_id IN (SELECT id FROM businesses WHERE user_id = auth.uid()));
