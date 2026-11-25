ALTER TABLE hvr_care_policies
  ADD COLUMN premium_amount numeric(12, 2) CHECK (premium_amount >= 0);
