-- Leads Management tables
-- Run against Supabase SQL editor

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
  custom_fields jsonb DEFAULT '{}',
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

CREATE TABLE IF NOT EXISTS lead_updates (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  lead_id uuid REFERENCES leads(id) ON DELETE CASCADE,
  business_id uuid REFERENCES businesses(id),
  content text NOT NULL,
  type text DEFAULT 'note' CHECK (type IN ('note','call','email','whatsapp','meeting','status_change')),
  created_at timestamp DEFAULT now()
);

ALTER TABLE leads ENABLE ROW LEVEL SECURITY;
ALTER TABLE lead_updates ENABLE ROW LEVEL SECURITY;

CREATE POLICY "users_own_leads" ON leads
  USING (business_id IN (SELECT id FROM businesses WHERE user_id = auth.uid()));

CREATE POLICY "users_own_lead_updates" ON lead_updates
  USING (business_id IN (SELECT id FROM businesses WHERE user_id = auth.uid()));
