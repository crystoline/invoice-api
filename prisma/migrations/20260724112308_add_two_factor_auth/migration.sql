-- AlterTable
ALTER TABLE `users` ADD COLUMN `totp_secret` VARCHAR(255) NULL,
    ADD COLUMN `twofa_confirmed_at` DATETIME(6) NULL,
    ADD COLUMN `twofa_enabled` BOOLEAN NULL DEFAULT false;

-- CreateTable
CREATE TABLE `user_recovery_codes` (
    `id` BIGINT NOT NULL AUTO_INCREMENT,
    `user_id` BIGINT NOT NULL,
    `code_hash` VARCHAR(255) NOT NULL,
    `used_at` DATETIME(6) NULL,
    `created_at` DATETIME(3) NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `FK_recovery_codes_user`(`user_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `user_recovery_codes` ADD CONSTRAINT `FK_recovery_codes_user` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE NO ACTION ON UPDATE NO ACTION;

