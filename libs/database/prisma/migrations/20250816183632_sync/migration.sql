-- CreateEnum
CREATE TYPE "public"."StoreStatus" AS ENUM ('ACTIVE', 'SUSPENDED', 'DELETED');

-- CreateEnum
CREATE TYPE "public"."EventType" AS ENUM ('LOGIN', 'LOGOUT', 'CART_CREATED', 'CART_UPDATED', 'CART_ABANDONED', 'ORDER_PLACED', 'ORDER_COMPLETED', 'FEATURE_COMPUTED', 'EXPORT_REQUESTED', 'QUALITY_ALERT', 'RECONCILIATION_RUN', 'OTHER');

-- CreateEnum
CREATE TYPE "public"."UserRoleType" AS ENUM ('ADMIN', 'ANALYST', 'VIEWER', 'USER');

-- CreateEnum
CREATE TYPE "public"."RecoveryStatus" AS ENUM ('PENDING', 'SUCCESS', 'FAILED', 'IGNORED');

-- CreateEnum
CREATE TYPE "public"."ReportStatus" AS ENUM ('PENDING', 'PROCESSING', 'READY', 'FAILED');

-- CreateEnum
CREATE TYPE "public"."UserStatus" AS ENUM ('ACTIVE', 'BANNED', 'INACTIVE', 'DELETED');

-- CreateEnum
CREATE TYPE "public"."ProductStatus" AS ENUM ('ACTIVE', 'INACTIVE', 'ARCHIVED', 'DELETED');

-- CreateEnum
CREATE TYPE "public"."OrderStatus" AS ENUM ('PENDING', 'COMPLETED', 'CANCELLED', 'FAILED');

-- CreateEnum
CREATE TYPE "public"."PaymentStatus" AS ENUM ('PENDING', 'COMPLETED', 'FAILED', 'REFUNDED');

-- CreateEnum
CREATE TYPE "public"."CartStatus" AS ENUM ('ACTIVE', 'ABANDONED', 'CONVERTED', 'EXPIRED');

