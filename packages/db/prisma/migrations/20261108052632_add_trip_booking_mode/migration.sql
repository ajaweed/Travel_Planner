-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_Trip" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "title" TEXT,
    "bookingMode" TEXT NOT NULL DEFAULT 'SELF',
    "rawPrompt" TEXT NOT NULL,
    "briefJson" TEXT NOT NULL,
    "budgetTotalCents" INTEGER NOT NULL,
    "budgetSpentCents" INTEGER NOT NULL DEFAULT 0,
    "currency" TEXT NOT NULL DEFAULT 'USD',
    "startDate" DATETIME,
    "endDate" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Trip_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
INSERT INTO "new_Trip" ("briefJson", "budgetSpentCents", "budgetTotalCents", "createdAt", "currency", "endDate", "id", "rawPrompt", "startDate", "status", "title", "updatedAt", "userId") SELECT "briefJson", "budgetSpentCents", "budgetTotalCents", "createdAt", "currency", "endDate", "id", "rawPrompt", "startDate", "status", "title", "updatedAt", "userId" FROM "Trip";
DROP TABLE "Trip";
ALTER TABLE "new_Trip" RENAME TO "Trip";
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
