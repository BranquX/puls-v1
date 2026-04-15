-- Production Row Level Security policies
-- Run this AFTER deploying with SUPABASE_SERVICE_ROLE_KEY in server.js

-- businesses: user can only see/edit their own business
ALTER TABLE businesses ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "users_own_business" ON businesses;
CREATE POLICY "users_own_business" ON businesses
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

-- client_memory: user can only see their own memory
ALTER TABLE client_memory ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "users_own_memory" ON client_memory;
CREATE POLICY "users_own_memory" ON client_memory
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

-- campaigns: user can only see their own campaigns
ALTER TABLE campaigns ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "users_own_campaigns" ON campaigns;
CREATE POLICY "users_own_campaigns" ON campaigns
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

-- alerts: user can only see alerts for their own businesses
ALTER TABLE alerts ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "users_own_alerts" ON alerts;
CREATE POLICY "users_own_alerts" ON alerts
  USING (business_id IN (SELECT id FROM businesses WHERE user_id = auth.uid()));

-- chat_sessions: user can only see their own sessions
ALTER TABLE chat_sessions ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "users_own_sessions" ON chat_sessions;
CREATE POLICY "users_own_sessions" ON chat_sessions
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

-- media_library: user can only see their own media
ALTER TABLE media_library ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "users_own_media" ON media_library;
CREATE POLICY "users_own_media" ON media_library
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

-- proactive_messages: user can only see messages for their own businesses
ALTER TABLE proactive_messages ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "users_own_proactive_messages" ON proactive_messages;
CREATE POLICY "users_own_proactive_messages" ON proactive_messages
  USING (business_id IN (SELECT id FROM businesses WHERE user_id = auth.uid()));