-- CreateTable
CREATE TABLE "public"."stores" (
    "id" TEXT NOT NULL,
    "name" VARCHAR(255) NOT NULL,
    "url" VARCHAR(255) NOT NULL,
    "ownerId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),
    "isDeleted" BOOLEAN NOT NULL DEFAULT false,
    "status" "public"."StoreStatus" NOT NULL DEFAULT 'ACTIVE',

    CONSTRAINT "stores_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."store_settings" (
    "id" TEXT NOT NULL,
    "storeId" TEXT NOT NULL,
    "config" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "store_settings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."recovery_events" (
    "id" TEXT NOT NULL,
    "cartId" TEXT NOT NULL,
    "storeId" TEXT NOT NULL,
    "userId" TEXT,
    "sessionId" TEXT,
    "eventType" VARCHAR(128) NOT NULL,
    "status" "public"."RecoveryStatus" NOT NULL DEFAULT 'PENDING',
    "outcome" TEXT,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "recovery_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."reports" (
    "id" TEXT NOT NULL,
    "storeId" TEXT NOT NULL,
    "type" VARCHAR(64) NOT NULL,
    "status" "public"."ReportStatus" NOT NULL DEFAULT 'PENDING',
    "data" JSONB,
    "url" TEXT,
    "generatedAt" TIMESTAMP(3),
    "error" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "reports_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."session_activities" (
    "id" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "storeId" TEXT NOT NULL,
    "activity" VARCHAR(128) NOT NULL,
    "timestamp" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "metadata" JSONB,

    CONSTRAINT "session_activities_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."permissions" (
    "id" TEXT NOT NULL,
    "name" VARCHAR(64) NOT NULL,
    "description" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "permissions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."webhooks" (
    "id" TEXT NOT NULL,
    "storeId" TEXT NOT NULL,
    "url" VARCHAR(255) NOT NULL,
    "eventType" VARCHAR(128) NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "lastTriggered" TIMESTAMP(3),
    "metadata" JSONB,

    CONSTRAINT "webhooks_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."users" (
    "id" TEXT NOT NULL,
    "email" VARCHAR(255) NOT NULL,
    "name" VARCHAR(255),
    "status" "public"."UserStatus" NOT NULL DEFAULT 'ACTIVE',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),
    "isDeleted" BOOLEAN NOT NULL DEFAULT false,
    "createdBy" TEXT,
    "updatedBy" TEXT,
    "organizationId" TEXT,
    "auditLog" JSONB,
    "storeId" TEXT,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."user_roles" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "role" VARCHAR(64) NOT NULL,
    "assignedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "revokedAt" TIMESTAMP(3),

    CONSTRAINT "user_roles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."user_sessions" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "sessionId" VARCHAR(128) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "expiresAt" TIMESTAMP(3),
    "ipAddress" TEXT,
    "userAgent" TEXT,
    "metadata" JSONB,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "endedAt" TIMESTAMP(3),

    CONSTRAINT "user_sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."session_logs" (
    "id" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "event" VARCHAR(128) NOT NULL,
    "timestamp" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "metadata" JSONB,

    CONSTRAINT "session_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."user_events" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "sessionId" TEXT,
    "eventType" VARCHAR(128) NOT NULL,
    "timestamp" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "metadata" JSONB,
    "pageUrl" TEXT,
    "userAgent" TEXT,
    "ipAddress" TEXT,
    "isError" BOOLEAN NOT NULL DEFAULT false,
    "errorMsg" TEXT,

    CONSTRAINT "user_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."products" (
    "id" TEXT NOT NULL,
    "name" VARCHAR(255) NOT NULL,
    "description" TEXT,
    "price" DECIMAL(65,30) NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'USD',
    "sku" VARCHAR(128),
    "imageUrl" TEXT,
    "category" TEXT,
    "status" "public"."ProductStatus" NOT NULL DEFAULT 'ACTIVE',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),
    "isDeleted" BOOLEAN NOT NULL DEFAULT false,
    "createdBy" TEXT,
    "updatedBy" TEXT,
    "metadata" JSONB,

    CONSTRAINT "products_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."carts" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "status" "public"."CartStatus" NOT NULL DEFAULT 'ACTIVE',
    "total" DECIMAL(65,30) NOT NULL DEFAULT 0,
    "currency" TEXT NOT NULL DEFAULT 'USD',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),
    "isDeleted" BOOLEAN NOT NULL DEFAULT false,
    "archived" BOOLEAN NOT NULL DEFAULT false,
    "metadata" JSONB,
    "auditLog" JSONB,

    CONSTRAINT "carts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."orders" (
    "id" TEXT NOT NULL,
    "cartId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "status" "public"."OrderStatus" NOT NULL DEFAULT 'PENDING',
    "total" DECIMAL(65,30) NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'USD',
    "paymentId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "completedAt" TIMESTAMP(3),
    "cancelledAt" TIMESTAMP(3),
    "metadata" JSONB,

    CONSTRAINT "orders_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."order_items" (
    "id" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "quantity" INTEGER NOT NULL DEFAULT 1,
    "price" DECIMAL(65,30) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "order_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."payments" (
    "id" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "amount" DECIMAL(65,30) NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'USD',
    "status" "public"."PaymentStatus" NOT NULL DEFAULT 'PENDING',
    "provider" TEXT,
    "transactionId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "completedAt" TIMESTAMP(3),
    "failedAt" TIMESTAMP(3),
    "metadata" JSONB,

    CONSTRAINT "payments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."cart_items" (
    "id" TEXT NOT NULL,
    "cartId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "quantity" INTEGER NOT NULL DEFAULT 1,
    "price" DECIMAL(65,30) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "metadata" JSONB,

    CONSTRAINT "cart_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."features" (
    "id" TEXT NOT NULL,
    "cartId" TEXT NOT NULL,
    "name" VARCHAR(128) NOT NULL,
    "value" JSONB NOT NULL,
    "version" VARCHAR(32) NOT NULL DEFAULT '1.0.0',
    "ttl" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "metadata" JSONB,

    CONSTRAINT "features_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."notifications" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "type" VARCHAR(64) NOT NULL,
    "message" TEXT NOT NULL,
    "read" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "readAt" TIMESTAMP(3),
    "metadata" JSONB,

    CONSTRAINT "notifications_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."config" (
    "id" TEXT NOT NULL,
    "key" VARCHAR(128) NOT NULL,
    "value" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "description" TEXT,

    CONSTRAINT "config_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."_StoreToUserSession" (
    "A" TEXT NOT NULL,
    "B" TEXT NOT NULL,

    CONSTRAINT "_StoreToUserSession_AB_pkey" PRIMARY KEY ("A","B")
);

