-- AlterTable
ALTER TABLE "users" ADD COLUMN "keycloakId" VARCHAR(255);

-- CreateIndex
CREATE UNIQUE INDEX "users_keycloakId_key" ON "users"("keycloakId");

-- CreateIndex
CREATE INDEX "users_keycloakId_idx" ON "users"("keycloakId");
