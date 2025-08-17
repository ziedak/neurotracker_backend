-- CreateTable
CREATE TABLE "public"."QualityValidation" (
    "id" TEXT NOT NULL,
    "table" TEXT NOT NULL,
    "check" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "timestamp" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "QualityValidation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."QualityAnomaly" (
    "id" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "details" JSONB,
    "timestamp" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "QualityAnomaly_pkey" PRIMARY KEY ("id")
);
