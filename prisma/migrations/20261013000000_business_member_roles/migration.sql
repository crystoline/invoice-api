-- Per-member roles inside a business (ADMIN | MEMBER | VIEWER). The owner stays
-- implicit via businesses.owner_id. Existing members keep today's access level.

-- AlterTable
ALTER TABLE `business_members` ADD COLUMN `role` VARCHAR(16) NOT NULL DEFAULT 'MEMBER';
