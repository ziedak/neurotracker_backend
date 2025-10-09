/*
  Warnings:

  - You are about to drop the column `sessionId` on the `user_sessions` table. All the data in the column will be lost.
  - You are about to drop the column `storeId` on the `user_sessions` table. All the data in the column will be lost.
  - You are about to drop the column `token` on the `user_sessions` table. All the data in the column will be lost.
  - A unique constraint covering the columns `[keycloakSessionId]` on the table `user_sessions` will be added. If there are existing duplicate values, this will fail.

*/
-- DropForeignKey
ALTER TABLE "public"."user_sessions" DROP CONSTRAINT "user_sessions_storeId_fkey";

-- DropIndex
DROP INDEX "public"."user_sessions_sessionId_idx";

-- DropIndex
DROP INDEX "public"."user_sessions_sessionId_key";

-- DropIndex
DROP INDEX "public"."user_sessions_token_idx";

-- DropIndex
DROP INDEX "public"."user_sessions_token_key";

-- AlterTable
ALTER TABLE "public"."user_sessions" DROP COLUMN "sessionId",
DROP COLUMN "storeId",
DROP COLUMN "token";

-- CreateIndex
CREATE UNIQUE INDEX "user_sessions_keycloakSessionId_key" ON "public"."user_sessions"("keycloakSessionId");
