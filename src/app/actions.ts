'use server';

import { prisma } from '@/lib/db';
import { importCSVToStaging, convertStagedToExpense, resolveUserName } from '@/lib/importer';
import { revalidatePath } from 'next/cache';

const GROUP_ID = 'flatmates-group-id';

export async function resetDatabaseAction() {
  console.log('Server Action: Resetting Database...');
  
  // Clear ledger and staging tables
  await prisma.expenseSplit.deleteMany({});
  await prisma.expense.deleteMany({});
  await prisma.stagedExpense.deleteMany({});
  
  // Re-seed Group and Memberships (to default timelines)
  await prisma.group.upsert({
    where: { id: GROUP_ID },
    update: {},
    create: {
      id: GROUP_ID,
      name: 'Flatmates',
      baseCurrency: 'INR'
    }
  });

  const usersData = [
    { name: 'Aisha', email: 'aisha@flatmates.com' },
    { name: 'Rohan', email: 'rohan@flatmates.com' },
    { name: 'Priya', email: 'priya@flatmates.com' },
    { name: 'Meera', email: 'meera@flatmates.com' },
    { name: 'Sam', email: 'sam@flatmates.com' },
    { name: 'Dev', email: 'dev@visitor.com' },
    { name: 'Kabir', email: 'kabir@visitor.com' }
  ];

  const users: { [key: string]: any } = {};
  for (const u of usersData) {
    const user = await prisma.user.upsert({
      where: { name: u.name },
      update: {},
      create: {
        name: u.name,
        email: u.email,
        passwordHash: 'hashedpassword123'
      }
    });
    users[u.name] = user;
  }

  const membershipsData = [
    { userName: 'Aisha', joinedAt: new Date('2026-02-01T00:00:00Z'), leftAt: null },
    { userName: 'Rohan', joinedAt: new Date('2026-02-01T00:00:00Z'), leftAt: null },
    { userName: 'Priya', joinedAt: new Date('2026-02-01T00:00:00Z'), leftAt: null },
    { userName: 'Meera', joinedAt: new Date('2026-02-01T00:00:00Z'), leftAt: new Date('2026-03-31T23:59:59Z') },
    { userName: 'Sam', joinedAt: new Date('2026-04-15T00:00:00Z'), leftAt: null },
    { userName: 'Dev', joinedAt: new Date('2026-02-01T00:00:00Z'), leftAt: new Date('2026-03-15T23:59:59Z') },
    { userName: 'Kabir', joinedAt: new Date('2026-03-11T00:00:00Z'), leftAt: new Date('2026-03-11T23:59:59Z') }
  ];

  for (const m of membershipsData) {
    const userId = users[m.userName].id;
    await prisma.groupMembership.upsert({
      where: {
        groupId_userId: {
          groupId: GROUP_ID,
          userId: userId
        }
      },
      update: {
        joinedAt: m.joinedAt,
        leftAt: m.leftAt
      },
      create: {
        groupId: GROUP_ID,
        userId: userId,
        joinedAt: m.joinedAt,
        leftAt: m.leftAt
      }
    });
  }

  revalidatePath('/');
  return { success: true, message: 'Database reset and default group timeline seeded.' };
}

export async function importCSVAction(csvContent: string) {
  try {
    const results = await importCSVToStaging(csvContent, GROUP_ID);
    revalidatePath('/');
    return { success: true, count: results.length, data: results };
  } catch (error: any) {
    console.error('CSV import failed:', error);
    return { success: false, error: error.message };
  }
}

export async function getStagedExpensesAction() {
  const staged = await prisma.stagedExpense.findMany({
    orderBy: { createdAt: 'desc' }
  });
  return staged.map((s: any) => ({
    ...s,
    anomalies: JSON.parse(s.anomalies) as string[],
    anomalyDetails: JSON.parse(s.anomalyDetails)
  }));
}