-- CreateTable
CREATE TABLE "public"."_SessionActivityToUser" (
    "A" TEXT NOT NULL,
    "B" TEXT NOT NULL,

    CONSTRAINT "_SessionActivityToUser_AB_pkey" PRIMARY KEY ("A","B")
);

-- CreateTable
CREATE TABLE "public"."_ProductToStore" (
    "A" TEXT NOT NULL,
    "B" TEXT NOT NULL,

    CONSTRAINT "_ProductToStore_AB_pkey" PRIMARY KEY ("A","B")
);

-- CreateTable
CREATE TABLE "public"."_CartToStore" (
    "A" TEXT NOT NULL,
    "B" TEXT NOT NULL,

    CONSTRAINT "_CartToStore_AB_pkey" PRIMARY KEY ("A","B")
);

-- CreateIndex
CREATE UNIQUE INDEX "stores_url_key" ON "public"."stores"("url");

-- CreateIndex
CREATE INDEX "stores_ownerId_idx" ON "public"."stores"("ownerId");

-- CreateIndex
CREATE UNIQUE INDEX "store_settings_storeId_key" ON "public"."store_settings"("storeId");

-- CreateIndex
CREATE INDEX "recovery_events_eventType_idx" ON "public"."recovery_events"("eventType");

-- CreateIndex
CREATE INDEX "recovery_events_status_idx" ON "public"."recovery_events"("status");

-- CreateIndex
CREATE INDEX "reports_type_idx" ON "public"."reports"("type");

-- CreateIndex
CREATE INDEX "reports_status_idx" ON "public"."reports"("status");

-- CreateIndex
CREATE INDEX "session_activities_activity_idx" ON "public"."session_activities"("activity");

-- CreateIndex
CREATE UNIQUE INDEX "permissions_name_key" ON "public"."permissions"("name");

-- CreateIndex
CREATE INDEX "webhooks_eventType_idx" ON "public"."webhooks"("eventType");

-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "public"."users"("email");

-- CreateIndex
CREATE INDEX "users_email_idx" ON "public"."users"("email");

-- CreateIndex
CREATE INDEX "users_status_idx" ON "public"."users"("status");

-- CreateIndex
CREATE INDEX "user_roles_role_idx" ON "public"."user_roles"("role");

-- CreateIndex
CREATE UNIQUE INDEX "user_sessions_sessionId_key" ON "public"."user_sessions"("sessionId");

-- CreateIndex
CREATE INDEX "user_sessions_sessionId_idx" ON "public"."user_sessions"("sessionId");

-- CreateIndex
CREATE INDEX "session_logs_event_idx" ON "public"."session_logs"("event");

-- CreateIndex
CREATE INDEX "user_events_eventType_idx" ON "public"."user_events"("eventType");

-- CreateIndex
CREATE UNIQUE INDEX "products_sku_key" ON "public"."products"("sku");

-- CreateIndex
CREATE INDEX "products_sku_idx" ON "public"."products"("sku");

-- CreateIndex
CREATE INDEX "carts_status_idx" ON "public"."carts"("status");

-- CreateIndex
CREATE INDEX "carts_userId_idx" ON "public"."carts"("userId");

-- CreateIndex
CREATE INDEX "orders_status_idx" ON "public"."orders"("status");

-- CreateIndex
CREATE UNIQUE INDEX "order_items_orderId_productId_key" ON "public"."order_items"("orderId", "productId");

-- CreateIndex
CREATE INDEX "payments_status_idx" ON "public"."payments"("status");

-- CreateIndex
CREATE UNIQUE INDEX "cart_items_cartId_productId_key" ON "public"."cart_items"("cartId", "productId");

-- CreateIndex
CREATE INDEX "features_version_idx" ON "public"."features"("version");

-- CreateIndex
CREATE UNIQUE INDEX "features_cartId_name_key" ON "public"."features"("cartId", "name");

-- CreateIndex
CREATE INDEX "notifications_type_idx" ON "public"."notifications"("type");

-- CreateIndex
CREATE UNIQUE INDEX "config_key_key" ON "public"."config"("key");

-- CreateIndex
CREATE INDEX "_StoreToUserSession_B_index" ON "public"."_StoreToUserSession"("B");

-- CreateIndex
CREATE INDEX "_SessionActivityToUser_B_index" ON "public"."_SessionActivityToUser"("B");

