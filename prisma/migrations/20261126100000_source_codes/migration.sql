-- CreateTable
CREATE TABLE "SourceCode" (
    "code" TEXT NOT NULL,
    "source" TEXT,
    "projectId" TEXT,
    "seen" INTEGER NOT NULL DEFAULT 0,
    "lastAt" TIMESTAMP(3),
    "lastKey" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SourceCode_pkey" PRIMARY KEY ("code")
);

