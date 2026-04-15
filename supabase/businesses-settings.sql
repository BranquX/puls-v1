ALTER TABLE businesses ADD COLUMN IF NOT EXISTS brand_logo text;
ALTER TABLE businesses ADD COLUMN IF NOT EXISTS brand_colors jsonb DEFAULT '{}';
ALTER TABLE businesses ADD COLUMN IF NOT EXISTS brand_font text;
ALTER TABLE businesses ADD COLUMN IF NOT EXISTS brand_tone text[];
ALTER TABLE businesses ADD COLUMN IF NOT EXISTS brand_avoid text;
ALTER TABLE businesses ADD COLUMN IF NOT EXISTS target_age_min integer DEFAULT 18;
ALTER TABLE businesses ADD COLUMN IF NOT EXISTS target_age_max integer DEFAULT 65;
ALTER TABLE businesses ADD COLUMN IF NOT EXISTS target_gender text DEFAULT 'all';
ALTER TABLE businesses ADD COLUMN IF NOT EXISTS target_geo text;
ALTER TABLE businesses ADD COLUMN IF NOT EXISTS competitors jsonb DEFAULT '[]';
ALTER TABLE businesses ADD COLUMN IF NOT EXISTS brand_differentiator text;
ALTER TABLE businesses ADD COLUMN IF NOT EXISTS phone text;
ALTER TABLE businesses ADD COLUMN IF NOT EXISTS address text;
ALTER TABLE businesses ADD COLUMN IF NOT EXISTS description text;

