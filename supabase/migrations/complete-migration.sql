-- ============================================================
-- AdChat — Complete Supabase Migration (idempotent)
-- Safe to run multiple times. Run in Supabase SQL Editor.
-- Order matters: businesses → dependents.
-- ============================================================

-- ============================================================
-- 1. businesses
-- ============================================================
CREATE TABLE IF NOT EXISTS businesses (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  name text NOT NULL,
  industry text,
  website text,
  meta_account_id text,
  google_account_id text,
  created_at timestamp DEFAULT now()
);

-- Auth link
ALTER TABLE businesses ADD COLUMN IF NOT EXISTS user_id uuid REFERENCES auth.users(id);
CREATE INDEX IF NOT EXISTS idx_businesses_user_id ON businesses (user_id);

-- Meta OAuth
ALTER TABLE businesses ADD COLUMN IF NOT EXISTS meta_access_token text;
ALTER TABLE businesses ADD COLUMN IF NOT EXISTS meta_user_id text;
ALTER TABLE businesses ADD COLUMN IF NOT EXISTS meta_token_expires_at timestamp;
ALTER TABLE businesses ADD COLUMN IF NOT EXISTS meta_ad_account_ids jsonb DEFAULT '[]'::jsonb;
ALTER TABLE businesses ADD COLUMN IF NOT EXISTS meta_page_ids jsonb DEFAULT '[]'::jsonb;
ALTER TABLE businesses ADD COLUMN IF NOT EXISTS meta_instagram_ids jsonb DEFAULT '[]'::jsonb;
ALTER TABLE businesses ADD COLUMN IF NOT EXISTS meta_pixel_ids jsonb DEFAULT '[]'::jsonb;

-- Selected assets
ALTER TABLE businesses ADD COLUMN IF NOT EXISTS selected_ad_account_id text;
ALTER TABLE businesses ADD COLUMN IF NOT EXISTS selected_page_id text;
ALTER TABLE businesses ADD COLUMN IF NOT EXISTS selected_instagram_id text;
ALTER TABLE businesses ADD COLUMN IF NOT EXISTS selected_pixel_id text;

-- Branding / profile (brand kit)
ALTER TABLE businesses ADD COLUMN IF NOT EXISTS brand_logo text;
ALTER TABLE businesses ADD COLUMN IF NOT EXISTS brand_colors jsonb DEFAULT '{}'::jsonb;
ALTER TABLE businesses ADD COLUMN IF NOT EXISTS brand_font text;
ALTER TABLE businesses ADD COLUMN IF NOT EXISTS brand_tone text[];
ALTER TABLE businesses ADD COLUMN IF NOT EXISTS brand_avoid text;
ALTER TABLE businesses ADD COLUMN IF NOT EXISTS brand_differentiator text;
ALTER TABLE businesses ADD COLUMN IF NOT EXISTS target_age_min integer DEFAULT 18;
ALTER TABLE businesses ADD COLUMN IF NOT EXISTS target_age_max integer DEFAULT 65;
ALTER TABLE businesses ADD COLUMN IF NOT EXISTS target_gender text DEFAULT 'all';
ALTER TABLE businesses ADD COLUMN IF NOT EXISTS target_geo text;
ALTER TABLE businesses ADD COLUMN IF NOT EXISTS competitors jsonb DEFAULT '[]'::jsonb;
ALTER TABLE businesses ADD COLUMN IF NOT EXISTS phone text;
ALTER TABLE businesses ADD COLUMN IF NOT EXISTS address text;
ALTER TABLE businesses ADD COLUMN IF NOT EXISTS description text;

ALTER TABLE businesses DISABLE ROW LEVEL SECURITY;

-- ============================================================
-- 2. campaigns
-- ============================================================
CREATE TABLE IF NOT EXISTS campaigns (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  name text NOT NULL,
  platform text NOT NULL,
  status text DEFAULT 'active',
  budget_daily numeric DEFAULT 0,
  clicks integer DEFAULT 0,
  total_spent numeric DEFAULT 0,
  created_at timestamp DEFAULT now()
);

ALTER TABLE campaigns ADD COLUMN IF NOT EXISTS business_id uuid REFERENCES businesses(id);
ALTER TABLE campaigns ADD COLUMN IF NOT EXISTS user_id uuid REFERENCES auth.users(id);
CREATE INDEX IF NOT EXISTS idx_campaigns_business_id ON campaigns (business_id);
CREATE INDEX IF NOT EXISTS idx_campaigns_user_id ON campaigns (user_id);

