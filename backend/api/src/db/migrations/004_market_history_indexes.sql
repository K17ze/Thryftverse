CREATE INDEX IF NOT EXISTS auction_bids_bidder_created_id_idx
  ON auction_bids (bidder_id, created_at DESC, id DESC);

CREATE INDEX IF NOT EXISTS coOwn_orders_user_created_id_idx
  ON coOwn_orders (user_id, created_at DESC, id DESC);