export async function getLedgerAction() {
  const expenses = await prisma.expense.findMany({
    where: { groupId: GROUP_ID },
    include: {
      paidBy: true,
      splits: {
        include: { user: true }
      }
    },
    orderBy: { dateIncurred: 'desc' }
  });

  return expenses.map((exp: any) => ({
    ...exp,
    amount: Number(exp.amount),
    exchangeRate: Number(exp.exchangeRate),
    splits: exp.splits.map((s: any) => ({
      ...s,
      amount: Number(s.amount),
      splitValue: s.splitValue !== null ? Number(s.splitValue) : null
    }))
  }));
}

export async function getMembershipsAction() {
  return await prisma.groupMembership.findMany({
    where: { groupId: GROUP_ID },
    include: {
      user: true
    },
    orderBy: { joinedAt: 'asc' }
  });
}

export async function updateMembershipDatesAction(membershipId: string, joinedAtStr: string, leftAtStr: string | null) {
  try {
    const joinedAt = new Date(joinedAtStr);
    const leftAt = leftAtStr ? new Date(leftAtStr) : null;
    
    await prisma.groupMembership.update({
      where: { id: membershipId },
      data: {
        joinedAt,
        leftAt
      }
    });
    
    revalidatePath('/');
    return { success: true };
  } catch (error: any) {
    return { success: false, error: error.message };
  }
}

export async function resolveStagedExpenseAction(
  stagedId: string,
  action: 'APPROVE' | 'REJECT',
  data?: {
    date: string;
    description: string;
    paid_by: string;
    amount: number;
    currency: string;
    split_type: string;
    split_with: string[];
    split_details?: string;
  }
) {
  try {
    if (action === 'REJECT') {
      await prisma.stagedExpense.update({
        where: { id: stagedId },
        data: { status: 'REJECTED' }
      });
      revalidatePath('/');
      return { success: true, message: 'Expense rejected.' };
    }

    if (!data) throw new Error('Data is required for approval.');

    // Validate date
    const parsedDate = new Date(data.date);
    if (isNaN(parsedDate.getTime())) throw new Error('Invalid date format.');

    // Fetch db users to double check name mapping
    const dbUsers = await prisma.user.findMany();
    const dbUserNames = dbUsers.map((u: any) => u.name);

    // Map names
    const resolvedPayer = resolveUserName(data.paid_by, dbUserNames);
    if (!resolvedPayer) throw new Error(`Payer "${data.paid_by}" not found in database.`);

    const resolvedSplitWith: string[] = [];
    for (const name of data.split_with) {
      const res = resolveUserName(name, dbUserNames);
      if (!res) throw new Error(`Split member "${name}" not found in database.`);
      resolvedSplitWith.push(res);
    }

    // Check date-bound memberships
    // Check payer
    const payerObj = dbUsers.find((u: any) => u.name === resolvedPayer);
    const payerMembership = await prisma.groupMembership.findFirst({
      where: { groupId: GROUP_ID, userId: payerObj?.id }
    });
    if (!payerMembership) throw new Error(`Payer "${resolvedPayer}" is not a member of the group.`);
    
    const pJoined = new Date(payerMembership.joinedAt);
    const pLeft = payerMembership.leftAt ? new Date(payerMembership.leftAt) : null;
    if (parsedDate < pJoined || (pLeft && parsedDate > pLeft)) {
      throw new Error(`Expense date is outside "${resolvedPayer}"'s membership range.`);
    }

    // Check split members
    for (const name of resolvedSplitWith) {
      const uObj = dbUsers.find((u: any) => u.name === name);
      const uMem = await prisma.groupMembership.findFirst({
        where: { groupId: GROUP_ID, userId: uObj?.id }
      });
      if (!uMem) throw new Error(`Member "${name}" is not in the group.`);
      const uJoined = new Date(uMem.joinedAt);
      const uLeft = uMem.leftAt ? new Date(uMem.leftAt) : null;
      if (parsedDate < uJoined || (uLeft && parsedDate > uLeft)) {
        throw new Error(`Expense date is outside "${name}"'s membership range.`);
      }
    }

    // Update StagedExpense content in database before converting to actual expense
    // Build fake raw CSV row reflecting edited state
    const simulatedRow = {
      date: data.date,
      description: data.description,
      paid_by: resolvedPayer,
      amount: String(data.amount),
      currency: data.currency,
      split_type: data.split_type,
      split_with: resolvedSplitWith.join(';'),
      split_details: data.split_details || '',
      notes: 'Edited & Approved via Dashboard'
    };

    await prisma.stagedExpense.update({
      where: { id: stagedId },
      data: {
        rawRowData: JSON.stringify(simulatedRow),
        description: data.description,
        paidByRaw: resolvedPayer,
        amountRaw: String(data.amount),
        currencyRaw: data.currency,
        splitTypeRaw: data.split_type,
        splitWithRaw: resolvedSplitWith.join(';'),
        splitDetailsRaw: data.split_details || ''
      }
    });

    // Run conversion
    await convertStagedToExpense(stagedId, {
      payer: resolvedPayer,
      amount: data.amount,
      date: parsedDate,
      splitWith: resolvedSplitWith
    });

    revalidatePath('/');
    return { success: true, message: 'Expense approved and created.' };
  } catch (error: any) {
    console.error('Failed to resolve staged expense:', error);
    return { success: false, error: error.message };
  }
}

