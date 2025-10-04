/*
  Warnings:

  - You are about to drop the column `check` on the `QualityValidation` table. All the data in the column will be lost.
  - You are about to drop the column `table` on the `QualityValidation` table. All the data in the column will be lost.
  - You are about to drop the column `timestamp` on the `QualityValidation` table. All the data in the column will be lost.
  - The `status` column on the `QualityValidation` table would be dropped and recreated. This will lead to data loss if there is data in the column.
  - You are about to alter the column `executionTime` on the `ReconciliationExecution` table. The data in that column could be lost. The data in that column will be cast from `DoublePrecision` to `Decimal(65,30)`.
  - The `details` column on the `ReconciliationExecution` table would be dropped and recreated. This will lead to data loss if there is data in the column.
  - You are about to drop the `_SessionActivityToUser` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `_StoreToUserSession` table. If the table is not empty, all the data it contains will be lost.
  - A unique constraint covering the columns `[token]` on the table `user_sessions` will be added. If there are existing duplicate values, this will fail.
  - Added the required column `tableName` to the `QualityAnomaly` table without a default value. This is not possible if the table is not empty.
  - Changed the type of `type` on the `QualityAnomaly` table. No cast exists, the column would be dropped and recreated, which cannot be done if there is data, since the column is required.
  - Added the required column `checkName` to the `QualityValidation` table without a default value. This is not possible if the table is not empty.
  - Added the required column `checkType` to the `QualityValidation` table without a default value. This is not possible if the table is not empty.
  - Added the required column `tableName` to the `QualityValidation` table without a default value. This is not possible if the table is not empty.
  - Added the required column `userId` to the `session_activities` table without a default value. This is not possible if the table is not empty.
  - Added the required column `storeId` to the `user_sessions` table without a default value. This is not possible if the table is not empty.
  - Added the required column `token` to the `user_sessions` table without a default value. This is not possible if the table is not empty.

*/
-- CreateEnum
CREATE TYPE "public"."ValidationStatus" AS ENUM ('PASSED', 'FAILED', 'WARNING', 'ERROR');

-- CreateEnum
CREATE TYPE "public"."ValidationSeverity" AS ENUM ('LOW', 'MEDIUM', 'HIGH', 'CRITICAL');

-- CreateEnum
CREATE TYPE "public"."QualityCheckType" AS ENUM ('NULL_CHECK', 'DUPLICATE_CHECK', 'RANGE_CHECK', 'FORMAT_CHECK', 'REFERENCE_CHECK', 'CONSISTENCY_CHECK');

-- CreateEnum
CREATE TYPE "public"."AnomalyType" AS ENUM ('OUTLIER', 'MISSING_DATA', 'DUPLICATE', 'INCONSISTENT', 'INVALID_FORMAT', 'REFERENCE_ERROR');

-- DropForeignKey
ALTER TABLE "public"."_SessionActivityToUser" DROP CONSTRAINT "_SessionActivityToUser_A_fkey";

-- DropForeignKey
ALTER TABLE "public"."_SessionActivityToUser" DROP CONSTRAINT "_SessionActivityToUser_B_fkey";

-- DropForeignKey
ALTER TABLE "public"."_StoreToUserSession" DROP CONSTRAINT "_StoreToUserSession_A_fkey";

-- DropForeignKey
ALTER TABLE "public"."_StoreToUserSession" DROP CONSTRAINT "_StoreToUserSession_B_fkey";

-- AlterTable
ALTER TABLE "public"."QualityAnomaly" ADD COLUMN     "affectedRows" INTEGER NOT NULL DEFAULT 1,
ADD COLUMN     "columnName" VARCHAR(128),
ADD COLUMN     "recordId" TEXT,
ADD COLUMN     "resolved" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "resolvedAt" TIMESTAMP(3),
ADD COLUMN     "sampleData" JSONB,
ADD COLUMN     "severity" "public"."ValidationSeverity" NOT NULL DEFAULT 'MEDIUM',
ADD COLUMN     "tableName" VARCHAR(128) NOT NULL,
DROP COLUMN "type",
ADD COLUMN     "type" "public"."AnomalyType" NOT NULL;

