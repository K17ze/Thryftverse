UPDATE jurisdiction_policies
SET
  p2p_send_allowed = FALSE,
  p2p_receive_allowed = FALSE,
  requires_context = TRUE,
  notes = 'India remains fully closed-loop for P2P transfers',
  updated_at = NOW()
WHERE country_code = 'IN';
