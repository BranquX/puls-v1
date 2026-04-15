CREATE TABLE IF NOT EXISTS recommendations_cache (
  business_id uuid PRIMARY KEY REFERENCES businesses(id),
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  updated_at timestamp DEFAULT now()
);

ALTER TABLE recommendations_cache DISABLE ROW LEVEL SECURITY;

