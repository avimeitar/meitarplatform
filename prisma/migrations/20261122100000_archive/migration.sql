-- CreateTable
CREATE TABLE "ArchiveBatch" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "byId" TEXT,
    "byName" TEXT NOT NULL,
    "kept" TEXT[],
    "counts" JSONB NOT NULL,

    CONSTRAINT "ArchiveBatch_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ArchiveRecord" (
    "id" TEXT NOT NULL,
    "batchId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "originalId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "phone" TEXT,
    "project" TEXT,
    "status" TEXT,
    "owner" TEXT,
    "at" TIMESTAMP(3) NOT NULL,
    "data" JSONB NOT NULL,

    CONSTRAINT "ArchiveRecord_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ArchiveRecord_kind_at_idx" ON "ArchiveRecord"("kind", "at");

-- CreateIndex
CREATE INDEX "ArchiveRecord_phone_idx" ON "ArchiveRecord"("phone");

-- CreateIndex
CREATE INDEX "ArchiveRecord_batchId_idx" ON "ArchiveRecord"("batchId");

-- AddForeignKey
ALTER TABLE "ArchiveRecord" ADD CONSTRAINT "ArchiveRecord_batchId_fkey" FOREIGN KEY ("batchId") REFERENCES "ArchiveBatch"("id") ON DELETE CASCADE ON UPDATE CASCADE;

