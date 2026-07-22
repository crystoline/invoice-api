-- CreateTable
CREATE TABLE `bill_billitems` (
    `bill_id` BIGINT NOT NULL,
    `billitems_id` BIGINT NOT NULL,

    UNIQUE INDEX `UK_5n4k59h3xp9097778fdys70d8`(`billitems_id`),
    INDEX `FKp3jn99t624j95u0v0poigoa2g`(`bill_id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `bill_items` (
    `id` BIGINT NOT NULL AUTO_INCREMENT,
    `price` DECIMAL(38, 2) NULL,
    `quantity` INTEGER NOT NULL,
    `product_id` BIGINT NOT NULL,
    `description` VARCHAR(255) NULL,

    INDEX `FKnxfjfage047r297vj65sq8e6h`(`product_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `bills` (
    `id` BIGINT NOT NULL AUTO_INCREMENT,
    `bill_number` VARCHAR(255) NULL,
    `is_paid` BIT(1) NULL,
    `total_amount` DECIMAL(38, 2) NULL,
    `billed_user_id` BIGINT NULL,
    `billing_user_id` BIGINT NULL,
    `billing_vendor_id` BIGINT NULL,
    `business_id` BIGINT NULL,
    `category_id` BIGINT NULL,
    `receipt_url` VARCHAR(255) NULL,

    INDEX `FK4bdw432krrro3s0t3numkw3ob`(`business_id`),
    INDEX `FKbhml0aetvq2phiq4cacs4migq`(`billing_user_id`),
    INDEX `FKh16dp5n4kx9hckx11y0quj4el`(`billed_user_id`),
    INDEX `FKknafp220mc2b98mqngst66et7`(`billing_vendor_id`),
    INDEX `FKsm31gb2dmlo1jtehg3nu4jsj2`(`category_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `business_members` (
    `business_id` BIGINT NOT NULL,
    `user_id` BIGINT NOT NULL,

    INDEX `FKl3se6j2mob8wdx6tjckpx0qjt`(`user_id`),
    PRIMARY KEY (`business_id`, `user_id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `businesses` (
    `id` BIGINT NOT NULL AUTO_INCREMENT,
    `business_address` VARCHAR(255) NULL,
    `business_email` VARCHAR(255) NULL,
    `business_name` VARCHAR(255) NULL,
    `business_role` VARCHAR(255) NULL,
    `is_active` BIT(1) NULL,
    `owner_id` BIGINT NULL,

    INDEX `FKdh1y7wew1fqwy531d5ojohod5`(`owner_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `categories` (
    `id` BIGINT NOT NULL AUTO_INCREMENT,
    `description` VARCHAR(255) NULL,
    `name` VARCHAR(255) NOT NULL,

    UNIQUE INDEX `UK_t8o6pivur7nn124jehx7cygw5`(`name`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `customers` (
    `id` BIGINT NOT NULL AUTO_INCREMENT,
    `address` VARCHAR(255) NULL,
    `email` VARCHAR(255) NULL,
    `first_name` VARCHAR(255) NULL,
    `last_name` VARCHAR(255) NULL,
    `business_id` BIGINT NOT NULL,

    INDEX `FKjjod36f7buv2adeptxcfec8jm`(`business_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `expense_categories` (
    `id` BIGINT NOT NULL AUTO_INCREMENT,
    `color` VARCHAR(255) NULL,
    `description` VARCHAR(255) NULL,
    `name` VARCHAR(255) NOT NULL,
    `business_id` BIGINT NULL,

    INDEX `FKqf9djfkm1kborgnvy241xc8ly`(`business_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `income` (
    `id` BIGINT NOT NULL AUTO_INCREMENT,
    `amount` DECIMAL(38, 2) NULL,
    `customer_id` BIGINT NULL,
    `category_name` VARCHAR(255) NULL,
    `description` VARCHAR(255) NULL,
    `income_date` DATE NULL,
    `source` VARCHAR(255) NULL,
    `business_id` BIGINT NULL,

    INDEX `FKe9obokq59dh7lj6jy41nvwpwv`(`business_id`),
    INDEX `FKmye2ydkt17csr9khgl97ad6iu`(`customer_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `invoice_custom_fields` (
    `id` BIGINT NOT NULL AUTO_INCREMENT,
    `custom_name` VARCHAR(255) NULL,
    `customer` VARCHAR(255) NULL,
    `frequency` VARCHAR(255) NULL,
    `invoice_date` VARCHAR(255) NULL,
    `invoice_number` VARCHAR(255) NULL,
    `is_recurring` VARCHAR(255) NULL,
    `price` VARCHAR(255) NULL,
    `product` VARCHAR(255) NULL,
    `quantity` VARCHAR(255) NULL,
    `total_amount` VARCHAR(255) NULL,
    `user_id` BIGINT NULL,

    INDEX `FKmsrn0jyvgoyeegjs484ilbf7`(`user_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `invoice_items` (
    `id` BIGINT NOT NULL AUTO_INCREMENT,
    `discount` BIGINT NULL,
    `quantity` INTEGER NOT NULL,
    `invoice_id` BIGINT NOT NULL,
    `product_id` BIGINT NOT NULL,

    INDEX `FK46ae0lhu1oqs7cv91fn6y9n7w`(`invoice_id`),
    INDEX `FKs3tu9gmkgshq8oeq5n0rinxeu`(`product_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `invoices` (
    `id` BIGINT NOT NULL AUTO_INCREMENT,
    `approval_status` VARCHAR(255) NULL,
    `currency_code` VARCHAR(255) NULL,
    `frequency` VARCHAR(255) NULL,
    `invoice_date` DATETIME(6) NULL,
    `invoice_number` VARCHAR(255) NULL,
    `invoice_status` VARCHAR(255) NULL,
    `is_paid` BIT(1) NULL,
    `is_recurring` BIT(1) NOT NULL,
    `total_amount` DECIMAL(38, 2) NULL,
    `business_id` BIGINT NOT NULL,
    `customer_id` BIGINT NOT NULL,

    INDEX `FKggnugoub9tqww1drff1979c7h`(`business_id`),
    INDEX `FKq2w4hmh6l9othnp6cepp0cfe2`(`customer_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `plans` (
    `id` BIGINT NOT NULL AUTO_INCREMENT,
    `description` VARCHAR(255) NULL,
    `duration_in_days` INTEGER NULL,
    `name` VARCHAR(255) NOT NULL,
    `price` DOUBLE NULL,

    UNIQUE INDEX `UK_j2syv9y60858xbq169nbeg7ea`(`name`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `products` (
    `id` BIGINT NOT NULL AUTO_INCREMENT,
    `is_product_active` BIT(1) NULL,
    `name` VARCHAR(255) NULL,
    `unit_price` DECIMAL(38, 2) NULL,
    `business_id` BIGINT NOT NULL,
    `category_id` BIGINT NULL,

    INDEX `FKi65q12p725kxcn1jcosg2x9y4`(`business_id`),
    INDEX `FKog2rp4qthbtt2lfyhfo32lsw9`(`category_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `recurringinvoices` (
    `id` BIGINT NOT NULL AUTO_INCREMENT,
    `invoice_id` BIGINT NULL,

    UNIQUE INDEX `UK_1p0s506p4yvh4vg9fvi19wmr4`(`invoice_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `roles` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `name` ENUM('ROLE_USER', 'BUSINESS_USER', 'ROLE_SUPER_ADMIN', 'ROLE_ADMIN') NULL,

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `subscriptions` (
    `id` BIGINT NOT NULL AUTO_INCREMENT,
    `end_date` DATETIME(6) NOT NULL,
    `is_active` BIT(1) NOT NULL,
    `is_cancelled` BIT(1) NOT NULL,
    `start_date` DATETIME(6) NOT NULL,
    `plan_id` BIGINT NOT NULL,
    `user_id` BIGINT NOT NULL,

    INDEX `FKb1uf5qnxi6uj95se8ykydntl1`(`plan_id`),
    INDEX `FKhro52ohfqfbay9774bev0qinr`(`user_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `user_role` (
    `user_id` BIGINT NOT NULL,
    `role_id` INTEGER NOT NULL,

    INDEX `FKt7e7djp752sqn6w22i6ocqy6q`(`role_id`),
    PRIMARY KEY (`user_id`, `role_id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `users` (
    `id` BIGINT NOT NULL AUTO_INCREMENT,
    `date_added` VARCHAR(255) NULL,
    `email` VARCHAR(255) NULL,
    `first_name` VARCHAR(255) NULL,
    `last_login` DATETIME(6) NULL,
    `last_name` VARCHAR(255) NULL,
    `password` VARCHAR(255) NULL,
    `status` BIT(1) NOT NULL,
    `token_expiry_time` DATETIME(6) NULL,
    `username` VARCHAR(255) NULL,
    `verification_token` VARCHAR(255) NULL,
    `verified` BIT(1) NOT NULL,
    `selected_business_id` BIGINT NULL,
    `selected_custom_invoice_id` BIGINT NULL,

    INDEX `FKhr52v0vwpln0txhdlyiec5572`(`selected_custom_invoice_id`),
    INDEX `FKsslc5ranl2npfonvj5eh4cvfg`(`selected_business_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `vendor_products` (
    `id` BIGINT NOT NULL AUTO_INCREMENT,
    `vendor_product_name` VARCHAR(255) NULL,
    `vendor_product_price` DECIMAL(38, 2) NULL,
    `vendor_product_status` BIT(1) NULL,
    `vendor_id` BIGINT NOT NULL,

    INDEX `FKp7rdrgp4sccabnwe2rckjuu1b`(`vendor_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `vendors` (
    `id` BIGINT NOT NULL AUTO_INCREMENT,
    `email` VARCHAR(255) NULL,
    `name` VARCHAR(255) NULL,
    `status` BIT(1) NULL,

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `bill_billitems` ADD CONSTRAINT `FK87ghql9mhc8pufblptxaouuhl` FOREIGN KEY (`billitems_id`) REFERENCES `bill_items`(`id`) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE `bill_billitems` ADD CONSTRAINT `FKp3jn99t624j95u0v0poigoa2g` FOREIGN KEY (`bill_id`) REFERENCES `bills`(`id`) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE `bill_items` ADD CONSTRAINT `FKnxfjfage047r297vj65sq8e6h` FOREIGN KEY (`product_id`) REFERENCES `products`(`id`) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE `bills` ADD CONSTRAINT `FK4bdw432krrro3s0t3numkw3ob` FOREIGN KEY (`business_id`) REFERENCES `businesses`(`id`) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE `bills` ADD CONSTRAINT `FKbhml0aetvq2phiq4cacs4migq` FOREIGN KEY (`billing_user_id`) REFERENCES `users`(`id`) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE `bills` ADD CONSTRAINT `FKh16dp5n4kx9hckx11y0quj4el` FOREIGN KEY (`billed_user_id`) REFERENCES `users`(`id`) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE `bills` ADD CONSTRAINT `FKknafp220mc2b98mqngst66et7` FOREIGN KEY (`billing_vendor_id`) REFERENCES `vendors`(`id`) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE `bills` ADD CONSTRAINT `FKsm31gb2dmlo1jtehg3nu4jsj2` FOREIGN KEY (`category_id`) REFERENCES `expense_categories`(`id`) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE `business_members` ADD CONSTRAINT `FKl3se6j2mob8wdx6tjckpx0qjt` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE `business_members` ADD CONSTRAINT `FKo01cepu6mek8gfi8k0sr9epxg` FOREIGN KEY (`business_id`) REFERENCES `businesses`(`id`) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE `businesses` ADD CONSTRAINT `FKdh1y7wew1fqwy531d5ojohod5` FOREIGN KEY (`owner_id`) REFERENCES `users`(`id`) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE `customers` ADD CONSTRAINT `FKjjod36f7buv2adeptxcfec8jm` FOREIGN KEY (`business_id`) REFERENCES `businesses`(`id`) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE `expense_categories` ADD CONSTRAINT `FKqf9djfkm1kborgnvy241xc8ly` FOREIGN KEY (`business_id`) REFERENCES `businesses`(`id`) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE `income` ADD CONSTRAINT `FKe9obokq59dh7lj6jy41nvwpwv` FOREIGN KEY (`business_id`) REFERENCES `businesses`(`id`) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE `income` ADD CONSTRAINT `FKmye2ydkt17csr9khgl97ad6iu` FOREIGN KEY (`customer_id`) REFERENCES `customers`(`id`) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE `invoice_custom_fields` ADD CONSTRAINT `FKmsrn0jyvgoyeegjs484ilbf7` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE `invoice_items` ADD CONSTRAINT `FK46ae0lhu1oqs7cv91fn6y9n7w` FOREIGN KEY (`invoice_id`) REFERENCES `invoices`(`id`) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE `invoice_items` ADD CONSTRAINT `FKs3tu9gmkgshq8oeq5n0rinxeu` FOREIGN KEY (`product_id`) REFERENCES `products`(`id`) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE `invoices` ADD CONSTRAINT `FKggnugoub9tqww1drff1979c7h` FOREIGN KEY (`business_id`) REFERENCES `businesses`(`id`) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE `invoices` ADD CONSTRAINT `FKq2w4hmh6l9othnp6cepp0cfe2` FOREIGN KEY (`customer_id`) REFERENCES `customers`(`id`) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE `products` ADD CONSTRAINT `FKi65q12p725kxcn1jcosg2x9y4` FOREIGN KEY (`business_id`) REFERENCES `businesses`(`id`) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE `products` ADD CONSTRAINT `FKog2rp4qthbtt2lfyhfo32lsw9` FOREIGN KEY (`category_id`) REFERENCES `categories`(`id`) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE `recurringinvoices` ADD CONSTRAINT `FK52ai63sme8nmbxrwp1s3v001j` FOREIGN KEY (`invoice_id`) REFERENCES `invoices`(`id`) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE `subscriptions` ADD CONSTRAINT `FKb1uf5qnxi6uj95se8ykydntl1` FOREIGN KEY (`plan_id`) REFERENCES `plans`(`id`) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE `subscriptions` ADD CONSTRAINT `FKhro52ohfqfbay9774bev0qinr` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE `user_role` ADD CONSTRAINT `FKj345gk1bovqvfame88rcx7yyx` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE `user_role` ADD CONSTRAINT `FKt7e7djp752sqn6w22i6ocqy6q` FOREIGN KEY (`role_id`) REFERENCES `roles`(`id`) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE `users` ADD CONSTRAINT `FKhr52v0vwpln0txhdlyiec5572` FOREIGN KEY (`selected_custom_invoice_id`) REFERENCES `invoice_custom_fields`(`id`) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE `users` ADD CONSTRAINT `FKsslc5ranl2npfonvj5eh4cvfg` FOREIGN KEY (`selected_business_id`) REFERENCES `businesses`(`id`) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE `vendor_products` ADD CONSTRAINT `FKp7rdrgp4sccabnwe2rckjuu1b` FOREIGN KEY (`vendor_id`) REFERENCES `vendors`(`id`) ON DELETE NO ACTION ON UPDATE NO ACTION;

