-- CreateTable
CREATE TABLE "ItineraryOption" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "tripId" TEXT NOT NULL,
    "optionIndex" INTEGER NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PROPOSED',
    "label" TEXT NOT NULL,
    "summary" TEXT NOT NULL,
    "pace" TEXT NOT NULL,
    "estimatedTotalCents" INTEGER NOT NULL,
    "currency" TEXT NOT NULL,
    "draftJson" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "ItineraryOption_tripId_fkey" FOREIGN KEY ("tripId") REFERENCES "Trip" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateIndex
CREATE UNIQUE INDEX "ItineraryOption_tripId_optionIndex_key" ON "ItineraryOption"("tripId", "optionIndex");
