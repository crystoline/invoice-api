-- AlterTable
ALTER TABLE `bills` ADD COLUMN `created_at` DATETIME(3) NULL DEFAULT CURRENT_TIMESTAMP(3);

-- AlterTable
ALTER TABLE `businesses` ADD COLUMN `business_phone` VARCHAR(255) NULL,
    ADD COLUMN `country` VARCHAR(255) NULL,
    ADD COLUMN `default_currency` VARCHAR(8) NULL,
    ADD COLUMN `invoice_prefix` VARCHAR(32) NULL,
    ADD COLUMN `invoice_starting_number` INTEGER NULL,
    ADD COLUMN `logo_url` VARCHAR(512) NULL,
    ADD COLUMN `payment_terms_days` INTEGER NULL,
    ADD COLUMN `paystack_public_key` VARCHAR(512) NULL,
    ADD COLUMN `paystack_secret_key` VARCHAR(512) NULL,
    ADD COLUMN `stripe_public_key` VARCHAR(512) NULL,
    ADD COLUMN `stripe_secret_key` VARCHAR(512) NULL,
    ADD COLUMN `tax_id` VARCHAR(255) NULL,
    ADD COLUMN `test_mode` BOOLEAN NULL DEFAULT true;

-- AlterTable
ALTER TABLE `invoices` ADD COLUMN `amount_paid` DECIMAL(38, 2) NULL,
    ADD COLUMN `due_date` DATE NULL,
    ADD COLUMN `paid_date` DATE NULL;

-- AlterTable
ALTER TABLE `plans` ADD COLUMN `allow_api_access` BOOLEAN NULL DEFAULT false,
    ADD COLUMN `allow_custom_templates` BOOLEAN NULL DEFAULT false,
    ADD COLUMN `allow_payment_collection` BOOLEAN NULL DEFAULT false,
    ADD COLUMN `allow_recurring_invoices` BOOLEAN NULL DEFAULT false,
    ADD COLUMN `display_name` VARCHAR(255) NULL,
    ADD COLUMN `is_active` BOOLEAN NULL DEFAULT true,
    ADD COLUMN `max_businesses` INTEGER NULL,
    ADD COLUMN `max_invoices_per_month` INTEGER NULL,
    ADD COLUMN `max_team_members` INTEGER NULL,
    ADD COLUMN `price_ngn_monthly` DOUBLE NULL,
    ADD COLUMN `price_ngn_yearly` DOUBLE NULL,
    ADD COLUMN `price_usd_monthly` DOUBLE NULL,
    ADD COLUMN `price_usd_yearly` DOUBLE NULL;

-- AlterTable
ALTER TABLE `recurringinvoices` ADD COLUMN `auto_send` BOOLEAN NULL DEFAULT false,
    ADD COLUMN `business_id` BIGINT NULL,
    ADD COLUMN `created_at` DATETIME(3) NULL DEFAULT CURRENT_TIMESTAMP(3),
    ADD COLUMN `day_of_month` INTEGER NULL,
    ADD COLUMN `end_date` DATE NULL,
    ADD COLUMN `frequency` VARCHAR(255) NULL,
    ADD COLUMN `generated_count` INTEGER NULL DEFAULT 0,
    ADD COLUMN `is_active` BOOLEAN NULL DEFAULT true,
    ADD COLUMN `last_generated_date` DATE NULL,
    ADD COLUMN `max_occurrences` INTEGER NULL,
    ADD COLUMN `next_invoice_date` DATE NULL,
    ADD COLUMN `start_date` DATE NULL,
    ADD COLUMN `updated_at` DATETIME(3) NULL;

-- AlterTable
ALTER TABLE `subscriptions` ADD COLUMN `auto_renew` BOOLEAN NULL DEFAULT true,
    ADD COLUMN `gateway_subscription_id` VARCHAR(255) NULL,
    ADD COLUMN `last_payment_date` DATETIME(6) NULL,
    ADD COLUMN `next_payment_date` DATETIME(6) NULL,
    ADD COLUMN `payment_gateway` VARCHAR(32) NULL,
    ADD COLUMN `status` VARCHAR(32) NULL,
    ADD COLUMN `trial_end_date` DATETIME(6) NULL;

-- CreateTable
CREATE TABLE `payments` (
    `id` BIGINT NOT NULL AUTO_INCREMENT,
    `invoice_id` BIGINT NULL,
    `business_id` BIGINT NULL,
    `amount` DECIMAL(38, 2) NULL,
    `currency` VARCHAR(8) NULL,
    `method` VARCHAR(32) NULL,
    `transaction_ref` VARCHAR(255) NULL,
    `status` VARCHAR(32) NULL,
    `paid_at` DATETIME(6) NULL,
    `created_at` DATETIME(3) NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `payments_invoice_id_idx`(`invoice_id`),
    INDEX `payments_business_id_idx`(`business_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `tax_rates` (
    `id` BIGINT NOT NULL AUTO_INCREMENT,
    `business_id` BIGINT NULL,
    `name` VARCHAR(255) NULL,
    `rate` DECIMAL(10, 4) NULL,
    `is_default` BOOLEAN NULL DEFAULT false,
    `created_at` DATETIME(3) NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `tax_rates_business_id_idx`(`business_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `portal_tokens` (
    `id` BIGINT NOT NULL AUTO_INCREMENT,
    `token` VARCHAR(255) NOT NULL,
    `invoice_id` BIGINT NULL,
    `expires_at` DATETIME(6) NULL,
    `used` BOOLEAN NULL DEFAULT false,
    `created_at` DATETIME(3) NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `portal_tokens_token_key`(`token`),
    INDEX `portal_tokens_invoice_id_idx`(`invoice_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `activity_log` (
    `id` BIGINT NOT NULL AUTO_INCREMENT,
    `user_id` BIGINT NULL,
    `business_id` BIGINT NULL,
    `action` VARCHAR(255) NULL,
    `entity` VARCHAR(255) NULL,
    `entity_id` BIGINT NULL,
    `metadata` TEXT NULL,
    `created_at` DATETIME(3) NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `activity_log_business_id_idx`(`business_id`),
    INDEX `activity_log_user_id_idx`(`user_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `notification_preferences` (
    `id` BIGINT NOT NULL AUTO_INCREMENT,
    `user_id` BIGINT NULL,
    `business_id` BIGINT NULL,
    `invoice_sent` BOOLEAN NULL DEFAULT true,
    `payment_received` BOOLEAN NULL DEFAULT true,
    `invoice_overdue` BOOLEAN NULL DEFAULT true,
    `bill_reminder` BOOLEAN NULL DEFAULT true,

    UNIQUE INDEX `notification_preferences_user_id_key`(`user_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateIndex
CREATE INDEX `FK_recurring_business` ON `recurringinvoices`(`business_id`);

-- CreateIndex
CREATE INDEX `idx_recurring_next_date` ON `recurringinvoices`(`next_invoice_date`);

-- AddForeignKey
ALTER TABLE `recurringinvoices` ADD CONSTRAINT `FK_recurring_business` FOREIGN KEY (`business_id`) REFERENCES `businesses`(`id`) ON DELETE NO ACTION ON UPDATE NO ACTION;