-- AlterTable
ALTER TABLE "public"."QualityValidation" DROP COLUMN "check",
DROP COLUMN "table",
DROP COLUMN "timestamp",
ADD COLUMN     "affectedRows" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "checkName" VARCHAR(255) NOT NULL,
ADD COLUMN     "checkType" "public"."QualityCheckType" NOT NULL,
ADD COLUMN     "details" JSONB,
ADD COLUMN     "executedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
ADD COLUMN     "executionTime" DECIMAL(65,30),
ADD COLUMN     "severity" "public"."ValidationSeverity" NOT NULL DEFAULT 'MEDIUM',
ADD COLUMN     "tableName" VARCHAR(128) NOT NULL,
DROP COLUMN "status",
ADD COLUMN     "status" "public"."ValidationStatus" NOT NULL DEFAULT 'PASSED';

-- AlterTable
ALTER TABLE "public"."ReconciliationExecution" ADD COLUMN     "errorMessage" TEXT,
ALTER COLUMN "executionTime" SET DATA TYPE DECIMAL(65,30),
DROP COLUMN "details",
ADD COLUMN     "details" JSONB;

-- AlterTable
ALTER TABLE "public"."session_activities" ADD COLUMN     "userId" TEXT NOT NULL;

-- AlterTable
ALTER TABLE "public"."user_sessions" ADD COLUMN     "storeId" TEXT NOT NULL,
ADD COLUMN     "token" VARCHAR(255) NOT NULL;

-- AlterTable
ALTER TABLE "public"."users" ADD COLUMN     "image" TEXT,
ADD COLUMN     "name" VARCHAR(255);

-- DropTable
DROP TABLE "public"."_SessionActivityToUser";

-- DropTable
DROP TABLE "public"."_StoreToUserSession";

