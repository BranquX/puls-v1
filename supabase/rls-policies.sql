-- Row Level Security — להריץ ב-Supabase SQL Editor אחרי schema.sql / campaigns.sql.
-- דורש: עמודות user_id על businesses ו-campaigns, והתחברות עם JWT (authenticated).
--
-- לפני הרצה: הסר השבתת RLS אם הוגדרה בפיתוח:
--   ALTER TABLE businesses ENABLE ROW LEVEL SECURITY;
-- (השורה הבאה מפעילה RLS על שתי הטבלאות.)

ALTER TABLE businesses ENABLE ROW LEVEL SECURITY;
ALTER TABLE campaigns ENABLE ROW LEVEL SECURITY;

-- =========================
-- businesses
-- =========================

DROP POLICY IF EXISTS "businesses_select_own" ON businesses;
DROP POLICY IF EXISTS "businesses_insert_own" ON businesses;
DROP POLICY IF EXISTS "businesses_update_own" ON businesses;
DROP POLICY IF EXISTS "businesses_delete_own" ON businesses;

-- קריאה: רק עסקים ששייכים למשתמש המחובר
CREATE POLICY "businesses_select_own"
  ON businesses
  FOR SELECT
  TO authenticated
  USING (user_id = auth.uid());

-- יצירה: חובה לשייך את השורה למשתמש הנוכחי
CREATE POLICY "businesses_insert_own"
  ON businesses
  FOR INSERT
  TO authenticated
  WITH CHECK (user_id = auth.uid());

-- עדכון: רק רשומות משלך; אי אפשר להעביר ל-user אחר
CREATE POLICY "businesses_update_own"
  ON businesses
  FOR UPDATE
  TO authenticated
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

-- מחיקה: רק עסק משלך
CREATE POLICY "businesses_delete_own"
  ON businesses
  FOR DELETE
  TO authenticated
  USING (user_id = auth.uid());

-- =========================
-- campaigns
-- =========================

DROP POLICY IF EXISTS "campaigns_select_own" ON campaigns;
DROP POLICY IF EXISTS "campaigns_insert_own" ON campaigns;
DROP POLICY IF EXISTS "campaigns_update_own" ON campaigns;
DROP POLICY IF EXISTS "campaigns_delete_own" ON campaigns;

-- קריאה: לפי user_id, או קמפיין הקשור לעסק שלך (תאימות לשורות ישנות בלי user_id)
CREATE POLICY "campaigns_select_own"
  ON campaigns
  FOR SELECT
  TO authenticated
  USING (
    user_id = auth.uid()
    OR business_id IN (
      SELECT id FROM businesses WHERE user_id = auth.uid()
    )
  );

-- יצירה: user_id חייב להיות שלך והעסק חייב להיות שלך
CREATE POLICY "campaigns_insert_own"
  ON campaigns
  FOR INSERT
  TO authenticated
  WITH CHECK (
    user_id = auth.uid()
    AND business_id IN (
      SELECT id FROM businesses WHERE user_id = auth.uid()
    )
  );

-- עדכון: רק קמפיינים שלך; אחרי עדכון עדיין שייך אליך ולעסק שלך
CREATE POLICY "campaigns_update_own"
  ON campaigns
  FOR UPDATE
  TO authenticated
  USING (
    user_id = auth.uid()
    OR business_id IN (
      SELECT id FROM businesses WHERE user_id = auth.uid()
    )
  )
  WITH CHECK (
    user_id = auth.uid()
    AND business_id IN (
      SELECT id FROM businesses WHERE user_id = auth.uid()
    )
  );

-- מחיקה: קמפיין משויך אליך או לעסק שלך
CREATE POLICY "campaigns_delete_own"
  ON campaigns
  FOR DELETE
  TO authenticated
  USING (
    user_id = auth.uid()
    OR business_id IN (
      SELECT id FROM businesses WHERE user_id = auth.uid()
    )
  );

-- =========================
-- הערות
-- =========================
-- • anon: אין policies — ללא JWT אין גישה לטבלאות (מתאים לאפליקציה שדורשת התחברות).
-- • service_role (שרת / Edge Functions): עוקף RLS — מתאים ל-server.js עם מפתח service.
-- • שורות עם user_id NULL לא ייראו/ייעודכנו ע"י authenticated — להשלים נתונים או migration.
