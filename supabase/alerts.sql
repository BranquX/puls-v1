-- התראות קמפיין (נוצרות ע"י POST /api/check-alerts בשרת).
-- להריץ ב-Supabase SQL Editor אחרי schema.sql.

CREATE TABLE IF NOT EXISTS alerts (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  business_id uuid NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  user_id uuid REFERENCES auth.users(id),
  campaign_id text NOT NULL,
  campaign_name text,
  alert_type text NOT NULL,
  severity text NOT NULL DEFAULT 'normal' CHECK (severity IN ('normal', 'urgent')),
  title text NOT NULL,
  body text NOT NULL,
  context_for_chat text,
  meta jsonb DEFAULT '{}'::jsonb,
  created_at timestamptz DEFAULT now(),
  read_at timestamptz,
  dismissed_at timestamptz
);

CREATE INDEX IF NOT EXISTS idx_alerts_business_created
  ON alerts (business_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_alerts_business_unread
  ON alerts (business_id)
  WHERE dismissed_at IS NULL AND read_at IS NULL;

ALTER TABLE alerts ENABLE ROW LEVEL SECURITY;

-- קריאה: רק התראות לעסקים של המשתמש
DROP POLICY IF EXISTS "alerts_select_own" ON alerts;
CREATE POLICY "alerts_select_own"
  ON alerts
  FOR SELECT
  TO authenticated
  USING (
    business_id IN (
      SELECT id FROM businesses WHERE user_id = auth.uid()
    )
  );

-- עדכון (סימון נקרא / סגירה): רק עסק שלך
DROP POLICY IF EXISTS "alerts_update_own" ON alerts;
CREATE POLICY "alerts_update_own"
  ON alerts
  FOR UPDATE
  TO authenticated
  USING (
    business_id IN (
      SELECT id FROM businesses WHERE user_id = auth.uid()
    )
  )
  WITH CHECK (
    business_id IN (
      SELECT id FROM businesses WHERE user_id = auth.uid()
    )
  );

-- INSERT רק דרך service_role (שרת) — אין policy ל-authenticated
