ALTER TABLE users
  ADD COLUMN IF NOT EXISTS is_erased BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS erased_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ;

CREATE TABLE IF NOT EXISTS user_compliance_profiles (
  user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  legal_name TEXT,
  date_of_birth DATE,
  country_code TEXT NOT NULL DEFAULT 'GB',
  residency_country_code TEXT,
  kyc_status TEXT NOT NULL DEFAULT 'not_started' CHECK (
    kyc_status IN ('not_started', 'pending', 'verified', 'rejected', 'expired')
  ),
  kyc_level TEXT NOT NULL DEFAULT 'basic' CHECK (kyc_level IN ('none', 'basic', 'enhanced')),
  kyc_vendor TEXT,
  kyc_vendor_ref TEXT,
  document_status TEXT NOT NULL DEFAULT 'unsubmitted' CHECK (
    document_status IN ('unsubmitted', 'submitted', 'approved', 'rejected')
  ),
  liveness_status TEXT NOT NULL DEFAULT 'unsubmitted' CHECK (
    liveness_status IN ('unsubmitted', 'pending', 'passed', 'failed')
  ),
  sanctions_status TEXT NOT NULL DEFAULT 'unknown' CHECK (
    sanctions_status IN ('unknown', 'clear', 'watchlist', 'blocked')
  ),
  pep_status TEXT NOT NULL DEFAULT 'unknown' CHECK (
    pep_status IN ('unknown', 'clear', 'flagged')
  ),
  aml_risk_tier TEXT NOT NULL DEFAULT 'medium' CHECK (
    aml_risk_tier IN ('low', 'medium', 'high', 'critical')
  ),
  trading_enabled BOOLEAN NOT NULL DEFAULT FALSE,
  max_single_trade_gbp NUMERIC(12, 2) CHECK (max_single_trade_gbp IS NULL OR max_single_trade_gbp > 0),
  max_daily_volume_gbp NUMERIC(12, 2) CHECK (max_daily_volume_gbp IS NULL OR max_daily_volume_gbp > 0),
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS user_compliance_profiles_country_idx
  ON user_compliance_profiles (country_code, updated_at DESC);

CREATE INDEX IF NOT EXISTS user_compliance_profiles_kyc_idx
  ON user_compliance_profiles (kyc_status, sanctions_status, updated_at DESC);

CREATE TABLE IF NOT EXISTS kyc_cases (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  vendor TEXT NOT NULL,
  vendor_case_ref TEXT,
  status TEXT NOT NULL CHECK (status IN ('created', 'pending', 'verified', 'rejected', 'expired', 'cancelled')),
  kyc_level TEXT NOT NULL DEFAULT 'basic' CHECK (kyc_level IN ('none', 'basic', 'enhanced')),
  required_checks JSONB NOT NULL DEFAULT '[]'::jsonb,
  document_status TEXT NOT NULL DEFAULT 'unsubmitted' CHECK (
    document_status IN ('unsubmitted', 'submitted', 'approved', 'rejected')
  ),
  liveness_status TEXT NOT NULL DEFAULT 'unsubmitted' CHECK (
    liveness_status IN ('unsubmitted', 'pending', 'passed', 'failed')
  ),
  sanctions_status TEXT NOT NULL DEFAULT 'unknown' CHECK (
    sanctions_status IN ('unknown', 'clear', 'watchlist', 'blocked')
  ),
  decision_reason TEXT,
  payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  completed_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS kyc_cases_user_created_idx
  ON kyc_cases (user_id, created_at DESC);

CREATE UNIQUE INDEX IF NOT EXISTS kyc_cases_vendor_ref_idx
  ON kyc_cases (vendor, vendor_case_ref)
  WHERE vendor_case_ref IS NOT NULL;

CREATE TABLE IF NOT EXISTS kyc_verification_events (
  id BIGSERIAL PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  case_id TEXT REFERENCES kyc_cases(id) ON DELETE SET NULL,
  event_type TEXT NOT NULL CHECK (
    event_type IN (
      'session_created',
      'status_updated',
      'document_reviewed',
      'liveness_checked',
      'sanctions_screened',
      'manual_override',
      'webhook_received'
    )
  ),
  status TEXT,
  vendor TEXT,
  vendor_ref TEXT,
  payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  reviewer_user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  ip_address TEXT,
  user_agent TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS kyc_verification_events_user_created_idx
  ON kyc_verification_events (user_id, created_at DESC);

CREATE TABLE IF NOT EXISTS sanctions_screenings (
  id BIGSERIAL PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  provider TEXT NOT NULL,
  screening_ref TEXT,
  status TEXT NOT NULL CHECK (status IN ('clear', 'watchlist', 'blocked', 'error')),
  matched_entities JSONB NOT NULL DEFAULT '[]'::jsonb,
  screened_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS sanctions_screenings_user_screened_idx
  ON sanctions_screenings (user_id, screened_at DESC);

CREATE TABLE IF NOT EXISTS aml_alerts (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  related_user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  market TEXT NOT NULL CHECK (market IN ('co-own', 'auctions', 'wallet')),
  event_type TEXT NOT NULL CHECK (event_type IN ('trade', 'bid', 'deposit', 'withdrawal', 'manual')),
  risk_score NUMERIC(5, 2) NOT NULL CHECK (risk_score >= 0 AND risk_score <= 100),
  risk_level TEXT NOT NULL CHECK (risk_level IN ('low', 'medium', 'high', 'critical')),
  status TEXT NOT NULL CHECK (status IN ('open', 'under_review', 'sar_required', 'sar_filed', 'dismissed')),
  amount_gbp NUMERIC(12, 2) CHECK (amount_gbp IS NULL OR amount_gbp >= 0),
  reference_id TEXT,
  rule_code TEXT,
  notes TEXT,
  context JSONB NOT NULL DEFAULT '{}'::jsonb,
  reviewed_by TEXT REFERENCES users(id) ON DELETE SET NULL,
  reviewed_at TIMESTAMPTZ,
  sar_filed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS aml_alerts_user_created_idx
  ON aml_alerts (user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS aml_alerts_status_created_idx
  ON aml_alerts (status, created_at DESC);

CREATE TABLE IF NOT EXISTS compliance_sar_reports (
  id TEXT PRIMARY KEY,
  alert_id TEXT REFERENCES aml_alerts(id) ON DELETE SET NULL,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  jurisdiction_code TEXT,
  status TEXT NOT NULL CHECK (status IN ('draft', 'submitted', 'acknowledged', 'rejected')),
  narrative TEXT NOT NULL,
  external_report_ref TEXT,
  submitted_by TEXT REFERENCES users(id) ON DELETE SET NULL,
  submitted_at TIMESTAMPTZ,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS compliance_sar_alert_unique_idx
  ON compliance_sar_reports (alert_id)
  WHERE alert_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS compliance_sar_reports_user_created_idx
  ON compliance_sar_reports (user_id, created_at DESC);

CREATE TABLE IF NOT EXISTS jurisdiction_rules (
  id TEXT PRIMARY KEY,
  market TEXT NOT NULL CHECK (market IN ('co-own', 'auctions', 'wallet')),
  scope TEXT NOT NULL CHECK (scope IN ('country', 'region', 'global')),
  scope_code TEXT NOT NULL,
  is_enabled BOOLEAN NOT NULL DEFAULT TRUE,
  min_kyc_level TEXT NOT NULL DEFAULT 'basic' CHECK (min_kyc_level IN ('none', 'basic', 'enhanced')),
  require_sanctions_clear BOOLEAN NOT NULL DEFAULT TRUE,
  max_order_notional_gbp NUMERIC(12, 2) CHECK (max_order_notional_gbp IS NULL OR max_order_notional_gbp > 0),
  max_daily_notional_gbp NUMERIC(12, 2) CHECK (max_daily_notional_gbp IS NULL OR max_daily_notional_gbp > 0),
  max_open_orders INTEGER CHECK (max_open_orders IS NULL OR max_open_orders > 0),
  blocked_reason TEXT,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (market, scope, scope_code)
);

CREATE INDEX IF NOT EXISTS jurisdiction_rules_market_scope_idx
  ON jurisdiction_rules (market, scope, scope_code);

INSERT INTO jurisdiction_rules (
  id,
  market,
  scope,
  scope_code,
  is_enabled,
  min_kyc_level,
  require_sanctions_clear,
  max_order_notional_gbp,
  max_daily_notional_gbp,
  max_open_orders,
  blocked_reason,
  metadata
)
VALUES
  (
    'jr_coOwn_global',
    'co-own',
    'global',
    'GLOBAL',
    TRUE,
    'basic',
    TRUE,
    50000,
    100000,
    120,
    NULL,
    '{"note": "Default global co-own limit"}'::jsonb
  ),
  (
    'jr_coOwn_in',
    'co-own',
    'region',
    'IN',
    TRUE,
    'enhanced',
    TRUE,
    3000,
    12000,
    20,
    NULL,
    '{"jurisdiction": "India", "comment": "Higher KYC threshold"}'::jsonb
  ),
  (
    'jr_coOwn_eu',
    'co-own',
    'region',
    'EU',
    TRUE,
    'enhanced',
    TRUE,
    5000,
    20000,
    30,
    NULL,
    '{"jurisdiction": "EU", "comment": "Consumer and investor suitability controls"}'::jsonb
  ),
  (
    'jr_coOwn_gulf',
    'co-own',
    'region',
    'GULF',
    TRUE,
    'basic',
    TRUE,
    7000,
    25000,
    40,
    NULL,
    '{"jurisdiction": "Gulf", "comment": "Regional card and wallet controls"}'::jsonb
  ),
  (
    'jr_coOwn_africa',
    'co-own',
    'region',
    'AFRICA',
    TRUE,
    'basic',
    TRUE,
    2500,
    10000,
    25,
    NULL,
    '{"jurisdiction": "Africa", "comment": "Conservative notional caps"}'::jsonb
  ),
  (
    'jr_coOwn_us',
    'co-own',
    'country',
    'US',
    TRUE,
    'enhanced',
    TRUE,
    NULL,
    NULL,
    NULL,
    NULL,
    '{"jurisdiction": "US", "comment": "Country rule enabled with enhanced KYC"}'::jsonb
  ),
  (
    'jr_auctions_global',
    'auctions',
    'global',
    'GLOBAL',
    TRUE,
    'basic',
    TRUE,
    20000,
    50000,
    500,
    NULL,
    '{"note": "Default auction controls"}'::jsonb
  ),
  (
    'jr_auctions_in',
    'auctions',
    'region',
    'IN',
    TRUE,
    'basic',
    TRUE,
    8000,
    25000,
    250,
    NULL,
    '{"jurisdiction": "India"}'::jsonb
  ),
  (
    'jr_auctions_eu',
    'auctions',
    'region',
    'EU',
    TRUE,
    'basic',
    TRUE,
    12000,
    35000,
    250,
    NULL,
    '{"jurisdiction": "EU"}'::jsonb
  )
ON CONFLICT (market, scope, scope_code) DO UPDATE
SET
  is_enabled = EXCLUDED.is_enabled,
  min_kyc_level = EXCLUDED.min_kyc_level,
  require_sanctions_clear = EXCLUDED.require_sanctions_clear,
  max_order_notional_gbp = EXCLUDED.max_order_notional_gbp,
  max_daily_notional_gbp = EXCLUDED.max_daily_notional_gbp,
  max_open_orders = EXCLUDED.max_open_orders,
  blocked_reason = EXCLUDED.blocked_reason,
  metadata = EXCLUDED.metadata,
  updated_at = NOW();

CREATE TABLE IF NOT EXISTS legal_documents (
  id TEXT PRIMARY KEY,
  doc_type TEXT NOT NULL CHECK (
    doc_type IN ('terms_of_service', 'privacy_policy', 'risk_disclosure', 'kyc_terms', 'consent_notice')
  ),
  version TEXT NOT NULL,
  locale TEXT NOT NULL DEFAULT 'en',
  title TEXT NOT NULL,
  content_url TEXT,
  content_hash TEXT,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  effective_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  retired_at TIMESTAMPTZ,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (doc_type, version, locale)
);

CREATE INDEX IF NOT EXISTS legal_documents_type_effective_idx
  ON legal_documents (doc_type, effective_at DESC);

INSERT INTO legal_documents (
  id,
  doc_type,
  version,
  locale,
  title,
  content_url,
  content_hash,
  is_active,
  effective_at,
  metadata
)
VALUES
  (
    'doc_terms_v1_en',
    'terms_of_service',
    'v1.0',
    'en',
    'Thryftverse Terms of Service',
    'https://legal.thryftverse.local/terms/v1',
    'sha256:terms-v1-placeholder',
    TRUE,
    NOW(),
    '{}'::jsonb
  ),
  (
    'doc_privacy_v1_en',
    'privacy_policy',
    'v1.0',
    'en',
    'Thryftverse Privacy Policy',
    'https://legal.thryftverse.local/privacy/v1',
    'sha256:privacy-v1-placeholder',
    TRUE,
    NOW(),
    '{}'::jsonb
  ),
  (
    'doc_risk_v1_en',
    'risk_disclosure',
    'v1.0',
    'en',
    'Co-Own Risk Disclosure',
    'https://legal.thryftverse.local/risk/co-own-v1',
    'sha256:risk-v1-placeholder',
    TRUE,
    NOW(),
    '{}'::jsonb
  )
ON CONFLICT (doc_type, version, locale) DO NOTHING;

CREATE TABLE IF NOT EXISTS user_consents (
  id BIGSERIAL PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  document_id TEXT NOT NULL REFERENCES legal_documents(id) ON DELETE RESTRICT,
  accepted BOOLEAN NOT NULL DEFAULT TRUE,
  accepted_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  ip_address TEXT,
  user_agent TEXT,
  evidence JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (user_id, document_id)
);

CREATE INDEX IF NOT EXISTS user_consents_user_accepted_idx
  ON user_consents (user_id, accepted_at DESC);

CREATE TABLE IF NOT EXISTS gdpr_requests (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  request_type TEXT NOT NULL CHECK (request_type IN ('export', 'erasure')),
  status TEXT NOT NULL CHECK (status IN ('requested', 'processing', 'completed', 'rejected')),
  requested_ip TEXT,
  requested_user_agent TEXT,
  requested_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  completed_at TIMESTAMPTZ,
  resolution_notes TEXT,
  payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS gdpr_requests_user_status_idx
  ON gdpr_requests (user_id, status, requested_at DESC);

CREATE TABLE IF NOT EXISTS compliance_audit_log (
  id BIGSERIAL PRIMARY KEY,
  event_type TEXT NOT NULL,
  actor_user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  subject_user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  request_id TEXT,
  ip_address TEXT,
  user_agent TEXT,
  payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  previous_hash TEXT NOT NULL CHECK (char_length(previous_hash) = 64),
  entry_hash TEXT NOT NULL UNIQUE CHECK (char_length(entry_hash) = 64),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS compliance_audit_log_event_created_idx
  ON compliance_audit_log (event_type, created_at DESC);

CREATE INDEX IF NOT EXISTS compliance_audit_log_subject_created_idx
  ON compliance_audit_log (subject_user_id, created_at DESC);

CREATE OR REPLACE FUNCTION set_compliance_updated_at() RETURNS trigger AS $$
BEGIN
  NEW.updated_at := NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS user_compliance_profiles_updated_at_trigger ON user_compliance_profiles;
CREATE TRIGGER user_compliance_profiles_updated_at_trigger
BEFORE UPDATE ON user_compliance_profiles
FOR EACH ROW EXECUTE FUNCTION set_compliance_updated_at();

DROP TRIGGER IF EXISTS kyc_cases_updated_at_trigger ON kyc_cases;
CREATE TRIGGER kyc_cases_updated_at_trigger
BEFORE UPDATE ON kyc_cases
FOR EACH ROW EXECUTE FUNCTION set_compliance_updated_at();

DROP TRIGGER IF EXISTS aml_alerts_updated_at_trigger ON aml_alerts;
CREATE TRIGGER aml_alerts_updated_at_trigger
BEFORE UPDATE ON aml_alerts
FOR EACH ROW EXECUTE FUNCTION set_compliance_updated_at();

DROP TRIGGER IF EXISTS compliance_sar_reports_updated_at_trigger ON compliance_sar_reports;
CREATE TRIGGER compliance_sar_reports_updated_at_trigger
BEFORE UPDATE ON compliance_sar_reports
FOR EACH ROW EXECUTE FUNCTION set_compliance_updated_at();

DROP TRIGGER IF EXISTS jurisdiction_rules_updated_at_trigger ON jurisdiction_rules;
CREATE TRIGGER jurisdiction_rules_updated_at_trigger
BEFORE UPDATE ON jurisdiction_rules
FOR EACH ROW EXECUTE FUNCTION set_compliance_updated_at();

DROP TRIGGER IF EXISTS user_consents_updated_at_trigger ON user_consents;
CREATE TRIGGER user_consents_updated_at_trigger
BEFORE UPDATE ON user_consents
FOR EACH ROW EXECUTE FUNCTION set_compliance_updated_at();

DROP TRIGGER IF EXISTS gdpr_requests_updated_at_trigger ON gdpr_requests;
CREATE TRIGGER gdpr_requests_updated_at_trigger
BEFORE UPDATE ON gdpr_requests
FOR EACH ROW EXECUTE FUNCTION set_compliance_updated_at();

CREATE OR REPLACE FUNCTION compliance_audit_log_prevent_mutation() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'compliance_audit_log is immutable and cannot be changed';
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS compliance_audit_log_prevent_update ON compliance_audit_log;
CREATE TRIGGER compliance_audit_log_prevent_update
BEFORE UPDATE ON compliance_audit_log
FOR EACH ROW EXECUTE FUNCTION compliance_audit_log_prevent_mutation();

DROP TRIGGER IF EXISTS compliance_audit_log_prevent_delete ON compliance_audit_log;
CREATE TRIGGER compliance_audit_log_prevent_delete
BEFORE DELETE ON compliance_audit_log
FOR EACH ROW EXECUTE FUNCTION compliance_audit_log_prevent_mutation();

INSERT INTO user_compliance_profiles (
  user_id,
  country_code,
  kyc_status,
  kyc_level,
  document_status,
  liveness_status,
  sanctions_status,
  pep_status,
  aml_risk_tier,
  trading_enabled
)
SELECT
  u.id,
  'GB',
  'not_started',
  'basic',
  'unsubmitted',
  'unsubmitted',
  'unknown',
  'unknown',
  'medium',
  FALSE
FROM users u
ON CONFLICT (user_id) DO NOTHING;

UPDATE user_compliance_profiles
SET
  country_code = 'GB',
  kyc_status = 'verified',
  kyc_level = 'enhanced',
  document_status = 'approved',
  liveness_status = 'passed',
  sanctions_status = 'clear',
  pep_status = 'clear',
  aml_risk_tier = 'low',
  trading_enabled = TRUE,
  updated_at = NOW()
WHERE user_id IN ('u1', 'u2', 'me');