-- ============================================================
-- 3. leads + lead_updates
-- ============================================================
CREATE TABLE IF NOT EXISTS leads (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  business_id uuid REFERENCES businesses(id) ON DELETE CASCADE,
  lead_id text UNIQUE NOT NULL,
  form_id text,
  form_name text,
  ad_id text,
  ad_name text,
  adset_id text,
  adset_name text,
  campaign_id text,
  campaign_name text,
  page_id text,
  full_name text,
  first_name text,
  last_name text,
  email text,
  phone text,
  city text,
  custom_fields jsonb DEFAULT '{}'::jsonb,
  ad_image_url text,
  ad_headline text,
  ad_body text,
  status text DEFAULT 'new' CHECK (status IN ('new','contacted','qualified','proposal','won','lost','not_relevant')),
  assigned_to text,
  notes text,
  next_follow_up timestamp,
  deal_value numeric,
  created_at timestamp DEFAULT now(),
  updated_at timestamp DEFAULT now(),
  meta_created_time timestamp
);

CREATE INDEX IF NOT EXISTS idx_leads_business_created ON leads (business_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_leads_status ON leads (business_id, status);

CREATE TABLE IF NOT EXISTS lead_updates (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  lead_id uuid REFERENCES leads(id) ON DELETE CASCADE,
  business_id uuid REFERENCES businesses(id),
  content text NOT NULL,
  type text DEFAULT 'note' CHECK (type IN ('note','call','email','whatsapp','meeting','status_change')),
  created_at timestamp DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_lead_updates_lead ON lead_updates (lead_id);

ALTER TABLE leads ENABLE ROW LEVEL SECURITY;
ALTER TABLE lead_updates ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "users_own_leads" ON leads;
CREATE POLICY "users_own_leads" ON leads
  USING (business_id IN (SELECT id FROM businesses WHERE user_id = auth.uid()));

DROP POLICY IF EXISTS "users_own_lead_updates" ON lead_updates;
CREATE POLICY "users_own_lead_updates" ON lead_updates
  USING (business_id IN (SELECT id FROM businesses WHERE user_id = auth.uid()));

-- ============================================================
-- 4. client_memory
-- ============================================================
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

CREATE INDEX IF NOT EXISTS idx_client_memory_business ON client_memory (business_id);
CREATE INDEX IF NOT EXISTS idx_client_memory_business_category ON client_memory (business_id, category);

ALTER TABLE client_memory ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "client_memory_select_own" ON client_memory;
CREATE POLICY "client_memory_select_own" ON client_memory
  FOR SELECT TO authenticated
  USING (business_id IN (SELECT id FROM businesses WHERE user_id = auth.uid()));

DROP POLICY IF EXISTS "client_memory_insert_own" ON client_memory;
CREATE POLICY "client_memory_insert_own" ON client_memory
  FOR INSERT TO authenticated
  WITH CHECK (business_id IN (SELECT id FROM businesses WHERE user_id = auth.uid()));

DROP POLICY IF EXISTS "client_memory_update_own" ON client_memory;
CREATE POLICY "client_memory_update_own" ON client_memory
  FOR UPDATE TO authenticated
  USING (business_id IN (SELECT id FROM businesses WHERE user_id = auth.uid()))
  WITH CHECK (business_id IN (SELECT id FROM businesses WHERE user_id = auth.uid()));

-- ============================================================
-- 5. media_library
-- ============================================================
CREATE TABLE IF NOT EXISTS media_library (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  business_id uuid REFERENCES businesses(id),
  user_id uuid REFERENCES auth.users(id),
  image_base64 text NOT NULL,
  mime_type text DEFAULT 'image/png',
  title text,
  prompt text,
  agent text DEFAULT 'maya',
  campaign_context text,
  created_at timestamp DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_media_library_business ON media_library (business_id, created_at DESC);

ALTER TABLE media_library DISABLE ROW LEVEL SECURITY;

-- ============================================================
-- 6. alerts
-- ============================================================
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

CREATE INDEX IF NOT EXISTS idx_alerts_business_created ON alerts (business_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_alerts_business_unread ON alerts (business_id)
  WHERE dismissed_at IS NULL AND read_at IS NULL;

ALTER TABLE alerts ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "alerts_select_own" ON alerts;
CREATE POLICY "alerts_select_own" ON alerts
  FOR SELECT TO authenticated
  USING (business_id IN (SELECT id FROM businesses WHERE user_id = auth.uid()));

DROP POLICY IF EXISTS "alerts_update_own" ON alerts;
CREATE POLICY "alerts_update_own" ON alerts
  FOR UPDATE TO authenticated
  USING (business_id IN (SELECT id FROM businesses WHERE user_id = auth.uid()))
  WITH CHECK (business_id IN (SELECT id FROM businesses WHERE user_id = auth.uid()));

-- ============================================================
-- 7. proactive_messages
-- ============================================================
CREATE TABLE IF NOT EXISTS proactive_messages (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  business_id uuid NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  type text NOT NULL DEFAULT 'weekly_report',
  title text NOT NULL,
  body text NOT NULL,
  meta jsonb DEFAULT '{}'::jsonb,
  read_at timestamp,
  created_at timestamp DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_proactive_messages_business ON proactive_messages (business_id);

ALTER TABLE proactive_messages ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "users_own_proactive_messages" ON proactive_messages;
CREATE POLICY "users_own_proactive_messages" ON proactive_messages
  USING (business_id IN (SELECT id FROM businesses WHERE user_id = auth.uid()));

-- ============================================================
-- 8. recommendations_cache
-- ============================================================
CREATE TABLE IF NOT EXISTS recommendations_cache (
  business_id uuid PRIMARY KEY REFERENCES businesses(id) ON DELETE CASCADE,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  updated_at timestamp DEFAULT now()
);

-- If table existed with a different column shape, ensure payload exists
ALTER TABLE recommendations_cache ADD COLUMN IF NOT EXISTS payload jsonb NOT NULL DEFAULT '{}'::jsonb;
ALTER TABLE recommendations_cache ADD COLUMN IF NOT EXISTS updated_at timestamp DEFAULT now();

ALTER TABLE recommendations_cache DISABLE ROW LEVEL SECURITY;

-- ============================================================
-- 9. campaign_snapshots
-- ============================================================
CREATE TABLE IF NOT EXISTS campaign_snapshots (
  id              bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  campaign_id     text NOT NULL,
  business_id     uuid NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  snapshot_date   date NOT NULL DEFAULT CURRENT_DATE,
  name            text,
  status          text,
  objective       text,
  daily_budget    numeric DEFAULT 0,
  lifetime_budget numeric DEFAULT 0,
  spend_7d        numeric DEFAULT 0,
  clicks_7d       integer DEFAULT 0,
  impressions_7d  integer DEFAULT 0,
  cpc_7d          numeric DEFAULT 0,
  ctr_7d          numeric DEFAULT 0,
  created_at      timestamptz DEFAULT now(),
  UNIQUE (campaign_id, snapshot_date)
);

CREATE INDEX IF NOT EXISTS idx_campaign_snapshots_business
  ON campaign_snapshots (business_id, snapshot_date DESC);
CREATE INDEX IF NOT EXISTS idx_campaign_snapshots_campaign
  ON campaign_snapshots (campaign_id, snapshot_date DESC);

-- ============================================================
-- 10. chat_sessions  (NEW — no SQL file existed previously)
-- ============================================================
CREATE TABLE IF NOT EXISTS chat_sessions (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  business_id uuid NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  user_id uuid REFERENCES auth.users(id) ON DELETE CASCADE,
  title text NOT NULL DEFAULT 'שיחה חדשה',
  agent text DEFAULT 'dana',
  messages jsonb DEFAULT '[]'::jsonb,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_chat_sessions_business_updated
  ON chat_sessions (business_id, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_chat_sessions_user
  ON chat_sessions (user_id);

ALTER TABLE chat_sessions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "chat_sessions_select_own" ON chat_sessions;
CREATE POLICY "chat_sessions_select_own" ON chat_sessions
  FOR SELECT TO authenticated
  USING (business_id IN (SELECT id FROM businesses WHERE user_id = auth.uid()));

DROP POLICY IF EXISTS "chat_sessions_insert_own" ON chat_sessions;
CREATE POLICY "chat_sessions_insert_own" ON chat_sessions
  FOR INSERT TO authenticated
  WITH CHECK (business_id IN (SELECT id FROM businesses WHERE user_id = auth.uid()));

DROP POLICY IF EXISTS "chat_sessions_update_own" ON chat_sessions;
CREATE POLICY "chat_sessions_update_own" ON chat_sessions
  FOR UPDATE TO authenticated
  USING (business_id IN (SELECT id FROM businesses WHERE user_id = auth.uid()))
  WITH CHECK (business_id IN (SELECT id FROM businesses WHERE user_id = auth.uid()));

DROP POLICY IF EXISTS "chat_sessions_delete_own" ON chat_sessions;
CREATE POLICY "chat_sessions_delete_own" ON chat_sessions
  FOR DELETE TO authenticated
  USING (business_id IN (SELECT id FROM businesses WHERE user_id = auth.uid()));

-- ============================================================
-- Done. Verify with:
--   select table_name from information_schema.tables
--   where table_schema = 'public' order by table_name;
-- ============================================================
