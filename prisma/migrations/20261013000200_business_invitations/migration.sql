-- Invitations move from an in-memory map (lost on restart, not shared across
-- instances) to a table, and carry the role the invitee gets on joining.

-- CreateTable
CREATE TABLE `business_invitations` (
    `id` BIGINT NOT NULL AUTO_INCREMENT,
    `business_id` BIGINT NOT NULL,
    `email` VARCHAR(255) NOT NULL,
    `role` VARCHAR(16) NOT NULL DEFAULT 'MEMBER',
    `code` VARCHAR(64) NOT NULL,
    `invited_by` BIGINT NULL,
    `expires_at` DATETIME(6) NOT NULL,
    `accepted_at` DATETIME(6) NULL,
    `accepted_by` BIGINT NULL,
    `created_at` DATETIME(3) NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `business_invitations_code_key`(`code`),
    INDEX `business_invitations_business_id_idx`(`business_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `business_invitations` ADD CONSTRAINT `business_invitations_business_id_fkey` FOREIGN KEY (`business_id`) REFERENCES `businesses`(`id`) ON DELETE CASCADE ON UPDATE NO ACTION;
