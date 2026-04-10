INSERT INTO payment_gateways (id, display_name, gateway_type, is_active)
VALUES ('wise_global', 'Wise Global', 'fiat', TRUE)
ON CONFLICT (id) DO UPDATE
SET
  display_name = EXCLUDED.display_name,
  gateway_type = EXCLUDED.gateway_type,
  is_active = EXCLUDED.is_active;
