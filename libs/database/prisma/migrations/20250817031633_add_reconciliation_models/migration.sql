-- CreateTable
CREATE TABLE "public"."ReconciliationRule" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "sourceTable" TEXT NOT NULL,
    "targetTable" TEXT NOT NULL,
    "joinKey" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "sourceColumns" TEXT,
    "targetColumns" TEXT,
    "tolerance" DOUBLE PRECISION,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ReconciliationRule_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."ReconciliationExecution" (
    "id" TEXT NOT NULL,
    "ruleId" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "recordsChecked" INTEGER NOT NULL,
    "discrepancies" INTEGER NOT NULL,
    "executedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "executionTime" DOUBLE PRECISION NOT NULL,
    "details" TEXT,

    CONSTRAINT "ReconciliationExecution_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."RepairOperation" (
    "id" TEXT NOT NULL,
    "operationId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "error" TEXT,
    "executedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RepairOperation_pkey" PRIMARY KEY ("id")
);

-- AddForeignKey
ALTER TABLE "public"."ReconciliationExecution" ADD CONSTRAINT "ReconciliationExecution_ruleId_fkey" FOREIGN KEY ("ruleId") REFERENCES "public"."ReconciliationRule"("id") ON DELETE CASCADE ON UPDATE CASCADE;