-- CreateIndex
CREATE INDEX "_ProductToStore_B_index" ON "public"."_ProductToStore"("B");

-- CreateIndex
CREATE INDEX "_CartToStore_B_index" ON "public"."_CartToStore"("B");

-- AddForeignKey
ALTER TABLE "public"."store_settings" ADD CONSTRAINT "store_settings_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "public"."stores"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."recovery_events" ADD CONSTRAINT "recovery_events_cartId_fkey" FOREIGN KEY ("cartId") REFERENCES "public"."carts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."recovery_events" ADD CONSTRAINT "recovery_events_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "public"."stores"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."recovery_events" ADD CONSTRAINT "recovery_events_userId_fkey" FOREIGN KEY ("userId") REFERENCES "public"."users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."recovery_events" ADD CONSTRAINT "recovery_events_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "public"."user_sessions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."reports" ADD CONSTRAINT "reports_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "public"."stores"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."session_activities" ADD CONSTRAINT "session_activities_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "public"."user_sessions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."session_activities" ADD CONSTRAINT "session_activities_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "public"."stores"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."webhooks" ADD CONSTRAINT "webhooks_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "public"."stores"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."users" ADD CONSTRAINT "users_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "public"."stores"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."user_roles" ADD CONSTRAINT "user_roles_userId_fkey" FOREIGN KEY ("userId") REFERENCES "public"."users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."user_sessions" ADD CONSTRAINT "user_sessions_userId_fkey" FOREIGN KEY ("userId") REFERENCES "public"."users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."session_logs" ADD CONSTRAINT "session_logs_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "public"."user_sessions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."user_events" ADD CONSTRAINT "user_events_userId_fkey" FOREIGN KEY ("userId") REFERENCES "public"."users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."user_events" ADD CONSTRAINT "user_events_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "public"."user_sessions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."carts" ADD CONSTRAINT "carts_userId_fkey" FOREIGN KEY ("userId") REFERENCES "public"."users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."orders" ADD CONSTRAINT "orders_cartId_fkey" FOREIGN KEY ("cartId") REFERENCES "public"."carts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."orders" ADD CONSTRAINT "orders_userId_fkey" FOREIGN KEY ("userId") REFERENCES "public"."users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."order_items" ADD CONSTRAINT "order_items_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "public"."orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."order_items" ADD CONSTRAINT "order_items_productId_fkey" FOREIGN KEY ("productId") REFERENCES "public"."products"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."payments" ADD CONSTRAINT "payments_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "public"."orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."cart_items" ADD CONSTRAINT "cart_items_cartId_fkey" FOREIGN KEY ("cartId") REFERENCES "public"."carts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."cart_items" ADD CONSTRAINT "cart_items_productId_fkey" FOREIGN KEY ("productId") REFERENCES "public"."products"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."features" ADD CONSTRAINT "features_cartId_fkey" FOREIGN KEY ("cartId") REFERENCES "public"."carts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."notifications" ADD CONSTRAINT "notifications_userId_fkey" FOREIGN KEY ("userId") REFERENCES "public"."users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."_StoreToUserSession" ADD CONSTRAINT "_StoreToUserSession_A_fkey" FOREIGN KEY ("A") REFERENCES "public"."stores"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."_StoreToUserSession" ADD CONSTRAINT "_StoreToUserSession_B_fkey" FOREIGN KEY ("B") REFERENCES "public"."user_sessions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."_SessionActivityToUser" ADD CONSTRAINT "_SessionActivityToUser_A_fkey" FOREIGN KEY ("A") REFERENCES "public"."session_activities"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."_SessionActivityToUser" ADD CONSTRAINT "_SessionActivityToUser_B_fkey" FOREIGN KEY ("B") REFERENCES "public"."users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."_ProductToStore" ADD CONSTRAINT "_ProductToStore_A_fkey" FOREIGN KEY ("A") REFERENCES "public"."products"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."_ProductToStore" ADD CONSTRAINT "_ProductToStore_B_fkey" FOREIGN KEY ("B") REFERENCES "public"."stores"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."_CartToStore" ADD CONSTRAINT "_CartToStore_A_fkey" FOREIGN KEY ("A") REFERENCES "public"."carts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."_CartToStore" ADD CONSTRAINT "_CartToStore_B_fkey" FOREIGN KEY ("B") REFERENCES "public"."stores"("id") ON DELETE CASCADE ON UPDATE CASCADE;
