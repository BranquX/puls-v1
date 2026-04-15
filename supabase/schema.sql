-- סכמת "סביבת עסק" — להריץ ב-Supabase SQL Editor.
-- דורש שטבלת campaigns כבר קיימת (ראה campaigns.sql אם צריך ליצור אותה קודם).

CREATE TABLE IF NOT EXISTS businesses (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  name text NOT NULL,
  industry text,
  website text,
  meta_account_id text,
  google_account_id text,
  created_at timestamp DEFAULT now()
);

ALTER TABLE campaigns
  ADD COLUMN IF NOT EXISTS business_id uuid REFERENCES businesses(id);

CREATE INDEX IF NOT EXISTS idx_campaigns_business_id ON campaigns (business_id);

-- OAuth Meta (אל תחשוף meta_access_token ללקוח ב-select)
ALTER TABLE businesses
  ADD COLUMN IF NOT EXISTS meta_access_token text;

ALTER TABLE businesses
  ADD COLUMN IF NOT EXISTS meta_user_id text;

-- נכסי Meta לאחר OAuth (מערכי מזהים ב-jsonb)
ALTER TABLE businesses ADD COLUMN IF NOT EXISTS meta_ad_account_ids jsonb DEFAULT '[]';
ALTER TABLE businesses ADD COLUMN IF NOT EXISTS meta_page_ids jsonb DEFAULT '[]';
ALTER TABLE businesses ADD COLUMN IF NOT EXISTS meta_instagram_ids jsonb DEFAULT '[]';
ALTER TABLE businesses ADD COLUMN IF NOT EXISTS meta_pixel_ids jsonb DEFAULT '[]';

-- נכסי עבודה נבחרים (מזהה יחיד לכל סוג)
ALTER TABLE businesses ADD COLUMN IF NOT EXISTS selected_ad_account_id text;
ALTER TABLE businesses ADD COLUMN IF NOT EXISTS selected_page_id text;
ALTER TABLE businesses ADD COLUMN IF NOT EXISTS selected_instagram_id text;
ALTER TABLE businesses ADD COLUMN IF NOT EXISTS selected_pixel_id text;

-- שיוך למשתמש Supabase Auth
ALTER TABLE businesses ADD COLUMN IF NOT EXISTS user_id uuid REFERENCES auth.users(id);
CREATE INDEX IF NOT EXISTS idx_businesses_user_id ON businesses (user_id);

ALTER TABLE campaigns ADD COLUMN IF NOT EXISTS user_id uuid REFERENCES auth.users(id);
CREATE INDEX IF NOT EXISTS idx_campaigns_user_id ON campaigns (user_id);

-- מאפשר INSERT/UPDATE מהקליינט עם anon key בלי מדיניות RLS (לפיתוח; בפרודקשן מומלץ RLS + policies)
ALTER TABLE businesses DISABLE ROW LEVEL SECURITY;
