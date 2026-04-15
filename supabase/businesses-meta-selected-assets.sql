-- Meta selected assets columns
ALTER TABLE businesses ADD COLUMN IF NOT EXISTS selected_page_id text;
ALTER TABLE businesses ADD COLUMN IF NOT EXISTS selected_instagram_id text;

