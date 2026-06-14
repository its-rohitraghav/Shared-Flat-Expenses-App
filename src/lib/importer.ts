import { prisma } from '@/lib/db';

export interface ParsedCSVRow {
  date: string;
  description: string;
  paid_by: string;
  amount: string;
  currency: string;
  split_type: string;
  split_with: string;
  split_details: string;
  notes: string;
}

// Custom CSV line parser to handle quoted fields containing commas
export function parseCSVLine(line: string): string[] {
  const result: string[] = [];
  let current = '';
  let inQuotes = false;
  
  for (let i = 0; i < line.length; i++) {
    const char = line[i];
    if (char === '"') {
      inQuotes = !inQuotes;
    } else if (char === ',' && !inQuotes) {
      result.push(current.trim());
      current = '';
    } else {
      current += char;
    }
  }
  result.push(current.trim());
  return result;
}

export function parseCSV(csvContent: string): ParsedCSVRow[] {
  const lines = csvContent.split(/\r?\n/).filter(line => line.trim().length > 0);
  if (lines.length === 0) return [];
  
  const headers = parseCSVLine(lines[0]).map(h => h.toLowerCase());
  const rows: ParsedCSVRow[] = [];
  
  for (let i = 1; i < lines.length; i++) {
    const values = parseCSVLine(lines[i]);
    const row: any = {};
    headers.forEach((header, index) => {
      row[header] = values[index] || '';
    });
    rows.push({
      date: row.date || '',
      description: row.description || '',
      paid_by: row.paid_by || '',
      amount: row.amount || '',
      currency: row.currency || '',
      split_type: row.split_type || '',
      split_with: row.split_with || '',
      split_details: row.split_details || '',
      notes: row.notes || '',
    });
  }
  
  return rows;
}

// Resolves a raw name into a system username (fuzzy/casing logic)
export function resolveUserName(rawName: string, dbUsers: string[]): string | null {
  const clean = rawName.trim().toLowerCase();
  if (!clean) return null;
  
  // Direct exact/case-insensitive match
  const match = dbUsers.find(u => u.toLowerCase() === clean);
  if (match) return match;
  
  // Prefix match (e.g., "Priya S" matches "Priya")
  const prefixMatch = dbUsers.find(u => clean.startsWith(u.toLowerCase()) || u.toLowerCase().startsWith(clean));
  if (prefixMatch) return prefixMatch;
  
  return null;
}

// Parses raw date string into a Date object if possible
export function parseCSVDate(dateStr: string): { date: Date | null; isAmbiguous: boolean; isInvalid: boolean } {
  const clean = dateStr.trim();
  if (!clean) return { date: null, isAmbiguous: false, isInvalid: true };
  
  // Format: YYYY-MM-DD
  if (/^\d{4}-\d{2}-\d{2}$/.test(clean)) {
    const d = new Date(clean + 'T00:00:00Z');
    return { date: isNaN(d.getTime()) ? null : d, isAmbiguous: false, isInvalid: isNaN(d.getTime()) };
  }
  
  // Format: DD/MM/YYYY or MM/DD/YYYY
  if (/^\d{1,2}\/\d{1,2}\/\d{4}$/.test(clean)) {
    const parts = clean.split('/');
    const p1 = parseInt(parts[0], 10);
    const p2 = parseInt(parts[1], 10);
    const year = parseInt(parts[2], 10);
    
    // If both numbers are <= 12, it is ambiguous (e.g. 04/05/2026 could be April 5 or May 4)
    if (p1 <= 12 && p2 <= 12) {
      // Return assumed date (DD/MM/YYYY) but flag as ambiguous
      const d = new Date(Date.UTC(year, p2 - 1, p1));
      return { date: d, isAmbiguous: true, isInvalid: false };
    }
    
    // If first part is > 12, it must be DD/MM/YYYY (e.g. 18/03/2026)
    if (p1 > 12 && p2 <= 12) {
      const d = new Date(Date.UTC(year, p2 - 1, p1));
      return { date: d, isAmbiguous: false, isInvalid: false };
    }
    
    // If second part is > 12, it must be MM/DD/YYYY (e.g. 03/18/2026)
    if (p2 > 12 && p1 <= 12) {
      const d = new Date(Date.UTC(year, p1 - 1, p2));
      return { date: d, isAmbiguous: false, isInvalid: false };
    }
    
    return { date: null, isAmbiguous: false, isInvalid: true };
  }
  
  // Format: "Mar 14", "Feb 8" (assumes year 2026 based on context)
  const monthMatch = clean.match(/^([a-zA-Z]+)\s+(\d{1,2})$/);
  if (monthMatch) {
    const monthStr = monthMatch[1].toLowerCase().slice(0, 3);
    const day = parseInt(monthMatch[2], 10);
    const months: { [key: string]: number } = {
      jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5,
      jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11
    };
    
    if (months[monthStr] !== undefined) {
      const d = new Date(Date.UTC(2026, months[monthStr], day));
      return { date: d, isAmbiguous: false, isInvalid: false };
    }
  }
  
  // Fallback to standard JS Date parser
  const fallbackDate = new Date(clean);
  const isInvalid = isNaN(fallbackDate.getTime());
  return { date: isInvalid ? null : fallbackDate, isAmbiguous: false, isInvalid };
}

