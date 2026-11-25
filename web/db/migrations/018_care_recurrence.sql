ALTER TABLE hvr_care_policies
  ADD COLUMN review_date date,
  ADD COLUMN birthday_md text CHECK (birthday_md ~ '^[0-9]{2}-[0-9]{2}$'),
  ADD COLUMN payment_frequency text CHECK (payment_frequency IN ('monthly','quarterly','yearly')),
  ADD COLUMN premium_anchor date;

ALTER TABLE hvr_care_events ADD COLUMN cycle_due date;