-- CreateTable
CREATE TABLE "public"."accounts" (
    "id" TEXT NOT NULL,
    "accountId" VARCHAR(255) NOT NULL,
    "providerId" VARCHAR(255) NOT NULL,
    "userId" TEXT NOT NULL,
    "accessToken" TEXT,
    "refreshToken" TEXT,
    "idToken" TEXT,
    "accessTokenExpiresAt" TIMESTAMP(3),
    "refreshTokenExpiresAt" TIMESTAMP(3),
    "scope" TEXT,
    "password" VARCHAR(255),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "accounts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."verifications" (
    "id" TEXT NOT NULL,
    "identifier" VARCHAR(255) NOT NULL,
    "value" VARCHAR(255) NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "verifications_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "accounts_userId_idx" ON "public"."accounts"("userId");

-- CreateIndex
CREATE INDEX "accounts_providerId_idx" ON "public"."accounts"("providerId");

-- CreateIndex
CREATE UNIQUE INDEX "accounts_providerId_accountId_key" ON "public"."accounts"("providerId", "accountId");

-- CreateIndex
CREATE INDEX "verifications_identifier_idx" ON "public"."verifications"("identifier");

-- CreateIndex
CREATE INDEX "verifications_expiresAt_idx" ON "public"."verifications"("expiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "verifications_identifier_value_key" ON "public"."verifications"("identifier", "value");

-- CreateIndex
CREATE INDEX "QualityAnomaly_type_idx" ON "public"."QualityAnomaly"("type");

-- CreateIndex
CREATE INDEX "QualityAnomaly_tableName_idx" ON "public"."QualityAnomaly"("tableName");

-- CreateIndex
CREATE INDEX "QualityAnomaly_resolved_idx" ON "public"."QualityAnomaly"("resolved");

-- CreateIndex
CREATE INDEX "QualityAnomaly_timestamp_idx" ON "public"."QualityAnomaly"("timestamp");

-- CreateIndex
CREATE INDEX "QualityValidation_tableName_idx" ON "public"."QualityValidation"("tableName");

-- CreateIndex
CREATE INDEX "QualityValidation_status_idx" ON "public"."QualityValidation"("status");

-- CreateIndex
CREATE INDEX "QualityValidation_executedAt_idx" ON "public"."QualityValidation"("executedAt");

-- CreateIndex
CREATE INDEX "ReconciliationExecution_status_idx" ON "public"."ReconciliationExecution"("status");

-- CreateIndex
CREATE INDEX "ReconciliationExecution_executedAt_idx" ON "public"."ReconciliationExecution"("executedAt");

-- CreateIndex
CREATE INDEX "api_keys_expiresAt_idx" ON "public"."api_keys"("expiresAt");

-- CreateIndex
CREATE INDEX "carts_createdAt_idx" ON "public"."carts"("createdAt");

-- CreateIndex
CREATE INDEX "notifications_read_idx" ON "public"."notifications"("read");

-- CreateIndex
CREATE INDEX "notifications_createdAt_idx" ON "public"."notifications"("createdAt");

-- CreateIndex
CREATE INDEX "orders_userId_idx" ON "public"."orders"("userId");

-- CreateIndex
CREATE INDEX "orders_createdAt_idx" ON "public"."orders"("createdAt");

-- CreateIndex
CREATE INDEX "payments_createdAt_idx" ON "public"."payments"("createdAt");

-- CreateIndex
CREATE INDEX "recovery_events_createdAt_idx" ON "public"."recovery_events"("createdAt");

-- CreateIndex
CREATE INDEX "reports_createdAt_idx" ON "public"."reports"("createdAt");

-- CreateIndex
CREATE INDEX "session_activities_userId_idx" ON "public"."session_activities"("userId");

-- CreateIndex
CREATE INDEX "session_activities_timestamp_idx" ON "public"."session_activities"("timestamp");

-- CreateIndex
CREATE INDEX "stores_status_idx" ON "public"."stores"("status");

-- CreateIndex
CREATE INDEX "stores_createdAt_idx" ON "public"."stores"("createdAt");

-- CreateIndex
CREATE INDEX "user_events_userId_timestamp_idx" ON "public"."user_events"("userId", "timestamp");

-- CreateIndex
CREATE INDEX "user_events_sessionId_timestamp_idx" ON "public"."user_events"("sessionId", "timestamp");

-- CreateIndex
CREATE INDEX "user_events_timestamp_idx" ON "public"."user_events"("timestamp");

-- CreateIndex
CREATE UNIQUE INDEX "user_sessions_token_key" ON "public"."user_sessions"("token");

-- CreateIndex
CREATE INDEX "user_sessions_expiresAt_idx" ON "public"."user_sessions"("expiresAt");

-- CreateIndex
CREATE INDEX "user_sessions_lastAccessedAt_idx" ON "public"."user_sessions"("lastAccessedAt");

-- CreateIndex
CREATE INDEX "user_sessions_isActive_expiresAt_idx" ON "public"."user_sessions"("isActive", "expiresAt");

-- CreateIndex
CREATE INDEX "user_sessions_token_idx" ON "public"."user_sessions"("token");

-- CreateIndex
CREATE INDEX "webhooks_isActive_idx" ON "public"."webhooks"("isActive");

-- CreateIndex
CREATE INDEX "webhooks_lastTriggered_idx" ON "public"."webhooks"("lastTriggered");

-- AddForeignKey
ALTER TABLE "public"."session_activities" ADD CONSTRAINT "session_activities_userId_fkey" FOREIGN KEY ("userId") REFERENCES "public"."users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."user_sessions" ADD CONSTRAINT "user_sessions_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "public"."stores"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."accounts" ADD CONSTRAINT "accounts_userId_fkey" FOREIGN KEY ("userId") REFERENCES "public"."users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
