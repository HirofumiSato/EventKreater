-- CreateEnum
CREATE TYPE "PlatformRole" AS ENUM ('MEMBER', 'ADMIN');

-- AlterTable
ALTER TABLE "users" ADD COLUMN "platform_role" "PlatformRole" NOT NULL DEFAULT 'MEMBER';
