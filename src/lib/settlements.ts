export interface SettlementTransaction {
  from: string;
  to: string;
  amount: number;
  currency: string;
}

export interface UserBalance {
  name: string;
  totalPaid: number;
  totalOwed: number;
  netBalance: number;
}

export function calculateBalancesAndSettlements(
  expenses: any[],
  memberships: any[],
  baseCurrency: string = 'INR'
): { balances: UserBalance[]; settlements: SettlementTransaction[] } {
  const users = memberships.map(m => m.user.name);
  const balancesMap: { [key: string]: { totalPaid: number; totalOwed: number } } = {};
  
  users.forEach(name => {
    balancesMap[name] = { totalPaid: 0, totalOwed: 0 };
  });

  expenses.forEach(exp => {
    const payer = exp.paidBy.name;
    // Standardize all calculations in the group base currency (INR)
    // Priya's USD expenses will use their specific conversion rate
    const rate = Number(exp.exchangeRate) || 1.0;
    const amountInBase = Number(exp.amount) * rate;

    // Payer gets credited the total paid (in base currency)
    if (balancesMap[payer]) {
      balancesMap[payer].totalPaid += amountInBase;
    }

    // Split members owe their share
    exp.splits.forEach((split: any) => {
      const debtor = split.user.name;
      const splitAmountInBase = Number(split.amount) * rate;
      if (balancesMap[debtor]) {
        balancesMap[debtor].totalOwed += splitAmountInBase;
      }
    });
  });

  const balances: UserBalance[] = Object.keys(balancesMap).map(name => {
    const { totalPaid, totalOwed } = balancesMap[name];
    return {
      name,
      totalPaid,
      totalOwed,
      netBalance: totalPaid - totalOwed
    };
  });

  // Greedy debt simplification algorithm
  // Creditors (netBalance > 0) and Debtors (netBalance < 0)
  const creditors = balances
    .filter(b => b.netBalance > 0.01)
    .map(b => ({ name: b.name, amount: b.netBalance }))
    .sort((a, b) => b.amount - a.amount); // descending
    
  const debtors = balances
    .filter(b => b.netBalance < -0.01)
    .map(b => ({ name: b.name, amount: -b.netBalance })) // store as positive debt
    .sort((a, b) => b.amount - a.amount); // descending

  const settlements: SettlementTransaction[] = [];
  
  let i = 0; // creditor index
  let j = 0; // debtor index

  while (i < creditors.length && j < debtors.length) {
    const creditor = creditors[i];
    const debtor = debtors[j];

    const payAmount = Math.min(creditor.amount, debtor.amount);
    
    if (payAmount > 0.01) {
      settlements.push({
        from: debtor.name,
        to: creditor.name,
        amount: payAmount,
        currency: baseCurrency
      });
    }

    creditor.amount -= payAmount;
    debtor.amount -= payAmount;

    if (creditor.amount < 0.01) i++;
    if (debtor.amount < 0.01) j++;
  }

  return {
    balances,
    settlements
  };
}
