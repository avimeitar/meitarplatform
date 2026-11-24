-- CreateTable
CREATE TABLE "MetaPage" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "connectedById" TEXT,
    "connectedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastLeadAt" TIMESTAMP(3),
    "lastPullAt" TIMESTAMP(3),
    "lastError" TEXT,
    "supplier" TEXT,
    "source" TEXT,
    "projectId" TEXT,
    "inviteId" TEXT,

    CONSTRAINT "MetaPage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MetaInvite" (
    "id" TEXT NOT NULL,
    "hash" TEXT NOT NULL,
    "supplier" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "projectId" TEXT,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "usedAt" TIMESTAMP(3),
    "revokedAt" TIMESTAMP(3),

    CONSTRAINT "MetaInvite_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MetaForm" (
    "id" TEXT NOT NULL,
    "pageId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "projectId" TEXT,
    "leads" INTEGER NOT NULL DEFAULT 0,
    "lastLeadAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MetaForm_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "MetaInvite_hash_key" ON "MetaInvite"("hash");

-- CreateIndex
CREATE INDEX "MetaForm_pageId_idx" ON "MetaForm"("pageId");

-- AddForeignKey
ALTER TABLE "MetaForm" ADD CONSTRAINT "MetaForm_pageId_fkey" FOREIGN KEY ("pageId") REFERENCES "MetaPage"("id") ON DELETE CASCADE ON UPDATE CASCADE;

