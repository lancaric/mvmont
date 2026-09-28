CREATE TABLE contacts (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  email TEXT NOT NULL,
  phone TEXT NOT NULL,
  service TEXT NOT NULL,
  message TEXT NOT NULL,
  created_at TEXT NOT NULL,
  email_status TEXT NOT NULL DEFAULT 'pending',
  company_email_status TEXT NOT NULL DEFAULT 'pending',
  customer_email_status TEXT NOT NULL DEFAULT 'pending'
);
CREATE INDEX contacts_created_at ON contacts(created_at);
CREATE TABLE gallery (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  category TEXT NOT NULL CHECK(category IN ('frameless','framed','shutters','blinds','terraces','railings','screens')),
  image_url TEXT NOT NULL,
  r2_key TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX gallery_created_at ON gallery(created_at);
-- D1 commits and R2 deletion are not one transaction. Retain failed cleanup tasks.
CREATE TABLE r2_cleanup (r2_key TEXT PRIMARY KEY, created_at TEXT NOT NULL);
