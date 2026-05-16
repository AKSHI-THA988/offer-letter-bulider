-- OfferFlow Database Schema (PostgreSQL)
-- Run: psql -U postgres -d offerflow -f schema.sql

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- ── Users ───────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS users (
  id            SERIAL PRIMARY KEY,
  name          VARCHAR(100) NOT NULL,
  email         VARCHAR(255) NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  role          VARCHAR(20) NOT NULL DEFAULT 'hr' CHECK (role IN ('admin','hr','viewer')),
  avatar_url    TEXT,
  is_active     BOOLEAN DEFAULT TRUE,
  created_at    TIMESTAMPTZ DEFAULT NOW(),
  updated_at    TIMESTAMPTZ DEFAULT NOW()
);

-- ── Templates ───────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS templates (
  id          SERIAL PRIMARY KEY,
  name        VARCHAR(200) NOT NULL,
  body        TEXT NOT NULL,
  description TEXT,
  is_active   BOOLEAN DEFAULT TRUE,
  uses        INTEGER DEFAULT 0,
  created_by  INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at  TIMESTAMPTZ DEFAULT NOW(),
  updated_at  TIMESTAMPTZ DEFAULT NOW()
);

-- ── Candidates ──────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS candidates (
  id          SERIAL PRIMARY KEY,
  name        VARCHAR(200) NOT NULL,
  email       VARCHAR(255) NOT NULL UNIQUE,
  phone       VARCHAR(30),
  role        VARCHAR(150),
  department  VARCHAR(100),
  status      VARCHAR(20) DEFAULT 'active' CHECK (status IN ('active','inactive','hired','rejected')),
  notes       TEXT,
  created_at  TIMESTAMPTZ DEFAULT NOW(),
  updated_at  TIMESTAMPTZ DEFAULT NOW()
);

-- ── Offers ──────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS offers (
  id            SERIAL PRIMARY KEY,
  candidate_id  INTEGER REFERENCES candidates(id) ON DELETE SET NULL,
  template_id   INTEGER REFERENCES templates(id) ON DELETE SET NULL,
  data          JSONB NOT NULL DEFAULT '{}',
  status        VARCHAR(20) NOT NULL DEFAULT 'draft'
                  CHECK (status IN ('draft','sent','accepted','rejected','expired','revoked')),
  sent_at       TIMESTAMPTZ,
  responded_at  TIMESTAMPTZ,
  expires_at    TIMESTAMPTZ,
  signature     TEXT,
  signed_at     TIMESTAMPTZ,
  signed_ip     VARCHAR(50),
  pdf_url       TEXT,
  created_by    INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at    TIMESTAMPTZ DEFAULT NOW(),
  updated_at    TIMESTAMPTZ DEFAULT NOW()
);

-- ── Offer History / Audit Log ───────────────────────────────
CREATE TABLE IF NOT EXISTS offer_history (
  id          SERIAL PRIMARY KEY,
  offer_id    INTEGER NOT NULL REFERENCES offers(id) ON DELETE CASCADE,
  status      VARCHAR(20) NOT NULL,
  changed_by  VARCHAR(255),
  note        TEXT,
  metadata    JSONB DEFAULT '{}',
  created_at  TIMESTAMPTZ DEFAULT NOW()
);

-- ── Email Logs ──────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS email_logs (
  id          SERIAL PRIMARY KEY,
  offer_id    INTEGER REFERENCES offers(id) ON DELETE SET NULL,
  to_email    VARCHAR(255),
  subject     TEXT,
  status      VARCHAR(20) DEFAULT 'sent',
  error       TEXT,
  sent_at     TIMESTAMPTZ DEFAULT NOW()
);

-- ── Indices ──────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_offers_status ON offers(status);
CREATE INDEX IF NOT EXISTS idx_offers_created_by ON offers(created_by);
CREATE INDEX IF NOT EXISTS idx_offers_candidate ON offers(candidate_id);
CREATE INDEX IF NOT EXISTS idx_offer_history_offer ON offer_history(offer_id);
CREATE INDEX IF NOT EXISTS idx_candidates_email ON candidates(email);
CREATE INDEX IF NOT EXISTS idx_offers_data_gin ON offers USING GIN (data);

-- ── Triggers: updated_at ─────────────────────────────────────
CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER AS $$
BEGIN NEW.updated_at = NOW(); RETURN NEW; END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_users_updated BEFORE UPDATE ON users FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE TRIGGER trg_templates_updated BEFORE UPDATE ON templates FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE TRIGGER trg_candidates_updated BEFORE UPDATE ON candidates FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE TRIGGER trg_offers_updated BEFORE UPDATE ON offers FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- ── Trigger: increment template uses on offer create ─────────
CREATE OR REPLACE FUNCTION increment_template_uses()
RETURNS TRIGGER AS $$
BEGIN
  IF TG_OP = 'INSERT' AND NEW.template_id IS NOT NULL THEN
    UPDATE templates SET uses = uses + 1 WHERE id = NEW.template_id;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_offer_template_uses
AFTER INSERT ON offers FOR EACH ROW EXECUTE FUNCTION increment_template_uses();

-- ── Seed: default admin user ──────────────────────────────────
-- Password: admin123 (bcrypt hash)
INSERT INTO users (name, email, password_hash, role)
VALUES ('HR Admin', 'admin@offerflow.com', '$2b$12$LQv3c1yqBWVHxkd0LHAkCOYz6TtxMQJqhN8/LewFqcHCGH4KWzMb6', 'admin')
ON CONFLICT (email) DO NOTHING;

-- ── Seed: sample template ─────────────────────────────────────
INSERT INTO templates (name, body, created_by)
SELECT 'Standard Offer Letter',
'Dear {{name}},

We are pleased to offer you the position of <strong>{{position}}</strong> at <strong>{{company}}</strong>.

<strong>Compensation</strong>
Your annual package will be <strong>{{currency}} {{salary}}</strong>, paid monthly.

<strong>Start Date</strong>
We would like you to join us on <strong>{{doj}}</strong> at our {{location}} office, reporting to {{manager}}.

Benefits include: {{benefits}}

This offer includes a {{probation}}-month probation period.

Please confirm your acceptance by <strong>{{deadline}}</strong>.

Warm regards,
HR Team, {{company}}',
id FROM users WHERE email='admin@offerflow.com'
ON CONFLICT DO NOTHING;
