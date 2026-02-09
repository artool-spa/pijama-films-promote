-- DropIndex
DROP INDEX "AccountTransaction_stripePaymentIntentId_key";

-- AlterTable
ALTER TABLE "AccountTransaction" ADD COLUMN     "grossAmount" DOUBLE PRECISION,
ADD COLUMN     "stripeFee" DOUBLE PRECISION;

-- CreateIndex
CREATE INDEX "AccountTransaction_stripePaymentIntentId_idx" ON "AccountTransaction"("stripePaymentIntentId");
