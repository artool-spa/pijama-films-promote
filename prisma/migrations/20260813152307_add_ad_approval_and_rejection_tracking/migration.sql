-- CreateEnum
CREATE TYPE "AdApprovalStatus" AS ENUM ('UNKNOWN', 'PENDING_REVIEW', 'APPROVED', 'APPROVED_LIMITED', 'DISAPPROVED', 'APPEALED');

-- AlterTable
ALTER TABLE "Ad" ADD COLUMN     "approvalCheckedAt" TIMESTAMP(3),
ADD COLUMN     "approvalStatus" "AdApprovalStatus" NOT NULL DEFAULT 'UNKNOWN',
ADD COLUMN     "rejectionDetails" JSONB,
ADD COLUMN     "rejectionReason" TEXT,
ADD COLUMN     "reviewSeenAt" TIMESTAMP(3),
ADD COLUMN     "suggestedCorrection" TEXT;

-- AlterTable
ALTER TABLE "Campaign" ADD COLUMN     "approvalSummary" TEXT,
ADD COLUMN     "lastSyncError" TEXT,
ADD COLUMN     "lastSyncErrorAt" TIMESTAMP(3),
ADD COLUMN     "lastSyncErrorDetails" JSONB;

-- CreateIndex
CREATE INDEX "Ad_approvalStatus_idx" ON "Ad"("approvalStatus");
