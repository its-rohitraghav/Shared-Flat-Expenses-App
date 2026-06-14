import * as fs from 'fs';
import * as path from 'path';
import { importCSVToStaging } from '../src/lib/importer';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function run() {
  console.log('--- STARTING CSV IMPORT TEST ---');
  
  // Clear existing staged expenses and real expenses so we can test clean
  await prisma.expenseSplit.deleteMany({});
  await prisma.expense.deleteMany({});
  await prisma.stagedExpense.deleteMany({});
  console.log('Cleared database tables (expenseSplit, expense, stagedExpense) for a clean test.');

  const csvPath = path.join(__dirname, '../expenses_export.csv');
  const csvContent = fs.readFileSync(csvPath, 'utf-8');
  
  const groupId = 'flatmates-group-id';
  
  console.log('Running importCSVToStaging...');
  const results = await importCSVToStaging(csvContent, groupId);
  
  console.log('\n--- IMPORT REPORT SUMMARY ---');
  console.log(`Total Rows Parsed: ${results.length}`);
  
  const approved = results.filter(r => r.status === 'APPROVED');
  const pending = results.filter(r => r.status === 'PENDING');
  
  console.log(`Auto-Approved: ${approved.length}`);
  console.log(`Quarantined (PENDING): ${pending.length}`);
  
  console.log('\n--- DETAILED ANOMALIES LIST ---');
  results.forEach((r, idx) => {
    const rowNum = idx + 2; // header is row 1
    if (r.anomalies.length > 0) {
      console.log(`Row ${rowNum}: [${r.row.date}] "${r.row.description}" | Paid by: "${r.row.paid_by}" | Amount: ${r.row.amount} ${r.row.currency}`);
      console.log(`  - Status: ${r.status}`);
      console.log(`  - Anomalies Detected: ${r.anomalies.join(', ')}`);
      console.log(`  - Details: ${JSON.stringify(r.resolvedValues)}`);
    }
  });

  // Verify created records in DB
  const dbExpenses = await prisma.expense.findMany({
    include: { paidBy: true, splits: { include: { user: true } } }
  });
  console.log(`\nReal Expenses Created in DB: ${dbExpenses.length}`);
  
  const dbStaged = await prisma.stagedExpense.findMany();
  console.log(`Staged Expenses Saved in DB: ${dbStaged.length}`);
}

run()
  .catch(console.error)
  .finally(async () => {
    await prisma.$disconnect();
  });
