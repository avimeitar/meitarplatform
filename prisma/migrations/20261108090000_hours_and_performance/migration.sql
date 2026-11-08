-- CreateTable
CREATE TABLE "LeadAssignment" (
    "id" TEXT NOT NULL,
    "leadId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "byId" TEXT,

    CONSTRAINT "LeadAssignment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WorkShift" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "startAt" TIMESTAMP(3) NOT NULL,
    "endAt" TIMESTAMP(3),
    "startKind" TEXT NOT NULL DEFAULT 'signed',
    "endKind" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WorkShift_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ShiftSignature" (
    "id" TEXT NOT NULL,
    "shiftId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "deviceId" TEXT NOT NULL,
    "event" JSONB NOT NULL,
    "response" JSONB NOT NULL,
    "signedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "ip" TEXT,
    "userAgent" TEXT,

    CONSTRAINT "ShiftSignature_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ShiftEdit" (
    "id" TEXT NOT NULL,
    "shiftId" TEXT NOT NULL,
    "byId" TEXT NOT NULL,
    "byName" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "before" JSONB NOT NULL,
    "after" JSONB NOT NULL,
    "signed" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ShiftEdit_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SignDevice" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "credentialId" TEXT NOT NULL,
    "publicKey" BYTEA NOT NULL,
    "counter" INTEGER NOT NULL DEFAULT 0,
    "transports" TEXT[],
    "name" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastUsedAt" TIMESTAMP(3),
    "revokedAt" TIMESTAMP(3),

    CONSTRAINT "SignDevice_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SignChallenge" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "purpose" TEXT NOT NULL,
    "challenge" TEXT NOT NULL,
    "data" JSONB,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "usedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SignChallenge_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "LeadAssignment_userId_at_idx" ON "LeadAssignment"("userId", "at");

-- CreateIndex
CREATE INDEX "LeadAssignment_leadId_idx" ON "LeadAssignment"("leadId");

-- CreateIndex
CREATE INDEX "WorkShift_userId_startAt_idx" ON "WorkShift"("userId", "startAt");

-- CreateIndex
CREATE INDEX "WorkShift_startAt_idx" ON "WorkShift"("startAt");

-- CreateIndex
CREATE INDEX "ShiftSignature_shiftId_idx" ON "ShiftSignature"("shiftId");

-- CreateIndex
CREATE INDEX "ShiftEdit_shiftId_idx" ON "ShiftEdit"("shiftId");

-- CreateIndex
CREATE UNIQUE INDEX "SignDevice_credentialId_key" ON "SignDevice"("credentialId");

-- CreateIndex
CREATE INDEX "SignDevice_userId_idx" ON "SignDevice"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "SignChallenge_challenge_key" ON "SignChallenge"("challenge");

-- CreateIndex
CREATE INDEX "SignChallenge_userId_idx" ON "SignChallenge"("userId");

-- AddForeignKey
ALTER TABLE "LeadAssignment" ADD CONSTRAINT "LeadAssignment_leadId_fkey" FOREIGN KEY ("leadId") REFERENCES "Lead"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkShift" ADD CONSTRAINT "WorkShift_userId_fkey" FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ShiftSignature" ADD CONSTRAINT "ShiftSignature_shiftId_fkey" FOREIGN KEY ("shiftId") REFERENCES "WorkShift"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ShiftEdit" ADD CONSTRAINT "ShiftEdit_shiftId_fkey" FOREIGN KEY ("shiftId") REFERENCES "WorkShift"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SignDevice" ADD CONSTRAINT "SignDevice_userId_fkey" FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- Leads already assigned count for their current owner, from the day they came in
INSERT INTO "LeadAssignment" ("id", "leadId", "userId", "at")
SELECT 'bf_' || "id", "id", "ownerId", "createdAt" FROM "Lead" WHERE "ownerId" IS NOT NULL;

-- Sales managers see and correct the team's hours
UPDATE "Role" SET "permissions" = array_append("permissions", 'hours.manage')
WHERE "key" = 'manager' AND NOT ('hours.manage' = ANY("permissions"));
