import { PrismaClient } from '@prisma/client';
import fs from 'fs';
import path from 'path';

let dbUrl = "file:./dev.db";

if (process.env.VERCEL) {
  // On Vercel, filesystem is read-only. We must copy the DB to /tmp to allow SQLite locking.
  const sourcePath = path.join(process.cwd(), 'prisma', 'dev.db');
  const tmpPath = '/tmp/dev.db';
  
  try {
    if (!fs.existsSync(tmpPath)) {
      if (fs.existsSync(sourcePath)) {
        fs.copyFileSync(sourcePath, tmpPath);
        console.log("Copied SQLite DB to /tmp/dev.db");
      } else {
        console.warn("Source dev.db not found at", sourcePath);
      }
    }
  } catch (err) {
    console.error("Failed to copy DB to /tmp:", err);
  }
  
  dbUrl = "file:/tmp/dev.db";
}

const globalForPrisma = global as unknown as { prisma: PrismaClient };

export const prisma =
  globalForPrisma.prisma ||
  new PrismaClient({
    log: ['query'],
    datasources: {
      db: {
        url: dbUrl,
      },
    },
  });

if (process.env.NODE_ENV !== 'production') globalForPrisma.prisma = prisma;
