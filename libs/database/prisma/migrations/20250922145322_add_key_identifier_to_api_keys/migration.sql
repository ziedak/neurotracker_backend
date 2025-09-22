/*
  Warnings:

  - Added the required column `keyIdentifier` to the `api_keys` table without a default value. This is not possible if the table is not empty.

*/
-- AlterTable
ALTER TABLE "public"."api_keys" ADD COLUMN     "keyIdentifier" VARCHAR(64) NOT NULL;

-- AlterTable
ALTER TABLE "public"."user_sessions" ADD COLUMN     "accessToken" TEXT,
ADD COLUMN     "fingerprint" VARCHAR(64),
ADD COLUMN     "idToken" TEXT,
ADD COLUMN     "keycloakSessionId" VARCHAR(255),
ADD COLUMN     "lastAccessedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
ADD COLUMN     "refreshExpiresAt" TIMESTAMP(3),
ADD COLUMN     "refreshToken" TEXT,
ADD COLUMN     "tokenExpiresAt" TIMESTAMP(3);

-- CreateIndex
CREATE INDEX "api_keys_keyIdentifier_idx" ON "public"."api_keys"("keyIdentifier");

-- CreateIndex
CREATE INDEX "user_sessions_userId_idx" ON "public"."user_sessions"("userId");

-- CreateIndex
CREATE INDEX "user_sessions_keycloakSessionId_idx" ON "public"."user_sessions"("keycloakSessionId");
