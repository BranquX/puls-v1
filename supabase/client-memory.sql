-- זיכרון לקוח לסוכני AI (דנה והצוות). להריץ ב-Supabase SQL Editor אחרי schema.sql.

CREATE TABLE IF NOT EXISTS client_memory (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  business_id uuid NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  user_id uuid REFERENCES auth.users(id),
  category text NOT NULL,
  key text NOT NULL,
  value text NOT NULL,
  source text DEFAULT 'onboarding',
  confidence integer DEFAULT 100 CHECK (confidence >= 0 AND confidence <= 100),
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  UNIQUE(business_id, category, key)
);

CREATE INDEX IF NOT EXISTS idx_client_memory_business
  ON client_memory (business_id);

CREATE INDEX IF NOT EXISTS idx_client_memory_business_category
  ON client_memory (business_id, category);

ALTER TABLE client_memory ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "client_memory_select_own" ON client_memory;
CREATE POLICY "client_memory_select_own"
  ON client_memory
  FOR SELECT
  TO authenticated
  USING (
    business_id IN (
      SELECT id FROM businesses WHERE user_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS "client_memory_insert_own" ON client_memory;
CREATE POLICY "client_memory_insert_own"
  ON client_memory
  FOR INSERT
  TO authenticated
  WITH CHECK (
    business_id IN (
      SELECT id FROM businesses WHERE user_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS "client_memory_update_own" ON client_memory;
CREATE POLICY "client_memory_update_own"
  ON client_memory
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

-- INSERT/UPDATE מלא מהשרת (service_role) — ללא policy נוסף
