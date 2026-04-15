-- Campaign performance snapshots — one row per campaign per day.
-- Used for historical trend analysis without hitting Meta API.

CREATE TABLE IF NOT EXISTS campaign_snapshots (
  id            bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  campaign_id   text NOT NULL,
  business_id   uuid NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  snapshot_date date NOT NULL DEFAULT CURRENT_DATE,
  name          text,
  status        text,
  objective     text,
  daily_budget  numeric DEFAULT 0,
  lifetime_budget numeric DEFAULT 0,
  spend_7d      numeric DEFAULT 0,
  clicks_7d     integer DEFAULT 0,
  impressions_7d integer DEFAULT 0,
  cpc_7d        numeric DEFAULT 0,
  ctr_7d        numeric DEFAULT 0,
  created_at    timestamptz DEFAULT now(),

  UNIQUE (campaign_id, snapshot_date)
);

CREATE INDEX IF NOT EXISTS idx_campaign_snapshots_business
  ON campaign_snapshots (business_id, snapshot_date DESC);

CREATE INDEX IF NOT EXISTS idx_campaign_snapshots_campaign
  ON campaign_snapshots (campaign_id, snapshot_date DESC);
