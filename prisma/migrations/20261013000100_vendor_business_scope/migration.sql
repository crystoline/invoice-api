-- Vendors become per-business. Ownership is backfilled from bills:
--   * a vendor billed by one business moves to that business;
--   * a vendor billed by several is copied once per extra business (with its
--     vendor products), and those businesses' bills are pointed at their copy;
--   * a vendor no business ever billed stays unassigned (platform admins only).
-- `copied_from` is scaffolding for the copy step and is dropped at the end.

-- AlterTable
ALTER TABLE `vendors` ADD COLUMN `business_id` BIGINT NULL,
    ADD COLUMN `copied_from` BIGINT NULL;

-- 1. Assign each billed vendor to the first business (lowest id) that billed it.
UPDATE `vendors` v
JOIN (
    SELECT `billing_vendor_id` AS vendor_id, MIN(`business_id`) AS business_id
    FROM `bills`
    WHERE `billing_vendor_id` IS NOT NULL AND `business_id` IS NOT NULL
    GROUP BY `billing_vendor_id`
) first_biz ON first_biz.vendor_id = v.`id`
SET v.`business_id` = first_biz.business_id;

-- 2. One copy per additional business that billed the same vendor.
INSERT INTO `vendors` (`email`, `name`, `status`, `business_id`, `copied_from`)
SELECT v.`email`, v.`name`, v.`status`, extra_biz.business_id, v.`id`
FROM `vendors` v
JOIN (
    SELECT DISTINCT `billing_vendor_id` AS vendor_id, `business_id` AS business_id
    FROM `bills`
    WHERE `billing_vendor_id` IS NOT NULL AND `business_id` IS NOT NULL
) extra_biz ON extra_biz.vendor_id = v.`id`
WHERE extra_biz.business_id <> v.`business_id`;

-- 3. Point each of those businesses' bills at its own copy.
UPDATE `bills` b
JOIN `vendors` c ON c.`copied_from` = b.`billing_vendor_id` AND c.`business_id` = b.`business_id`
SET b.`billing_vendor_id` = c.`id`;

-- 4. Give every copy the original vendor's products.
INSERT INTO `vendor_products` (`vendor_product_name`, `vendor_product_price`, `vendor_product_status`, `vendor_id`)
SELECT vp.`vendor_product_name`, vp.`vendor_product_price`, vp.`vendor_product_status`, c.`id`
FROM `vendor_products` vp
JOIN `vendors` c ON c.`copied_from` = vp.`vendor_id`;

ALTER TABLE `vendors` DROP COLUMN `copied_from`;

-- CreateIndex
CREATE INDEX `vendors_business_id_idx` ON `vendors`(`business_id`);

-- AddForeignKey
ALTER TABLE `vendors` ADD CONSTRAINT `vendors_business_id_fkey` FOREIGN KEY (`business_id`) REFERENCES `businesses`(`id`) ON DELETE NO ACTION ON UPDATE NO ACTION;
