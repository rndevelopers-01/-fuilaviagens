-- Run this once against the MySQL database configured in .env.
-- Session storage is created automatically by express-mysql-session.

CREATE TABLE IF NOT EXISTS excursions (
  id CHAR(36) NOT NULL PRIMARY KEY,
  title VARCHAR(120) NOT NULL,
  description VARCHAR(2000) NOT NULL DEFAULT '',
  departure_date DATE NOT NULL,
  image_key VARCHAR(255) NOT NULL,
  image_mime VARCHAR(100) NOT NULL,
  price_cents INT NOT NULL,
  min_age SMALLINT NOT NULL,
  capacity INT NOT NULL,
  seats_reserved INT NOT NULL DEFAULT 0,
  seats_sold INT NOT NULL DEFAULT 0,
  installments_count SMALLINT NOT NULL DEFAULT 0,
  is_published BOOLEAN NOT NULL DEFAULT FALSE,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  INDEX excursions_public_date_idx (is_published, departure_date),
  CONSTRAINT excursions_price_positive CHECK (price_cents > 0),
  CONSTRAINT excursions_min_age_nonnegative CHECK (min_age >= 0),
  CONSTRAINT excursions_capacity_positive CHECK (capacity > 0),
  CONSTRAINT excursions_reserved_nonnegative CHECK (seats_reserved >= 0),
  CONSTRAINT excursions_sold_nonnegative CHECK (seats_sold >= 0),
  CONSTRAINT excursions_installments_valid CHECK (installments_count BETWEEN 0 AND 12),
  CONSTRAINT excursion_inventory_within_capacity CHECK (seats_reserved + seats_sold <= capacity)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS coupons (
  id CHAR(36) NOT NULL PRIMARY KEY,
  code VARCHAR(32) NOT NULL UNIQUE,
  discount_type VARCHAR(10) NOT NULL,
  discount_value INT NOT NULL,
  max_uses INT NULL,
  used_count INT NOT NULL DEFAULT 0,
  reserved_uses INT NOT NULL DEFAULT 0,
  starts_at DATETIME(3) NULL,
  expires_at DATETIME(3) NULL,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  CONSTRAINT coupons_discount_type_valid CHECK (discount_type IN ('percent', 'fixed')),
  CONSTRAINT coupons_discount_positive CHECK (discount_value > 0),
  CONSTRAINT coupons_max_uses_positive CHECK (max_uses IS NULL OR max_uses > 0),
  CONSTRAINT coupons_used_nonnegative CHECK (used_count >= 0),
  CONSTRAINT coupons_reserved_nonnegative CHECK (reserved_uses >= 0)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS orders (
  id CHAR(36) NOT NULL PRIMARY KEY,
  excursion_id CHAR(36) NOT NULL,
  coupon_id CHAR(36) NULL,
  status VARCHAR(24) NOT NULL DEFAULT 'pending',
  payment_method VARCHAR(40) NULL,
  seats INT NOT NULL,
  subtotal_cents INT NOT NULL,
  discount_cents INT NOT NULL DEFAULT 0,
  total_cents INT NOT NULL,
  contact_email_cipher VARCHAR(1024) NOT NULL,
  contact_email_hash CHAR(64) NOT NULL,
  contact_phone_cipher VARCHAR(1024) NOT NULL,
  mp_preference_id VARCHAR(255) NULL,
  mp_payment_id VARCHAR(100) NULL UNIQUE,
  reservation_expires_at DATETIME(3) NOT NULL,
  receipt_token_hash CHAR(64) NOT NULL,
  email_sent_at DATETIME(3) NULL,
  email_status VARCHAR(16) NOT NULL DEFAULT 'waiting',
  email_lock_until DATETIME(3) NULL,
  email_error VARCHAR(180) NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  INDEX orders_status_expiry_idx (status, reservation_expires_at),
  INDEX orders_created_idx (created_at),
  INDEX orders_contact_email_idx (contact_email_hash),
  CONSTRAINT orders_excursion_fk FOREIGN KEY (excursion_id) REFERENCES excursions(id),
  CONSTRAINT orders_coupon_fk FOREIGN KEY (coupon_id) REFERENCES coupons(id),
  CONSTRAINT orders_status_valid CHECK (status IN ('pending', 'approved', 'rejected', 'cancelled', 'expired', 'refunded', 'review_required')),
  CONSTRAINT orders_seats_positive CHECK (seats > 0),
  CONSTRAINT orders_subtotal_positive CHECK (subtotal_cents > 0),
  CONSTRAINT orders_discount_nonnegative CHECK (discount_cents >= 0),
  CONSTRAINT orders_total_positive CHECK (total_cents > 0),
  CONSTRAINT orders_email_status_valid CHECK (email_status IN ('waiting', 'sending', 'sent', 'failed'))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS participants (
  id CHAR(36) NOT NULL PRIMARY KEY,
  order_id CHAR(36) NOT NULL,
  position SMALLINT NOT NULL,
  first_name_cipher VARCHAR(1024) NOT NULL,
  last_name_cipher VARCHAR(1024) NOT NULL,
  cpf_cipher VARCHAR(1024) NOT NULL,
  cpf_hash CHAR(64) NOT NULL,
  email_cipher VARCHAR(1024) NOT NULL,
  email_hash CHAR(64) NOT NULL,
  phone_cipher VARCHAR(1024) NOT NULL,
  age_years SMALLINT NOT NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  UNIQUE KEY participants_order_position_unique (order_id, position),
  INDEX participants_cpf_hash_idx (cpf_hash),
  INDEX participants_email_hash_idx (email_hash),
  INDEX participants_order_idx (order_id, position),
  CONSTRAINT participants_order_fk FOREIGN KEY (order_id) REFERENCES orders(id) ON DELETE CASCADE,
  CONSTRAINT participants_position_positive CHECK (position > 0),
  CONSTRAINT participants_age_nonnegative CHECK (age_years >= 0)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS page_views (
  id BIGINT NOT NULL AUTO_INCREMENT PRIMARY KEY,
  path VARCHAR(100) NOT NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  INDEX page_views_created_idx (created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
