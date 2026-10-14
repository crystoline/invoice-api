-- Billing jurisdiction: a user's country decides which plans they can buy.
--   NG    → naira plans, paid via Paystack
--   OTHER → USD plans, paid via Stripe
-- Plans now belong to one jurisdiction with one currency. The existing plans
-- (which carried both NGN and USD prices) become the Nigerian catalogue, and a
-- USD copy of each is created for everyone else. Admins can rename them freely;
-- `tier` links the equivalents.

-- AlterTable
ALTER TABLE `users` ADD COLUMN `country` VARCHAR(2) NULL;

-- AlterTable
ALTER TABLE `plans` ADD COLUMN `jurisdiction` VARCHAR(8) NOT NULL DEFAULT 'NG',
    ADD COLUMN `currency` VARCHAR(3) NOT NULL DEFAULT 'NGN',
    ADD COLUMN `price_monthly` DOUBLE NULL,
    ADD COLUMN `price_yearly` DOUBLE NULL,
    ADD COLUMN `tier` VARCHAR(32) NULL;

-- AlterTable
ALTER TABLE `subscriptions` ADD COLUMN `billing_interval` VARCHAR(8) NULL,
    ADD COLUMN `gateway_customer_id` VARCHAR(255) NULL,
    ADD COLUMN `gateway_token` VARCHAR(255) NULL;

-- AlterTable
ALTER TABLE `payments` ADD COLUMN `subscription_id` BIGINT NULL;

-- CreateIndex
CREATE INDEX `payments_subscription_id_idx` ON `payments`(`subscription_id`);

-- CreateTable
CREATE TABLE `gateway_plans` (
    `id` BIGINT NOT NULL AUTO_INCREMENT,
    `plan_id` BIGINT NOT NULL,
    `gateway` VARCHAR(16) NOT NULL,
    `billing_interval` VARCHAR(8) NOT NULL,
    `amount_minor` INTEGER NOT NULL,
    `currency` VARCHAR(3) NOT NULL,
    `gateway_plan_code` VARCHAR(64) NOT NULL,
    `created_at` DATETIME(3) NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `gateway_plans_code_idx`(`gateway_plan_code`),
    UNIQUE INDEX `gateway_plans_price_key`(`plan_id`, `gateway`, `billing_interval`, `amount_minor`, `currency`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `gateway_plans` ADD CONSTRAINT `gateway_plans_plan_id_fkey` FOREIGN KEY (`plan_id`) REFERENCES `plans`(`id`) ON DELETE CASCADE ON UPDATE NO ACTION;

-- Backfill 1: existing plans are the Nigerian catalogue (their NGN prices).
UPDATE `plans`
SET `jurisdiction` = 'NG',
    `currency` = 'NGN',
    `price_monthly` = `price_ngn_monthly`,
    `price_yearly` = `price_ngn_yearly`,
    `tier` = LOWER(`name`);

-- Backfill 2: a USD copy of each for everyone else (their USD prices).
INSERT INTO `plans` (
    `name`, `display_name`, `description`, `duration_in_days`, `price`,
    `price_usd_monthly`, `price_usd_yearly`,
    `max_invoices_per_month`, `max_businesses`, `max_team_members`,
    `allow_payment_collection`, `allow_recurring_invoices`, `allow_custom_templates`, `allow_api_access`,
    `is_active`, `jurisdiction`, `currency`, `price_monthly`, `price_yearly`, `tier`
)
SELECT
    CONCAT(`name`, ' (USD)'), `display_name`, `description`, `duration_in_days`, `price_usd_monthly`,
    `price_usd_monthly`, `price_usd_yearly`,
    `max_invoices_per_month`, `max_businesses`, `max_team_members`,
    `allow_payment_collection`, `allow_recurring_invoices`, `allow_custom_templates`, `allow_api_access`,
    `is_active`, 'OTHER', 'USD', `price_usd_monthly`, `price_usd_yearly`, `tier`
FROM `plans`
WHERE `jurisdiction` = 'NG';

-- Backfill 3: billing country from the businesses a user owns — any Nigerian
-- business → NG; otherwise a business's ISO code. The rest are asked on login.
UPDATE `users` u
SET u.`country` = 'NG'
WHERE u.`country` IS NULL
  AND EXISTS (
    SELECT 1 FROM `businesses` b
    WHERE b.`owner_id` = u.`id` AND UPPER(TRIM(b.`country`)) IN ('NG', 'NIGERIA')
  );

UPDATE `users` u
JOIN (
    SELECT `owner_id`, MIN(UPPER(TRIM(`country`))) AS code
    FROM `businesses`
    WHERE `owner_id` IS NOT NULL AND TRIM(`country`) REGEXP '^[A-Za-z]{2}$'
    GROUP BY `owner_id`
) owned ON owned.`owner_id` = u.`id`
SET u.`country` = owned.code
WHERE u.`country` IS NULL;
