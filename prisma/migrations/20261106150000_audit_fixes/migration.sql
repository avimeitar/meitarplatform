-- AlterTable
ALTER TABLE "Inquiry" ADD COLUMN     "externalId" TEXT;

-- CreateIndex
CREATE INDEX "Activity_userId_createdAt_idx" ON "Activity"("userId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "Inquiry_externalId_key" ON "Inquiry"("externalId");

-- CreateIndex
CREATE INDEX "Task_done_dueAt_idx" ON "Task"("done", "dueAt");


-- Gender-neutral wording for stored reasons and sources
UPDATE "Lead" SET "lostReason" = 'הכחשת פנייה' WHERE "lostReason" = 'מכחיש פנייה';
UPDATE "Lead" SET "lostReason" = 'אין עניין' WHERE "lostReason" = 'לא מעוניין';
UPDATE "Lead" SET "lostReason" = 'רכישה במקום אחר' WHERE "lostReason" = 'רכש במקום אחר';
UPDATE "Lead" SET "source" = 'הגעה למשרד' WHERE "source" = 'הגיע למשרד';
UPDATE "Inquiry" SET "source" = 'הגעה למשרד' WHERE "source" = 'הגיע למשרד';