export async function deleteExpenseAction(expenseId: string) {
  try {
    // Check if it's linked to a staged expense, and if so reset its status to PENDING
    const staged = await prisma.stagedExpense.findFirst({
      where: { resolvedExpenseId: expenseId }
    });
    
    if (staged) {
      await prisma.stagedExpense.update({
        where: { id: staged.id },
        data: {
          status: 'PENDING',
          resolvedExpenseId: null,
          resolvedAt: null
        }
      });
    }

    // Delete Splits then Expense
    await prisma.expenseSplit.deleteMany({
      where: { expenseId }
    });

    await prisma.expense.delete({
      where: { id: expenseId }
    });

    revalidatePath('/');
    return { success: true };
  } catch (error: any) {
    return { success: false, error: error.message };
  }
}

export async function readOriginalCSVFileAction() {
  try {
    const fs = require('fs');
    const path = require('path');
    const csvPath = path.join(process.cwd(), 'expenses_export.csv');
    const content = fs.readFileSync(csvPath, 'utf-8');
    return { success: true, content };
  } catch (error: any) {
    return { success: false, error: error.message };
  }
}

export async function executeSettlementAction(fromName: string, toName: string, amount: number, currency: string) {
  try {
    const dbUsers = await prisma.user.findMany();
    const fromUser = dbUsers.find((u: any) => u.name === fromName);
    const toUser = dbUsers.find((u: any) => u.name === toName);
    
    if (!fromUser || !toUser) throw new Error('Users not found');
    
    const expense = await prisma.expense.create({
      data: {
        groupId: GROUP_ID,
        description: `Settlement: ${fromName} paid ${toName}`,
        amount: amount,
        currency: currency,
        exchangeRate: currency.toUpperCase() === 'USD' ? 83.5 : 1.0,
        dateIncurred: new Date(),
        paidById: fromUser.id,
        splitType: 'EQUAL',
        isSettlement: true,
      }
    });
    
    await prisma.expenseSplit.create({
      data: {
        expenseId: expense.id,
        userId: toUser.id,
        amount: amount,
        splitValue: amount
      }
    });
    
    revalidatePath('/');
    return { success: true };
  } catch (error: any) {
    return { success: false, error: error.message };
  }
}

export async function clearStagingAction() {
  try {
    await prisma.stagedExpense.deleteMany({
      where: {
        status: { in: ['PENDING', 'REJECTED'] }
      }
    });
    revalidatePath('/');
    return { success: true };
  } catch (error: any) {
    return { success: false, error: error.message };
  }
}
