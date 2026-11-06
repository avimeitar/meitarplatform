-- DropForeignKey
ALTER TABLE "Meeting" DROP CONSTRAINT "Meeting_leadId_fkey";

-- AlterTable
ALTER TABLE "Meeting" ADD COLUMN     "clientName" TEXT,
ADD COLUMN     "externalId" TEXT,
ADD COLUMN     "repName" TEXT,
ADD COLUMN     "source" TEXT,
ADD COLUMN     "subject" TEXT,
ALTER COLUMN "leadId" DROP NOT NULL;

-- CreateIndex
CREATE UNIQUE INDEX "Meeting_externalId_key" ON "Meeting"("externalId");

-- CreateIndex
CREATE INDEX "Meeting_status_startAt_idx" ON "Meeting"("status", "startAt");

-- AddForeignKey
ALTER TABLE "Meeting" ADD CONSTRAINT "Meeting_leadId_fkey" FOREIGN KEY ("leadId") REFERENCES "Lead"("id") ON DELETE SET NULL ON UPDATE CASCADE;

