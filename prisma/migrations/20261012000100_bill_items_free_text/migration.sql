-- Bill lines are free text (description / qty / price): what a vendor sells you
-- is rarely in your own product catalogue, so the product link becomes optional.

-- DropForeignKey
ALTER TABLE `bill_items` DROP FOREIGN KEY `FKnxfjfage047r297vj65sq8e6h`;

-- AlterTable
ALTER TABLE `bill_items` MODIFY `product_id` BIGINT NULL;

-- AddForeignKey
ALTER TABLE `bill_items` ADD CONSTRAINT `FKnxfjfage047r297vj65sq8e6h` FOREIGN KEY (`product_id`) REFERENCES `products`(`id`) ON DELETE NO ACTION ON UPDATE NO ACTION;
