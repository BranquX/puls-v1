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

ALTER TABLE media_library DISABLE ROW LEVEL SECURITY;

