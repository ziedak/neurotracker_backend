/*
  Warnings:

  - You are about to drop the column `accessToken` on the `user_sessions` table. All the data in the column will be lost.
  - You are about to drop the column `idToken` on the `user_sessions` table. All the data in the column will be lost.
  - You are about to drop the column `refreshExpiresAt` on the `user_sessions` table. All the data in the column will be lost.
  - You are about to drop the column `refreshToken` on the `user_sessions` table. All the data in the column will be lost.
  - You are about to drop the column `tokenExpiresAt` on the `user_sessions` table. All the data in the column will be lost.

*/
-- AlterTable
ALTER TABLE "public"."accounts" ADD COLUMN     "lastTokenRefresh" TIMESTAMP(3),
ADD COLUMN     "tokenType" VARCHAR(50) DEFAULT 'Bearer';

-- AlterTable
ALTER TABLE "public"."user_sessions" DROP COLUMN "accessToken",
DROP COLUMN "idToken",
DROP COLUMN "refreshExpiresAt",
DROP COLUMN "refreshToken",
DROP COLUMN "tokenExpiresAt",
ADD COLUMN     "accountId" TEXT;

-- CreateIndex
CREATE INDEX "accounts_accessTokenExpiresAt_idx" ON "public"."accounts"("accessTokenExpiresAt");

-- CreateIndex
CREATE INDEX "user_sessions_accountId_idx" ON "public"."user_sessions"("accountId");

-- AddForeignKey
ALTER TABLE "public"."user_sessions" ADD CONSTRAINT "user_sessions_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "public"."accounts"("id") ON DELETE SET NULL ON UPDATE CASCADE;
