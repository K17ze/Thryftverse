-- Enforce the global 20-unit policy for co-own pools.

UPDATE coOwn_assets
SET
  total_units = LEAST(total_units, 20),
  available_units = LEAST(available_units, 20),
  updated_at = NOW()
WHERE total_units > 20 OR available_units > 20;

UPDATE coOwn_assets
SET
  available_units = total_units,
  updated_at = NOW()
WHERE available_units > total_units;

UPDATE coOwn_holdings
SET
  units_owned = LEAST(units_owned, 20),
  updated_at = NOW()
WHERE units_owned > 20;

UPDATE coOwn_buyout_offers
SET
  target_units = LEAST(target_units, 20),
  accepted_units = LEAST(accepted_units, 20),
  updated_at = NOW()
WHERE target_units > 20 OR accepted_units > 20;

UPDATE coOwn_buyout_offers
SET
  accepted_units = LEAST(accepted_units, target_units),
  updated_at = NOW()
WHERE accepted_units > target_units;

ALTER TABLE coOwn_assets
  DROP CONSTRAINT IF EXISTS coOwn_assets_total_units_check;

ALTER TABLE coOwn_assets
  DROP CONSTRAINT IF EXISTS coOwn_assets_available_units_check;

ALTER TABLE coOwn_assets
  DROP CONSTRAINT IF EXISTS coOwn_assets_total_units_cap_check;

ALTER TABLE coOwn_assets
  DROP CONSTRAINT IF EXISTS coOwn_assets_available_units_cap_check;

ALTER TABLE coOwn_assets
  DROP CONSTRAINT IF EXISTS coOwn_assets_available_le_total_units_check;

ALTER TABLE coOwn_assets
  ADD CONSTRAINT coOwn_assets_total_units_cap_check CHECK (total_units > 0 AND total_units <= 20);

ALTER TABLE coOwn_assets
  ADD CONSTRAINT coOwn_assets_available_units_cap_check CHECK (available_units >= 0 AND available_units <= 20);

ALTER TABLE coOwn_assets
  ADD CONSTRAINT coOwn_assets_available_le_total_units_check CHECK (available_units <= total_units);

ALTER TABLE coOwn_holdings
  DROP CONSTRAINT IF EXISTS coOwn_holdings_units_owned_check;

ALTER TABLE coOwn_holdings
  DROP CONSTRAINT IF EXISTS coOwn_holdings_units_owned_cap_check;

ALTER TABLE coOwn_holdings
  ADD CONSTRAINT coOwn_holdings_units_owned_cap_check CHECK (units_owned >= 0 AND units_owned <= 20);

ALTER TABLE coOwn_buyout_offers
  DROP CONSTRAINT IF EXISTS coOwn_buyout_offers_target_units_check;

ALTER TABLE coOwn_buyout_offers
  DROP CONSTRAINT IF EXISTS coOwn_buyout_offers_accepted_units_check;

ALTER TABLE coOwn_buyout_offers
  DROP CONSTRAINT IF EXISTS coOwn_buyout_offers_target_units_cap_check;

ALTER TABLE coOwn_buyout_offers
  DROP CONSTRAINT IF EXISTS coOwn_buyout_offers_accepted_units_cap_check;

ALTER TABLE coOwn_buyout_offers
  DROP CONSTRAINT IF EXISTS coOwn_buyout_offers_accepted_le_target_check;

ALTER TABLE coOwn_buyout_offers
  ADD CONSTRAINT coOwn_buyout_offers_target_units_cap_check CHECK (target_units > 0 AND target_units <= 20);

ALTER TABLE coOwn_buyout_offers
  ADD CONSTRAINT coOwn_buyout_offers_accepted_units_cap_check CHECK (accepted_units >= 0 AND accepted_units <= 20);

ALTER TABLE coOwn_buyout_offers
  ADD CONSTRAINT coOwn_buyout_offers_accepted_le_target_check CHECK (accepted_units <= target_units);
