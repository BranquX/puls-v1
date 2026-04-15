-- הרץ ב-Supabase SQL Editor: Dashboard → SQL → New query

CREATE TABLE campaigns (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  name text NOT NULL,
  platform text NOT NULL,
  status text DEFAULT 'active',
  budget_daily numeric DEFAULT 0,
  clicks integer DEFAULT 0,
  total_spent numeric DEFAULT 0,
  created_at timestamp DEFAULT now()
);

-- לאחר מכן הגדר Row Level Security והרשאות לפי הצורך (למשל anon read/update).