export async function detectAnomalies(row: ParsedCSVRow, groupId: string) {
  const anomalies: string[] = [];
  const details: any = {};
  
  // Fetch database users and their memberships for validation
  const dbUsersList = await prisma.user.findMany({
    include: { memberships: { where: { groupId } } }
  });
  const dbUserNames = dbUsersList.map((u: any) => u.name);
  
  // 1. Check Payer Name / Fuzzy Matching
  let resolvedPayer = resolveUserName(row.paid_by, dbUserNames);
  if (!row.paid_by.trim()) {
    anomalies.push('MISSING_PAYER');
    details.payer = 'The paid_by field is empty.';
  } else if (!resolvedPayer) {
    anomalies.push('UNKNOWN_USER');
    details.payer = `Payer "${row.paid_by}" does not exist in the database.`;
  } else if (resolvedPayer !== row.paid_by.trim()) {
    details.payer_auto_resolved = `Fuzzy matched "${row.paid_by}" to user "${resolvedPayer}".`;
  }
  
  // 2. Check Amount format and validity
  let rawAmount = row.amount.replace(/"/g, '').trim();
  let numericAmount = parseFloat(rawAmount.replace(/,/g, ''));
  
  if (!rawAmount) {
    anomalies.push('INVALID_FORMAT');
    details.amount = 'Amount is missing.';
  } else if (isNaN(numericAmount)) {
    anomalies.push('INVALID_FORMAT');
    details.amount = `Amount "${row.amount}" could not be parsed as a number.`;
  } else {
    // Check for comma formatting
    if (rawAmount.includes(',')) {
      details.amount_cleaned = `Cleaned formatted amount "${rawAmount}" to ${numericAmount}.`;
    }
    
    // Check for negative amount
    if (numericAmount < 0) {
      anomalies.push('NEGATIVE_AMOUNT');
      details.amount_refund = `Negative amount ${numericAmount} detected. Handled as a refund.`;
    }
    
    // Check for zero amount
    if (numericAmount === 0) {
      anomalies.push('ZERO_AMOUNT');
      details.amount = 'Amount is zero.';
    }
    
    // Check for extra decimal places
    const decimalParts = rawAmount.split('.');
    if (decimalParts.length === 2 && decimalParts[1].length > 2) {
      const rounded = Math.round(numericAmount * 100) / 100;
      details.amount_rounded = `Rounded amount ${numericAmount} to ${rounded} (2 decimals).`;
      numericAmount = rounded;
    }
  }
  
  // 3. Check Date Validity and Ambiguity
  const dateResult = parseCSVDate(row.date);
  let parsedDate = dateResult.date;
  
  if (dateResult.isInvalid) {
    anomalies.push('INVALID_FORMAT');
    details.date = `Date "${row.date}" could not be parsed.`;
  } else if (dateResult.isAmbiguous) {
    anomalies.push('AMBIGUOUS_DATE');
    details.date = `Date "${row.date}" is ambiguous (could be DD/MM/YYYY or MM/DD/YYYY).`;
  }
  
  // 4. Check Currency
  if (!row.currency.trim()) {
    anomalies.push('MISSING_CURRENCY');
    details.currency = 'Currency is missing. Defaulted to group base currency (INR).';
  }
  
  // 5. Check split types and details
  const splitWithList = row.split_with.split(';').map(s => s.trim()).filter(s => s.length > 0);
  const resolvedSplitWith: string[] = [];
  const unknownSplitUsers: string[] = [];
  
  splitWithList.forEach(name => {
    const res = resolveUserName(name, dbUserNames);
    if (res) {
      resolvedSplitWith.push(res);
    } else if (name) {
      unknownSplitUsers.push(name);
    }
  });
  
  if (unknownSplitUsers.length > 0) {
    anomalies.push('UNKNOWN_USER');
    details.split_with = `The following split members do not exist: ${unknownSplitUsers.join(', ')}.`;
  }
  
  // 6. Check Date-bound memberships
  if (parsedDate) {
    // Check Payer membership
    if (resolvedPayer) {
      const payerObj = dbUsersList.find((u: any) => u.name === resolvedPayer);
      const membership = payerObj?.memberships[0];
      if (!membership) {
        anomalies.push('MEMBERSHIP_OUT_OF_BOUNDS');
        details.membership_payer = `${resolvedPayer} is not a member of this group.`;
      } else {
        const joined = new Date(membership.joinedAt);
        const left = membership.leftAt ? new Date(membership.leftAt) : null;
        if (parsedDate < joined || (left && parsedDate > left)) {
          anomalies.push('MEMBERSHIP_OUT_OF_BOUNDS');
          details.membership_payer = `Expense date ${parsedDate.toISOString().slice(0, 10)} is outside ${resolvedPayer}'s membership range (Joined: ${joined.toISOString().slice(0, 10)}, Left: ${left ? left.toISOString().slice(0, 10) : 'Active'}).`;
        }
      }
    }
    
    // Check Split members membership
    const outOfBoundsMembers: string[] = [];
    resolvedSplitWith.forEach(memberName => {
      const memberObj = dbUsersList.find((u: any) => u.name === memberName);
      const membership = memberObj?.memberships[0];
      if (membership) {
        const joined = new Date(membership.joinedAt);
        const left = membership.leftAt ? new Date(membership.leftAt) : null;
        if (parsedDate! < joined || (left && parsedDate! > left)) {
          outOfBoundsMembers.push(memberName);
        }
      } else {
        outOfBoundsMembers.push(memberName);
      }
    });
    
    if (outOfBoundsMembers.length > 0) {
      anomalies.push('MEMBERSHIP_OUT_OF_BOUNDS');
      details.membership_split = `The following split members were not active in the group on the expense date: ${outOfBoundsMembers.join(', ')}.`;
    }
  }
  
  // 7. Check for Settlements Logged as Expenses
  const descLower = row.description.toLowerCase();
  const notesLower = row.notes.toLowerCase();
  const isSettlementKeyword = descLower.includes('paid') && descLower.includes('back') || descLower.includes('settle') || notesLower.includes('settlement');
  const hasSingleSplitReceiver = resolvedSplitWith.length === 1 && resolvedSplitWith[0] !== resolvedPayer;
  
  if (isSettlementKeyword || (hasSingleSplitReceiver && !row.split_type)) {
    anomalies.push('SETTLEMENT_LOGGED_AS_EXPENSE');
    details.settlement = `This transaction appears to be a direct settlement payment rather than a shared group expense.`;
  }
  
  // 8. Validate Split Details (Percentage total, Shares, etc.)
  if (row.split_type.toLowerCase() === 'percentage' && row.split_details) {
    // Parse percentage split details, e.g., "Aisha 30%; Rohan 30%; Priya 30%; Meera 20%"
    const parts = row.split_details.split(';').map(p => p.trim());
    let totalPct = 0;
    parts.forEach(part => {
      const match = part.match(/(.+)\s+(\d+)\s*%/);
      if (match) {
        totalPct += parseInt(match[2], 10);
      }
    });
    
    if (totalPct !== 100) {
      anomalies.push('INVALID_SPLIT_DETAILS');
      details.split_details = `Percentage splits sum to ${totalPct}%, but must equal 100%.`;
    }
  }
  
  // 9. Check for duplicates in the current import or database
  // A duplicate has same date, payer, amount, and description (fuzzy/case-insensitive)
  if (parsedDate && resolvedPayer && !isNaN(numericAmount)) {
    const startOfDay = new Date(parsedDate);
    startOfDay.setUTCHours(0,0,0,0);
    const endOfDay = new Date(parsedDate);
    endOfDay.setUTCHours(23,59,59,999);
    
    // Check db for duplicates
    const dbDuplicate = await prisma.expense.findFirst({
      where: {
        groupId,
        dateIncurred: {
          gte: startOfDay,
          lte: endOfDay
        },
        paidById: dbUsersList.find((u: any) => u.name === resolvedPayer)?.id,
        amount: numericAmount,
        description: {
          contains: row.description.slice(0, 10) // Fuzzy match first 10 chars
        }
      }
    });
    
    if (dbDuplicate) {
      anomalies.push('DUPLICATE');
      details.duplicate = `Possible duplicate of existing database expense "${dbDuplicate.description}" (ID: ${dbDuplicate.id}).`;
    }
  }

  return {
    anomalies,
    details,
    resolvedValues: {
      payer: resolvedPayer,
      amount: numericAmount,
      date: parsedDate,
      splitWith: resolvedSplitWith
    }
  };
}

export async function importCSVToStaging(csvContent: string, groupId: string) {
  const parsedRows = parseCSV(csvContent);
  console.log(`Parsing completed. Found ${parsedRows.length} rows.`);
  
  const results: any[] = [];
  let rowIndex = 0;
  
  for (const row of parsedRows) {
    const detection = await detectAnomalies(row, groupId);
    
    // Also perform self-duplicate check against previous rows in this file import
    const startOfRowDate = detection.resolvedValues.date ? new Date(detection.resolvedValues.date) : null;
    if (startOfRowDate) {
      startOfRowDate.setUTCHours(0,0,0,0);
      const isDuplicateInFile = results.some((r: any) => {
        if (r.anomalies.includes('DUPLICATE')) return false; // skip already flagged
        const d = r.resolvedValues.date ? new Date(r.resolvedValues.date) : null;
        if (d) d.setUTCHours(0,0,0,0);
        return d && d.getTime() === startOfRowDate.getTime() &&
               r.resolvedValues.payer === detection.resolvedValues.payer &&
               r.resolvedValues.amount === detection.resolvedValues.amount &&
               (r.row.description.toLowerCase().includes(row.description.toLowerCase().slice(0, 10)) ||
                row.description.toLowerCase().includes(r.row.description.toLowerCase().slice(0, 10)));
      });
      
      if (isDuplicateInFile) {
        if (!detection.anomalies.includes('DUPLICATE')) {
          detection.anomalies.push('DUPLICATE');
          detection.details.duplicate_file = 'Possible duplicate of another row in this CSV file import.';
        }
      }
    }
    
    // Determine staging status
    // If there are anomalies, status is PENDING (needs review).
    // Except for cleanable anomalies like missing currency (default to INR) or negative amount (refund) which we can auto-resolve
    // but keep as APPROVED directly unless they have other blocking anomalies.
    // Blocking anomalies: DUPLICATE, MISSING_PAYER, UNKNOWN_USER, MEMBERSHIP_OUT_OF_BOUNDS, INVALID_SPLIT_DETAILS, AMBIGUOUS_DATE, INVALID_FORMAT, ZERO_AMOUNT.
    const blockingAnomalies = ['DUPLICATE', 'MISSING_PAYER', 'UNKNOWN_USER', 'MEMBERSHIP_OUT_OF_BOUNDS', 'INVALID_SPLIT_DETAILS', 'AMBIGUOUS_DATE', 'INVALID_FORMAT', 'ZERO_AMOUNT'];
    const hasBlocking = detection.anomalies.some(a => blockingAnomalies.includes(a));
    const status = hasBlocking ? 'PENDING' : 'APPROVED';
    
    // Write to StagedExpense table
    const staged = await prisma.stagedExpense.create({
      data: {
        groupId,
        rawRowData: JSON.stringify(row),
        dateRaw: row.date,
        description: row.description,
        paidByRaw: row.paid_by,
        amountRaw: row.amount,
        currencyRaw: row.currency || null,
        splitTypeRaw: row.split_type || null,
        splitWithRaw: row.split_with || null,
        splitDetailsRaw: row.split_details || null,
        notesRaw: row.notes || null,
        anomalies: JSON.stringify(detection.anomalies),
        anomalyDetails: JSON.stringify(detection.details),
        status: status
      }
    });
    
    // If the status is APPROVED, immediately convert it to a real Expense and splits in the database!
    if (status === 'APPROVED' && detection.resolvedValues.date && detection.resolvedValues.payer) {
      await convertStagedToExpense(staged.id, detection.resolvedValues);
    }
    
    results.push({
      stagedId: staged.id,
      row,
      anomalies: detection.anomalies,
      status,
      resolvedValues: detection.resolvedValues
    });
    rowIndex++;
  }
  
  return results;
}

// Converts a StagedExpense that has been verified/approved into a real Expense and ExpenseSplit records
export async function convertStagedToExpense(stagedId: string, resolvedValuesOverride?: any) {
  const staged = await prisma.stagedExpense.findUnique({
    where: { id: stagedId },
    include: { group: true }
  });
  
  if (!staged) throw new Error('Staged expense not found.');
  if (staged.status === 'REJECTED') return null;
  
  const rawRow: ParsedCSVRow = JSON.parse(staged.rawRowData);
  
  // Re-run detection if overrides not provided
  let val = resolvedValuesOverride;
  if (!val) {
    const detection = await detectAnomalies(rawRow, staged.groupId);
    val = detection.resolvedValues;
  }
  
  const dbUsers = await prisma.user.findMany();
  const payerUser = dbUsers.find((u: any) => u.name === val.payer);
  if (!payerUser) throw new Error(`Resolved payer "${val.payer}" not found.`);
  
  // Ensure default split type
  const splitType = rawRow.split_type ? rawRow.split_type.toUpperCase() : 'EQUAL';
  const isSettlement = staged.anomalies.includes('SETTLEMENT_LOGGED_AS_EXPENSE') || 
                       (splitType === 'EQUAL' && val.splitWith.length === 1 && val.splitWith[0] !== val.payer && !rawRow.split_type);
  
  // Create the real Expense record
  const expense = await prisma.expense.create({
    data: {
      groupId: staged.groupId,
      description: staged.description,
      amount: val.amount,
      currency: staged.currencyRaw || staged.group.baseCurrency,
      exchangeRate: staged.currencyRaw?.toUpperCase() === 'USD' ? 83.5 : 1.0, // Hardcoded exchange rate for Priya's requirement (or 83.5 standard conversion)
      dateIncurred: val.date || new Date(),
      paidById: payerUser.id,
      splitType: isSettlement ? 'EQUAL' : splitType,
      notes: rawRow.notes || null,
      isSettlement: isSettlement,
      createdAt: staged.createdAt
    }
  });
  
  // Calculate Splits
  const splitMembers = val.splitWith.length > 0 ? val.splitWith : [val.payer]; // Default to payer if empty
  const totalAmount = val.amount;
  
  if (isSettlement) {
    // In a settlement (Rohan paid Aisha back), the paid amount is transferred directly
    // Rohan is the payer, Aisha is the receiver. Aisha owes Rohan -5000 (which increases her net balance/reduces debt)
    // and Rohan is credited +5000. So we create a single split where the receiver (Aisha) owes the total amount.
    const receiverName = splitMembers[0];
    const receiverUser = dbUsers.find((u: any) => u.name === receiverName);
    if (receiverUser) {
      await prisma.expenseSplit.create({
        data: {
          expenseId: expense.id,
          userId: receiverUser.id,
          amount: totalAmount,
          splitValue: totalAmount
        }
      });
    }
  } else if (splitType === 'EQUAL') {
    // Split equally among all members listed
    const shareAmount = totalAmount / splitMembers.length;
    for (const name of splitMembers) {
      const user = dbUsers.find((u: any) => u.name === name);
      if (user) {
        await prisma.expenseSplit.create({
          data: {
            expenseId: expense.id,
            userId: user.id,
            amount: shareAmount,
            splitValue: null
          }
        });
      }
    }
  } else if (splitType === 'PERCENTAGE' && rawRow.split_details) {
    // Parse percentage split details, e.g., "Aisha 30%; Rohan 30%; Priya 30%; Meera 20%"
    const parts = rawRow.split_details.split(';').map(p => p.trim());
    for (const part of parts) {
      const match = part.match(/(.+)\s+(\d+)\s*%/);
      if (match) {
        const name = resolveUserName(match[1], dbUsers.map((u: any) => u.name));
        const pct = parseInt(match[2], 10);
        const user = dbUsers.find((u: any) => u.name === name);
        if (user) {
          const splitAmt = (totalAmount * pct) / 100;
          await prisma.expenseSplit.create({
            data: {
              expenseId: expense.id,
              userId: user.id,
              amount: splitAmt,
              splitValue: pct
            }
          });
        }
      }
    }
  } else if (splitType === 'SHARE' && rawRow.split_details) {
    // Parse share split details, e.g., "Aisha 1; Rohan 2; Priya 1; Dev 2"
    const parts = rawRow.split_details.split(';').map(p => p.trim());
    let totalShares = 0;
    const parsedShares: { name: string; shares: number }[] = [];
    
    for (const part of parts) {
      const match = part.match(/(.+)\s+(\d+)/);
      if (match) {
        const name = resolveUserName(match[1], dbUsers.map((u: any) => u.name));
        const shares = parseInt(match[2], 10);
        if (name) {
          parsedShares.push({ name, shares });
          totalShares += shares;
        }
      }
    }
    
    for (const item of parsedShares) {
      const user = dbUsers.find((u: any) => u.name === item.name);
      if (user) {
        const splitAmt = (totalAmount * item.shares) / totalShares;
        await prisma.expenseSplit.create({
          data: {
            expenseId: expense.id,
            userId: user.id,
            amount: splitAmt,
            splitValue: item.shares
          }
        });
      }
    }
  } else if (splitType === 'UNEQUAL' && rawRow.split_details) {
    // Parse unequal split details, e.g., "Rohan 700; Priya 400; Meera 400"
    const parts = rawRow.split_details.split(';').map(p => p.trim());
    for (const part of parts) {
      const match = part.match(/(.+)\s+(\d+(?:\.\d+)?)/);
      if (match) {
        const name = resolveUserName(match[1], dbUsers.map((u: any) => u.name));
        const owedAmt = parseFloat(match[2]);
        const user = dbUsers.find((u: any) => u.name === name);
        if (user) {
          await prisma.expenseSplit.create({
            data: {
              expenseId: expense.id,
              userId: user.id,
              amount: owedAmt,
              splitValue: owedAmt
            }
          });
        }
      }
    }
  }
  
  // Update staged record status to APPROVED and link the resolved expense ID
  await prisma.stagedExpense.update({
    where: { id: stagedId },
    data: {
      status: 'APPROVED',
      resolvedExpenseId: expense.id,
      resolvedAt: new Date()
    }
  });
  
  return expense;
}
