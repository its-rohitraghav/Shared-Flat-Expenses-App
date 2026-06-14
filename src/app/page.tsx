'use client';

import { useState, useEffect, useTransition } from 'react';
import {
  resetDatabaseAction,
  importCSVAction,
  getStagedExpensesAction,
  getLedgerAction,
  getMembershipsAction,
  resolveStagedExpenseAction,
  deleteExpenseAction,
  readOriginalCSVFileAction,
  updateMembershipDatesAction,
  executeSettlementAction,
  clearStagingAction
} from './actions';
import { calculateBalancesAndSettlements } from '@/lib/settlements';

// Helper to get initials and avatar styling (Dark glassmorphism theme)
function getAvatarStyles(name: string) {
  const clean = name.trim().toUpperCase();
  const initials = clean.slice(0, 2);
  const colors = ['violet', 'blue', 'emerald', 'rose', 'amber', 'pink', 'indigo'];
  let hash = 0;
  for (let i = 0; i < clean.length; i++) {
    hash = clean.charCodeAt(i) + ((hash << 5) - hash);
  }
  const colorIndex = Math.abs(hash) % colors.length;
  const avatarClass = `avatar-${colors[colorIndex]}`;
  return { initials, avatarClass };
}

export default function DashboardPage() {
  const [activeTab, setActiveTab] = useState<'overview' | 'staged' | 'ledger' | 'settlements' | 'memberships'>('overview');
  const [stagedExpenses, setStagedExpenses] = useState<any[]>([]);
  const [expenses, setExpenses] = useState<any[]>([]);
  const [memberships, setMemberships] = useState<any[]>([]);
  const [selectedUserAudit, setSelectedUserAudit] = useState<string | null>(null);
  
  // Ledger search filter
  const [searchQuery, setSearchQuery] = useState<string>('');

  // State for currency mode (false = INR, true = USD)
  const [useUSD, setUseUSD] = useState<boolean>(false);
  const EXCHANGE_RATE = 83.5; // conversion multiplier: 1 USD = 83.5 INR

  // CSV paste input state
  const [csvInput, setCsvInput] = useState<string>('');
  const [importReport, setImportReport] = useState<{
    success: boolean;
    count?: number;
    approvedCount?: number;
    pendingCount?: number;
    error?: string;
  } | null>(null);

  // Staged expense edit modal state
  const [editingStaged, setEditingStaged] = useState<any | null>(null);
  const [editForm, setEditForm] = useState<{
    date: string;
    description: string;
    paid_by: string;
    amount: number;
    currency: string;
    split_type: string;
    split_with: string[];
    split_details: string;
  } | null>(null);

  // Membership editing state
  const [editingMembership, setEditingMembership] = useState<any | null>(null);
  const [membershipForm, setMembershipForm] = useState<{
    joinedAt: string;
    leftAt: string;
  }>({ joinedAt: '', leftAt: '' });

  const [isPending, startTransition] = useTransition();
  const [loadingMsg, setLoadingMsg] = useState('');

  // Fetch all data from server
  const loadData = async () => {
    try {
      const stagedData = await getStagedExpensesAction();
      const ledgerData = await getLedgerAction();
      const memData = await getMembershipsAction();
      
      setStagedExpenses(stagedData);
      setExpenses(ledgerData);
      setMemberships(memData);
    } catch (err) {
      console.error('Failed to load dashboard data:', err);
    }
  };

  useEffect(() => {
    loadData();
  }, []);

  const handleReset = () => {
    setLoadingMsg('Resetting database...');
    startTransition(async () => {
      await resetDatabaseAction();
      await loadData();
      setImportReport(null);
      setSelectedUserAudit(null);
    });
  };

  const handleLoadOriginalCSV = () => {
    setLoadingMsg('Reading expenses_export.csv...');
    startTransition(async () => {
      const res = await readOriginalCSVFileAction();
      if (res.success && res.content) {
        setCsvInput(res.content);
        setLoadingMsg('Importing and scanning CSV...');
        const importRes = await importCSVAction(res.content);
        if (importRes.success) {
          const approved = importRes.data?.filter((r: any) => r.status === 'APPROVED').length || 0;
          const pending = importRes.data?.filter((r: any) => r.status === 'PENDING').length || 0;
          setImportReport({
            success: true,
            count: importRes.count,
            approvedCount: approved,
            pendingCount: pending
          });
          await loadData();
        } else {
          setImportReport({ success: false, error: importRes.error });
        }
      } else {
        setImportReport({ success: false, error: res.error });
      }
    });
  };

  const handleManualImport = () => {
    if (!csvInput.trim()) return;
    setLoadingMsg('Importing and scanning CSV...');
    startTransition(async () => {
      const importRes = await importCSVAction(csvInput);
      if (importRes.success) {
        const approved = importRes.data?.filter((r: any) => r.status === 'APPROVED').length || 0;
        const pending = importRes.data?.filter((r: any) => r.status === 'PENDING').length || 0;
        setImportReport({
          success: true,
          count: importRes.count,
          approvedCount: approved,
          pendingCount: pending
        });
        await loadData();
      } else {
        setImportReport({ success: false, error: importRes.error });
      }
    });
  };

  const handleDeleteExpense = (id: string) => {
    setLoadingMsg('Deleting expense...');
    startTransition(async () => {
      const res = await deleteExpenseAction(id);
      if (res.success) {
        await loadData();
      }
    });
  };

  const handleClearStaging = () => {
    if (!confirm('Are you sure you want to clear all pending staged expenses?')) return;
    setLoadingMsg('Purging staging queue...');
    startTransition(async () => {
      const res = await clearStagingAction();
      if (res.success) {
        await loadData();
      }
    });
  };

  const handleExecuteSettlement = (from: string, to: string, amount: number, currency: string) => {
    setLoadingMsg(`Recording settlement: ${from} paid ${to}...`);
    startTransition(async () => {
      const res = await executeSettlementAction(from, to, amount, currency);
      if (res.success) {
        await loadData();
      } else {
        alert('Failed to execute settlement: ' + res.error);
      }
    });
  };

  // Open the review/edit modal for staged record
  const startReview = (staged: any) => {
    setEditingStaged(staged);
    const raw: any = JSON.parse(staged.rawRowData);
    
    // Resolve values
    const splitWith = raw.split_with ? raw.split_with.split(';').map((s: string) => s.trim()).filter(Boolean) : [];
    
    // Try to parse amount safely
    let amt = parseFloat(raw.amount.replace(/"/g, '').replace(/,/g, ''));
    if (isNaN(amt)) amt = 0;
    
    setEditForm({
      date: raw.date || '',
      description: raw.description || '',
      paid_by: raw.paid_by || '',
      amount: amt,
      currency: raw.currency || 'INR',
      split_type: (raw.split_type || 'equal').toLowerCase(),
      split_with: splitWith,
      split_details: raw.split_details || ''
    });
  };

  const handleApproveEdit = () => {
    if (!editingStaged || !editForm) return;
    setLoadingMsg('Saving and approving expense...');
    startTransition(async () => {
      const res = await resolveStagedExpenseAction(editingStaged.id, 'APPROVE', {
        ...editForm,
        split_type: editForm.split_type.toUpperCase()
      });
      if (res.success) {
        setEditingStaged(null);
        setEditForm(null);
        await loadData();
      } else {
        alert('Failed to approve: ' + res.error);
      }
    });
  };

  const handleRejectStaged = (id: string) => {
    setLoadingMsg('Rejecting staging record...');
    startTransition(async () => {
      const res = await resolveStagedExpenseAction(id, 'REJECT');
      if (res.success) {
        await loadData();
      }
    });
  };

  // Open editing membership timeline modal
  const startEditMembership = (mem: any) => {
    setEditingMembership(mem);
    setMembershipForm({
      joinedAt: new Date(mem.joinedAt).toISOString().slice(0, 10),
      leftAt: mem.leftAt ? new Date(mem.leftAt).toISOString().slice(0, 10) : ''
    });
  };

  const handleSaveMembership = () => {
    if (!editingMembership) return;
    setLoadingMsg('Updating group timeline...');
    startTransition(async () => {
      const res = await updateMembershipDatesAction(
        editingMembership.id,
        membershipForm.joinedAt,
        membershipForm.leftAt || null
      );
      if (res.success) {
        setEditingMembership(null);
        await loadData();
      } else {
        alert('Failed to update: ' + res.error);
      }
    });
  };

  // Compute balances and simplified cash flows
  const baseCurrency = 'INR';
  const { balances, settlements } = calculateBalancesAndSettlements(expenses, memberships, baseCurrency);

  // Format amount values for render
  const formatAmount = (amtInBase: number) => {
    const isNeg = amtInBase < 0;
    const absVal = Math.abs(amtInBase);
    if (useUSD) {
      const amtInUSD = absVal / EXCHANGE_RATE;
      const formatted = amtInUSD.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
      return `${isNeg ? '-' : ''}$${formatted} USD`;
    }
    const formatted = absVal.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    return `${isNeg ? '-' : ''}₹${formatted} INR`;
  };

  // Filter expenses list by user audit and search query
  const filteredLedger = expenses.filter(exp => {
    // 1. Audit User Filter
    if (selectedUserAudit) {
      const isPayer = exp.paidBy.name === selectedUserAudit;
      const isDebtor = exp.splits.some((s: any) => s.user.name === selectedUserAudit);
      if (!isPayer && !isDebtor) return false;
    }
    
    // 2. Search Query Filter
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      const descMatch = exp.description.toLowerCase().includes(q);
      const notesMatch = exp.notes ? exp.notes.toLowerCase().includes(q) : false;
      const payerMatch = exp.paidBy.name.toLowerCase().includes(q);
      if (!descMatch && !notesMatch && !payerMatch) return false;
    }
    
    return true;
  });

  const renderExpenseChart = () => {
    // Sort expenses by date
    const sorted = [...expenses]
      .filter(e => !e.isSettlement)
      .sort((a, b) => new Date(a.dateIncurred).getTime() - new Date(b.dateIncurred).getTime());

    if (sorted.length === 0) {
      return (
        <div className="h-64 border border-[var(--border-color)] flex items-center justify-center text-[var(--text-muted)] font-mono text-xs select-none">
          NO TRANSACTION DATA AVAILABLE FOR GRAPHING
        </div>
      );
    }

    // Calculate running total
    let total = 0;
    const points = sorted.map(e => {
      total += Number(e.amount) * Number(e.exchangeRate);
      return {
        time: new Date(e.dateIncurred).getTime(),
        displayDate: new Date(e.dateIncurred).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }),
        value: total,
        desc: e.description,
        amount: Number(e.amount) * Number(e.exchangeRate)
      };
    });

    // Width and height of SVG
    const width = 800;
    const height = 240;
    const paddingLeft = 60;
    const paddingRight = 20;
    const paddingTop = 20;
    const paddingBottom = 30;

    const chartWidth = width - paddingLeft - paddingRight;
    const chartHeight = height - paddingTop - paddingBottom;

    const minTime = points[0].time;
    const maxTime = points[points.length - 1].time;
    const timespan = maxTime - minTime || 1;

    const minVal = 0;
    const maxVal = Math.max(...points.map(p => p.value)) * 1.1 || 1000;

    // Map data to SVG coordinates
    const svgPoints = points.map(p => {
      const x = paddingLeft + ((p.time - minTime) / timespan) * chartWidth;
      const y = paddingTop + chartHeight - (p.value / maxVal) * chartHeight;
      return { x, y, ...p };
    });

    // Build the path string
    let pathD = `M ${svgPoints[0].x} ${svgPoints[0].y}`;
    for (let i = 1; i < svgPoints.length; i++) {
      pathD += ` L ${svgPoints[i].x} ${svgPoints[i].y}`;
    }

    // Build the filled area path string
    const fillD = `${pathD} L ${svgPoints[svgPoints.length - 1].x} ${paddingTop + chartHeight} L ${svgPoints[0].x} ${paddingTop + chartHeight} Z`;

    // Generate grid lines
    const gridDivisions = 5;
    const xGrids = Array.from({ length: gridDivisions }).map((_, idx) => {
      return paddingLeft + (idx / (gridDivisions - 1)) * chartWidth;
    });

    const yGrids = Array.from({ length: 4 }).map((_, idx) => {
      return paddingTop + (idx / 3) * chartHeight;
    });

    return (
      <div className="chart-container font-mono">
        <div className="flex justify-between items-center mb-4 select-none">
          <div>
            <span className="text-[10px] text-[var(--text-secondary)] font-bold uppercase tracking-wider">CUMULATIVE EXPENSE LEDGER VALUE</span>
            <div className="text-xl font-bold text-[var(--text-primary)] mt-1">
              {formatAmount(total)}
            </div>
          </div>
          <div className="flex items-center gap-1.5 border border-[var(--border-color)] px-2.5 py-1 bg-[var(--bg-card)] rounded-lg">
            <span className="dot-live"></span>
            <span className="text-[8.5px] text-[var(--text-primary)] font-bold uppercase tracking-wider">LIVE FEED</span>
          </div>
        </div>

        {/* SVG Canvas */}
        <div className="relative">
          <svg viewBox={`0 0 ${width} ${height}`} className="w-full h-auto select-none">
            {/* Gradients */}
            <defs>
              <linearGradient id="chartGradient" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="var(--accent-violet)" stopOpacity="0.25" />
                <stop offset="100%" stopColor="var(--accent-violet)" stopOpacity="0.0" />
              </linearGradient>
              <linearGradient id="lineGradient" x1="0" y1="0" x2="1" y2="0">
                <stop offset="0%" stopColor="var(--accent-violet)" />
                <stop offset="100%" stopColor="var(--accent-blue)" />
              </linearGradient>
            </defs>

            {/* Grid Lines */}
            {xGrids.map((x, idx) => (
              <line
                key={`x-grid-${idx}`}
                x1={x}
                y1={paddingTop}
                x2={x}
                y2={paddingTop + chartHeight}
                stroke="var(--border-color)"
                strokeDasharray="2 2"
              />
            ))}
            {yGrids.map((y, idx) => (
              <line
                key={`y-grid-${idx}`}
                x1={paddingLeft}
                y1={y}
                x2={paddingLeft + chartWidth}
                y2={y}
                stroke="var(--border-color)"
                strokeDasharray="2 2"
              />
            ))}

            {/* Y-Axis Labels */}
            {yGrids.map((y, idx) => {
              const val = maxVal - (idx / 3) * maxVal;
              return (
                <text
                  key={`y-label-${idx}`}
                  x={paddingLeft - 8}
                  y={y + 3}
                  textAnchor="end"
                  fill="var(--text-secondary)"
                  fontSize="8.5"
                  fontWeight="bold"
                >
                  {useUSD ? `$${(val / EXCHANGE_RATE).toFixed(0)}` : `₹${val.toFixed(0)}`}
                </text>
              );
            })}

            {/* X-Axis Labels */}
            {svgPoints.filter((_, idx) => idx === 0 || idx === Math.floor(svgPoints.length / 2) || idx === svgPoints.length - 1).map((p, idx) => (
              <text
                key={`x-label-${idx}`}
                x={p.x}
                y={paddingTop + chartHeight + 16}
                textAnchor="middle"
                fill="var(--text-secondary)"
                fontSize="8.5"
                fontWeight="bold"
              >
                {p.displayDate}
              </text>
            ))}

            {/* Area Fill */}
            <path d={fillD} fill="url(#chartGradient)" />

            {/* Path Line */}
            <path d={pathD} fill="none" stroke="url(#lineGradient)" strokeWidth="2" strokeLinecap="round" />

            {/* Data Points */}
            {svgPoints.map((p, idx) => (
              <circle
                key={`point-${idx}`}
                cx={p.x}
                cy={p.y}
                r="3"
                fill="var(--bg-primary)"
                stroke="var(--accent-cyan)"
                strokeWidth="1.5"
                className="cursor-pointer hover:r-4 transition-all"
              >
                <title>{`${p.displayDate} - ${p.desc}: ${formatAmount(p.amount)} (Total: ${formatAmount(p.value)})`}</title>
              </circle>
            ))}
          </svg>
        </div>

        {/* Interval and controls */}
        <div className="flex justify-between items-center border-t border-[var(--border-color)] mt-4 pt-3 text-[9px] select-none">
          <div className="flex gap-1">
            {['1D', '1M', '3M', '1Y', '5Y', 'ALL'].map(range => (
              <button
                key={range}
                className={`px-2 py-0.5 font-bold border rounded-md transition-colors cursor-pointer ${
                  range === 'ALL'
                    ? 'bg-[var(--accent-violet)] text-white border-transparent'
                    : 'bg-transparent text-[var(--text-secondary)] border-transparent hover:border-[var(--border-hover)] hover:text-[var(--text-primary)]'
                }`}
              >
                {range}
              </button>
            ))}
          </div>

          <div className="flex items-center gap-3 text-[var(--text-secondary)] font-bold">
            <button className="hover:text-[var(--text-primary)]" title="Embed Chart">{'</>'}</button>
            <button className="hover:text-[var(--text-primary)]" title="Candle View">📊</button>
            <button className="hover:text-[var(--text-primary)]" title="Properties">⚙</button>
            <button className="hover:text-[var(--text-primary)]" title="Fullscreen View">⛶</button>
          </div>
        </div>
      </div>
    );
  };

  return (
    <div className="flex-1 bg-[var(--bg-primary)] text-[var(--text-primary)] h-screen flex flex-col font-sans selection:bg-[var(--accent-violet)] selection:text-white overflow-hidden relative">
      {/* Top Header */}
      <header className="h-14 border-b border-[var(--border-color)] px-6 flex items-center justify-between bg-[var(--bg-secondary)]/40 backdrop-blur-md shrink-0 select-none z-10">
        <div className="flex items-center gap-3">
          <span className="gradient-text font-black text-sm tracking-widest uppercase">
            FLATSPLIT
          </span>
          <h1 className="text-xs font-semibold tracking-wider text-[var(--text-primary)] font-display hidden sm:inline">
            Expense Hub v2.0
          </h1>
          <span className="text-[var(--border-color)] text-[10px] hidden sm:inline">|</span>
          <div className="flex items-center gap-1.5 hidden sm:flex">
            <span className="dot-live"></span>
            <span className="text-[var(--text-secondary)] text-[9px] font-mono uppercase">
              ACTIVE LEDGER STREAM
            </span>
          </div>
        </div>

        {/* Action Row */}
        <div className="flex items-center gap-3">
          {/* Currency Toggle */}
          <div className="border border-[var(--border-color)] px-2.5 py-1 bg-[var(--bg-card)] rounded-lg flex items-center gap-2">
            <span className={`text-[9.5px] font-bold font-mono transition-colors ${!useUSD ? 'text-[var(--accent-cyan)]' : 'text-[var(--text-muted)]'}`}>INR</span>
            <button
              onClick={() => setUseUSD(!useUSD)}
              className="w-8 h-4.5 bg-white/10 rounded-full border border-[var(--border-color)] p-0.5 relative focus:outline-none cursor-pointer"
            >
              <div
                className={`w-3.5 h-3 bg-[var(--accent-cyan)] rounded-full transition-transform ${
                  useUSD ? 'translate-x-3.5' : 'translate-x-0'
                }`}
              />
            </button>
            <span className={`text-[9.5px] font-bold font-mono transition-colors ${useUSD ? 'text-[var(--accent-cyan)]' : 'text-[var(--text-muted)]'}`}>USD</span>
          </div>

          <button
            onClick={handleReset}
            disabled={isPending}
            className="btn-ghost hover:border-[var(--accent-rose)] hover:text-white text-[9.5px] font-bold px-3 py-1.5 transition-colors disabled:opacity-50 cursor-pointer"
          >
            RESET
          </button>
          
          <button
            onClick={handleLoadOriginalCSV}
            disabled={isPending}
            className="btn-ghost hover:border-[var(--accent-violet)] hover:text-white text-[9.5px] font-bold px-3 py-1.5 transition-colors disabled:opacity-50 cursor-pointer"
          >
            IMPORT CSV
          </button>
        </div>
      </header>

      {/* Global Loading overlay */}
      {isPending && (
        <div className="loading-overlay">
          <div className="spinner"></div>
          <p className="text-[var(--text-primary)] font-black text-[10px] font-mono uppercase tracking-widest">{loadingMsg}</p>
        </div>
      )}

      {/* Main split dashboard pane */}
      <div className="flex-1 flex overflow-hidden z-10">
        {/* Left Side: Workspace */}
        <main className="flex-1 flex flex-col overflow-y-auto px-6 py-5 bg-transparent">
          {/* Navigation tabs styled as TradingView pills */}
          <div className="mb-5 flex overflow-x-auto gap-2 shrink-0 scrollbar-none select-none">
            <button
              onClick={() => setActiveTab('overview')}
              className={`tab-pill ${activeTab === 'overview' ? 'active' : ''}`}
            >
              Overview
            </button>
            <button
              onClick={() => setActiveTab('staged')}
              className={`tab-pill flex items-center gap-1.5 ${activeTab === 'staged' ? 'active' : ''}`}
            >
              Staged Buffer
              {stagedExpenses.filter(s => s.status === 'PENDING').length > 0 && (
                <span className={`text-[8.5px] px-1.5 py-0.25 font-bold rounded-full border ${
                  activeTab === 'staged' ? 'bg-white text-black border-transparent' : 'bg-white/10 text-[var(--text-secondary)] border-[var(--border-color)]'
                }`}>
                  {stagedExpenses.filter(s => s.status === 'PENDING').length}
                </span>
              )}
            </button>
            <button
              onClick={() => setActiveTab('ledger')}
              className={`tab-pill flex items-center gap-1.5 ${activeTab === 'ledger' ? 'active' : ''}`}
            >
              Ledger Audit
              <span className={`text-[8.5px] px-1.5 py-0.25 font-bold rounded-full border ${
                activeTab === 'ledger' ? 'bg-white text-black border-transparent' : 'bg-white/10 text-[var(--text-secondary)] border-[var(--border-color)]'
              }`}>
                {expenses.length}
              </span>
            </button>
            <button
              onClick={() => setActiveTab('settlements')}
              className={`tab-pill flex items-center gap-1.5 ${activeTab === 'settlements' ? 'active' : ''}`}
            >
              Cash Settlements
              {settlements.length > 0 && (
                <span className={`text-[8.5px] px-1.5 py-0.25 font-bold rounded-full border ${
                  activeTab === 'settlements' ? 'bg-white text-black border-transparent' : 'bg-white/10 text-[var(--text-secondary)] border-[var(--border-color)]'
                }`}>
                  {settlements.length}
                </span>
              )}
            </button>
            <button
              onClick={() => setActiveTab('memberships')}
              className={`tab-pill ${activeTab === 'memberships' ? 'active' : ''}`}
            >
              Timeline
            </button>
          </div>

          {/* Import report */}
          {importReport && (
            <div className={`mb-5 p-4 border rounded-xl bg-[var(--bg-card)] backdrop-blur-md ${
              importReport.success ? 'border-[var(--accent-emerald)] text-[var(--text-primary)]' : 'border-[var(--accent-rose)] text-[var(--text-primary)]'
            }`}>
              <h3 className="text-xs font-black uppercase tracking-wider flex items-center gap-2">
                {importReport.success ? '✓ PARSE SUCCESSFUL' : '⚠ SCAN FAILURE'}
              </h3>
              {importReport.success ? (
                <p className="text-[11px] mt-1 text-[var(--text-secondary)] leading-normal font-mono">
                  Parsed <strong className="text-[var(--text-primary)] font-black">{importReport.count}</strong> rows. Committed: {importReport.approvedCount} | Staged: {importReport.pendingCount}
                </p>
              ) : (
                <p className="text-[11px] mt-1 text-[var(--accent-rose)]">{importReport.error}</p>
              )}
            </div>
          )}

          {/* Tab Content */}
          <div className="flex-1 min-h-0">
            {/* Tab 0: Overview */}
            {activeTab === 'overview' && (
              <div className="space-y-6">
                {/* Horizontal Ticker cards registry at the top of the Overview panel */}
                <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-7 gap-3 select-none">
                  {balances.map(b => {
                    const isNegative = b.netBalance < -0.01;
                    const isPositive = b.netBalance > 0.01;
                    const { initials, avatarClass } = getAvatarStyles(b.name);
                    
                    const totalSpending = expenses.reduce((acc, curr) => acc + (Number(curr.amount) * Number(curr.exchangeRate)), 0) || 1;
                    const rawPercent = (b.netBalance / totalSpending) * 100;
                    const percentDisplay = `${rawPercent >= 0 ? '+' : ''}${rawPercent.toFixed(1)}%`;

                    return (
                      <div
                        key={b.name}
                        onClick={() => {
                          setSelectedUserAudit(b.name);
                          setActiveTab('ledger');
                        }}
                        className={`stat-card ${isPositive ? 'positive' : isNegative ? 'negative' : 'neutral'} glass-card flex flex-col gap-1.5`}
                      >
                        <div className="flex items-center gap-1.5">
                          <div className={`w-5 h-5 flex items-center justify-center text-[9px] font-bold text-white uppercase rounded-full shrink-0 ${avatarClass}`}>
                            {initials}
                          </div>
                          <span className="text-[10px] font-semibold text-[var(--text-secondary)] tracking-wider uppercase truncate">{b.name}</span>
                        </div>

                        <div className="mt-1">
                          <div className="text-xs font-mono font-bold text-[var(--text-primary)] truncate">
                            {formatAmount(Math.abs(b.netBalance))}
                          </div>
                          <div className={`text-[8.5px] font-mono font-bold mt-0.5 ${
                            isPositive ? 'text-positive' : isNegative ? 'text-negative' : 'text-neutral'
                          }`}>
                            {isPositive ? '↑' : isNegative ? '↓' : ''} {percentDisplay}
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>

                {/* Live SVG Chart */}
                {renderExpenseChart()}

                {/* Recent Transactions list */}
                <div className="glass-card p-5">
                  <div className="flex justify-between items-center mb-4 select-none">
                    <h2 className="text-xs font-black uppercase tracking-wider text-[var(--text-primary)] font-display">Recent Transactions Feed</h2>
                    <button
                      onClick={() => setActiveTab('ledger')}
                      className="btn-ghost text-[9px] px-2.5 py-1 font-bold cursor-pointer transition-all"
                    >
                      VIEW FULL LEDGER
                    </button>
                  </div>

                  {expenses.length === 0 ? (
                    <div className="empty-state">
                      <p className="text-[var(--text-secondary)] text-[10px] font-bold uppercase tracking-wider">No transaction history found.</p>
                    </div>
                  ) : (
                    <div className="divide-y divide-[var(--border-color)]">
                      {expenses.slice(0, 5).map(exp => {
                        const paidInBase = Number(exp.amount) * Number(exp.exchangeRate);
                        return (
                          <div key={exp.id} className="py-2.5 flex items-center justify-between text-xs font-mono">
                            <div>
                              <span className="text-[var(--text-secondary)] mr-3">{new Date(exp.dateIncurred).toISOString().slice(5, 10)}</span>
                              <span className="font-bold text-[var(--text-primary)] uppercase">{exp.description}</span>
                              <span className="text-[var(--text-secondary)] ml-2">by {exp.paidBy.name}</span>
                            </div>
                            <div className="text-right font-bold text-[var(--text-primary)] font-mono">
                              {formatAmount(paidInBase)}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* Tab 1: Staged buffer */}
            {activeTab === 'staged' && (
              <div className="space-y-5">
                {/* CSV Ingestion */}
                <div className="glass-card p-5">
                  <div className="flex justify-between items-center mb-2.5">
                    <h2 className="text-xs font-black uppercase tracking-wider text-[var(--text-primary)] font-display">Paste raw CSV data</h2>
                    <span className="text-[9px] text-[var(--text-secondary)] font-mono">HEADER IDENTIFIER RUNNING</span>
                  </div>
                  <textarea
                    value={csvInput}
                    onChange={e => setCsvInput(e.target.value)}
                    placeholder="date,description,paid_by,amount,currency,split_type,split_with,split_details,notes"
                    rows={4}
                    className="w-full glass-input p-3 text-xs font-mono resize-none"
                  />
                  <div className="mt-3 flex flex-col sm:flex-row sm:justify-between sm:items-center gap-3">
                    <span className="text-[9px] text-[var(--text-secondary)] font-mono">
                      Format: date | description | paid_by | amount | currency | split_type | split_with
                    </span>
                    <button
                      onClick={handleManualImport}
                      disabled={isPending || !csvInput.trim()}
                      className="btn-primary text-xs px-4 py-2 transition-all disabled:opacity-50 cursor-pointer"
                    >
                      SCAN & STREAM
                    </button>
                  </div>
                </div>

                {/* Staging Quarantine list */}
                <div className="glass-card p-5">
                  <div className="flex flex-col sm:flex-row sm:justify-between sm:items-center mb-4 gap-4">
                    <div>
                      <h2 className="text-xs font-black uppercase tracking-wider text-[var(--text-primary)] font-display">Quarantined Records Queue</h2>
                      <p className="text-[var(--text-secondary)] text-[10px] mt-0.5">
                        Items requiring manual review due to formatting anomalies or membership date bounds.
                      </p>
                    </div>
                    <div className="flex items-center gap-2 self-start sm:self-auto select-none">
                      {stagedExpenses.filter(s => s.status === 'PENDING').length > 0 && (
                        <button
                          onClick={handleClearStaging}
                          className="btn-ghost hover:border-[var(--accent-rose)] hover:text-white text-[10px] px-3 py-1.5 transition-all focus:outline-none cursor-pointer"
                        >
                          Clear All
                        </button>
                      )}
                      <div className="text-[10px] border border-[var(--border-color)] px-3 py-1.5 text-[var(--text-secondary)] font-bold bg-[var(--bg-card)] rounded-lg">
                        Pending: {stagedExpenses.filter(s => s.status === 'PENDING').length}
                      </div>
                    </div>
                  </div>

                  {stagedExpenses.length === 0 ? (
                    <div className="empty-state">
                      <p className="text-[var(--text-secondary)] text-[10px] font-bold uppercase tracking-wider">No staged items in quarantine buffer.</p>
                    </div>
                  ) : (
                    <div className="overflow-x-auto">
                      <table className="data-table">
                        <thead>
                          <tr>
                            <th className="font-mono">Date</th>
                            <th>Description</th>
                            <th>Payer</th>
                            <th>Amount</th>
                            <th>Anomaly Diagnostics</th>
                            <th>Status</th>
                            <th className="text-right">Actions</th>
                          </tr>
                        </thead>
                        <tbody>
                          {stagedExpenses.map(staged => {
                            const hasAnomalies = staged.anomalies.length > 0;
                            return (
                              <tr key={staged.id}>
                                <td className="font-mono">{staged.dateRaw}</td>
                                <td>
                                  <div className="font-bold text-[var(--text-primary)] text-xs">{staged.description}</div>
                                  {staged.notesRaw && (
                                    <div className="text-[9px] text-[var(--text-secondary)] italic mt-0.5 max-w-xs truncate" title={staged.notesRaw}>
                                      {staged.notesRaw}
                                    </div>
                                  )}
                                </td>
                                <td>
                                  {staged.paidByRaw ? (
                                    <span className="font-bold text-[var(--text-primary)]">{staged.paidByRaw}</span>
                                  ) : (
                                    <span className="badge-rejected">missing</span>
                                  )}
                                </td>
                                <td className="font-bold font-mono text-[var(--text-primary)]">
                                  {staged.amountRaw} {staged.currencyRaw || 'INR'}
                                </td>
                                <td className="max-w-xs">
                                  <div className="flex flex-wrap gap-1">
                                    {staged.anomalies.map((a: string, idx: number) => (
                                      <span
                                        key={`${a}-${idx}`}
                                        title={JSON.stringify(staged.anomalyDetails)}
                                        className="anomaly-tag"
                                      >
                                        {a.replace(/_/g, ' ')}
                                      </span>
                                    ))}
                                    {!hasAnomalies && (
                                      <span className="clean-tag">
                                        CLEAN
                                      </span>
                                    )}
                                  </div>
                                </td>
                                <td>
                                  <span className={staged.status === 'PENDING' ? 'badge-pending' : 'badge-approved'}>
                                    {staged.status}
                                  </span>
                                </td>
                                <td className="text-right">
                                  {staged.status === 'PENDING' ? (
                                    <div className="flex items-center justify-end gap-1.5">
                                      <button
                                        onClick={() => startReview(staged)}
                                        className="btn-ghost hover:border-[var(--accent-cyan)] hover:text-white text-[9px] px-2.5 py-1 transition-all focus:outline-none cursor-pointer"
                                      >
                                        Review
                                      </button>
                                      <button
                                        onClick={() => handleRejectStaged(staged.id)}
                                        className="btn-ghost hover:border-[var(--accent-rose)] hover:text-white text-[9px] px-2.5 py-1 transition-all focus:outline-none cursor-pointer"
                                      >
                                        Reject
                                      </button>
                                    </div>
                                  ) : (
                                    <span className="badge-approved">PROCESSED</span>
                                  )}
                                </td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* Tab 2: Committed Ledger */}
            {activeTab === 'ledger' && (
              <div className="space-y-4">
                {selectedUserAudit && (
                  <div className="glass-card p-4 flex items-center justify-between gap-4 border-[var(--accent-violet)] bg-[var(--accent-violet)]/5">
                    <div>
                      <h3 className="text-xs font-black uppercase tracking-wider text-[var(--text-primary)] flex items-center gap-2 font-mono">
                        <span className="w-1.5 h-1.5 bg-[var(--accent-violet)]"></span>
                        Audit trail active: {selectedUserAudit}
                      </h3>
                      <p className="text-[var(--text-secondary)] text-[10px] mt-0.5 font-mono">
                        Filtering records where {selectedUserAudit} is the payer or debtor.
                      </p>
                    </div>
                    <button
                      onClick={() => setSelectedUserAudit(null)}
                      className="btn-ghost hover:border-[var(--accent-rose)] hover:text-white text-[10px] px-3 py-1.5 transition-all cursor-pointer font-mono"
                    >
                      Clear Audit Filter
                    </button>
                  </div>
                )}

                <div className="glass-card p-5">
                  <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 mb-4">
                    <h2 className="text-xs font-black uppercase tracking-wider text-[var(--text-primary)] font-display">
                      {selectedUserAudit ? `${selectedUserAudit}'s Transaction Audit` : 'Active Expense Ledger'}
                    </h2>
                    <div className="w-full sm:max-w-xs relative select-none">
                      <input
                        type="text"
                        value={searchQuery}
                        onChange={e => setSearchQuery(e.target.value)}
                        placeholder="Filter description, payer..."
                        className="w-full glass-input px-3 py-1.5 text-xs font-mono"
                      />
                      {searchQuery && (
                        <button
                          onClick={() => setSearchQuery('')}
                          className="absolute right-2.5 top-2 text-[var(--text-secondary)] hover:text-[var(--text-primary)] focus:outline-none text-xs cursor-pointer"
                        >
                          ×
                        </button>
                      )}
                    </div>
                  </div>

                  {filteredLedger.length === 0 ? (
                    <div className="empty-state">
                      <p className="text-[var(--text-secondary)] text-[10px] font-bold uppercase tracking-wider">No ledger entries matching query.</p>
                    </div>
                  ) : (
                    <div className="overflow-x-auto">
                      <table className="data-table">
                        <thead>
                          <tr>
                            <th className="font-mono">Date</th>
                            <th>Description</th>
                            <th>Paid By</th>
                            <th>Total Amount</th>
                            <th className="font-mono">Type</th>
                            <th>Splits Breakdown</th>
                            {selectedUserAudit && <th>User Share</th>}
                            <th className="text-right">Delete</th>
                          </tr>
                        </thead>
                        <tbody>
                          {filteredLedger.map(exp => {
                            const paidInBase = Number(exp.amount) * Number(exp.exchangeRate);
                            const isSettlement = exp.isSettlement;
                            const auditUserSplit = exp.splits.find((s: any) => s.user.name === selectedUserAudit);
                            const auditUserShareInBase = auditUserSplit ? Number(auditUserSplit.amount) * Number(exp.exchangeRate) : 0;
                            const wasAuditUserPayer = exp.paidBy.name === selectedUserAudit;

                            return (
                              <tr key={exp.id}>
                                <td className="font-mono">
                                  {new Date(exp.dateIncurred).toISOString().slice(0, 10)}
                                </td>
                                <td>
                                  <div className="flex items-center gap-1.5">
                                    <span className="font-bold text-[var(--text-primary)] text-xs">{exp.description}</span>
                                    {isSettlement && (
                                      <span className="badge-settlement">
                                        SETTLEMENT
                                      </span>
                                    )}
                                    {exp.amount < 0 && (
                                      <span className="badge-rejected">
                                        REFUND
                                      </span>
                                    )}
                                  </div>
                                  {exp.notes && <div className="text-[9px] text-[var(--text-secondary)] italic mt-0.5">{exp.notes}</div>}
                                </td>
                                <td className="font-bold text-[var(--text-primary)]">{exp.paidBy.name}</td>
                                <td className="font-bold font-mono text-[var(--text-primary)] text-xs">
                                  <div>{formatAmount(paidInBase)}</div>
                                  {exp.currency.toUpperCase() !== 'INR' && (
                                    <div className="text-[9px] text-[var(--text-secondary)] font-normal mt-0.5 font-mono">
                                      {exp.amount} {exp.currency} @ {exp.exchangeRate}
                                    </div>
                                  )}
                                </td>
                                <td className="capitalize font-mono">{exp.splitType.toLowerCase()}</td>
                                <td>
                                  <div className="max-w-xs flex flex-wrap gap-1">
                                    {exp.splits.map((s: any) => {
                                      const splitAmtInBase = Number(s.amount) * Number(exp.exchangeRate);
                                      return (
                                        <span
                                          key={s.id}
                                          className={`split-tag ${selectedUserAudit === s.user.name ? 'highlighted' : ''}`}
                                        >
                                          {s.user.name}: {useUSD ? `$${(splitAmtInBase/EXCHANGE_RATE).toFixed(1)}` : `₹${splitAmtInBase.toFixed(0)}`}
                                        </span>
                                      );
                                    })}
                                  </div>
                                </td>
                                {selectedUserAudit && (
                                  <td className="font-mono">
                                    <div className="flex flex-col gap-0.5 text-[10px]">
                                      {wasAuditUserPayer && (
                                        <span className="text-[var(--accent-emerald)] font-bold">
                                          PAID: +{formatAmount(paidInBase)}
                                        </span>
                                      )}
                                      {auditUserSplit && (
                                        <span className="text-[var(--accent-rose)] font-bold">
                                          OWED: -{formatAmount(auditUserShareInBase)}
                                        </span>
                                      )}
                                    </div>
                                  </td>
                                )}
                                <td className="text-right">
                                  <button
                                    onClick={() => handleDeleteExpense(exp.id)}
                                    className="text-[var(--text-secondary)] hover:text-[var(--accent-rose)] transition-colors focus:outline-none p-1 cursor-pointer"
                                    title="Delete and restore to staged buffer"
                                  >
                                    <svg
                                      xmlns="http://www.w3.org/2000/svg"
                                      className="h-3.5 w-3.5"
                                      viewBox="0 0 20 20"
                                      fill="currentColor"
                                    >
                                      <path
                                        fillRule="evenodd"
                                        d="M9 2a1 1 0 00-.894.553L7.382 4H4a1 1 0 000 2v10a2 2 0 002 2h8a2 2 0 002-2V6a1 1 0 100-2h-3.382l-.724-1.447A1 1 0 0011 2H9zM7 8a1 1 0 012 0v6a1 1 0 11-2 0V8zm5-1a1 1 0 00-1 1v6a1 1 0 102 0V8a1 1 0 00-1-1z"
                                        clipRule="evenodd"
                                      />
                                    </svg>
                                  </button>
                                </td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* Tab 3: Settlements list */}
            {activeTab === 'settlements' && (
              <div className="space-y-4">
                <div className="glass-card p-5">
                  <h2 className="text-xs font-black uppercase tracking-wider mb-1 text-[var(--text-primary)] font-display">Debt settlements minimization</h2>
                  <p className="text-[var(--text-secondary)] text-[10px] mb-4">
                    Optimized cash flow instructions calculated to balance roommates net credit using the fewest transactions.
                  </p>

                  {settlements.length === 0 ? (
                    <div className="empty-state">
                      <p className="text-[var(--text-secondary)] text-[10px] font-bold uppercase tracking-wider font-mono">ledger is fully balanced. no payments required.</p>
                    </div>
                  ) : (
                    <div className="space-y-2">
                      {settlements.map((tx, idx) => (
                        <div
                          key={idx}
                          className="settlement-card"
                        >
                          <div className="flex items-center gap-2.5">
                            <span className="font-extrabold text-[var(--text-primary)] bg-white/5 border border-[var(--border-color)] px-2.5 py-1 text-xs rounded-lg">
                              {tx.from}
                            </span>
                            <span className="text-[var(--text-secondary)] font-extrabold text-[9px] uppercase tracking-wider font-mono">pays</span>
                            <span className="font-extrabold text-[var(--text-primary)] bg-white/5 border border-[var(--border-color)] px-2.5 py-1 text-xs rounded-lg">
                              {tx.to}
                            </span>
                          </div>
                          
                          <div className="flex items-center justify-between sm:justify-end gap-3.5 font-mono">
                            <div className="text-sm font-bold text-[var(--text-primary)]">
                              {formatAmount(tx.amount)}
                            </div>
                            <button
                              onClick={() => handleExecuteSettlement(tx.from, tx.to, tx.amount, tx.currency)}
                              className="btn-primary text-[9px] px-2.5 py-1.5 transition-all focus:outline-none cursor-pointer"
                              title="Commit this payment to the database ledger"
                            >
                              MARK PAID
                            </button>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* Tab 4: Timelines */}
            {activeTab === 'memberships' && (
              <div className="glass-card p-5 font-mono">
                <h2 className="text-xs font-black uppercase tracking-wider mb-1 text-[var(--text-primary)] font-display">Group timeline occupancy</h2>
                <p className="text-[var(--text-secondary)] text-[10px] mb-5">
                  Visual calendar tracking each flatmate membership window. Expenses splits are constrained to active dates.
                </p>

                <div className="space-y-4">
                  {memberships.map(m => {
                    const joined = new Date(m.joinedAt);
                    const left = m.leftAt ? new Date(m.leftAt) : null;
                    const { initials, avatarClass } = getAvatarStyles(m.user.name);
                    
                    const tStart = new Date('2026-02-01T00:00:00Z').getTime();
                    const tEnd = new Date('2026-05-31T23:59:59Z').getTime();
                    const totalDiff = tEnd - tStart;
                    
                    const joinedDiff = joined.getTime() - tStart;
                    const leftDiff = (left ? left.getTime() : tEnd) - tStart;
                    
                    const leftPct = Math.max(0, Math.min(100, (joinedDiff / totalDiff) * 100));
                    const widthPct = Math.max(1, Math.min(100, ((leftDiff - joinedDiff) / totalDiff) * 100));
                    
                    const isActiveNow = !left;
                    
                    return (
                      <div key={m.id} className="grid grid-cols-12 items-center gap-3 border-b border-[var(--border-color)] pb-4 last:border-0 last:pb-0">
                        <div className="col-span-3 flex items-center gap-2">
                          <div className={`w-7 h-7 flex items-center justify-center text-[9px] font-bold text-white uppercase rounded-full shrink-0 ${avatarClass}`}>
                            {initials}
                          </div>
                          <div className="min-w-0">
                            <span className="font-bold text-[var(--text-primary)] text-xs truncate block">{m.user.name}</span>
                            <span className={isActiveNow ? 'badge-approved mt-0.5 inline-block' : 'badge-rejected mt-0.5 inline-block'}>
                              {isActiveNow ? 'Active' : m.user.name === 'Dev' || m.user.name === 'Kabir' ? 'Visitor' : 'Former'}
                            </span>
                          </div>
                        </div>
                        
                        <div className="col-span-7 progress-bar relative overflow-hidden">
                          <div
                            style={{ left: `${leftPct}%`, width: `${widthPct}%` }}
                            className={`progress-fill absolute top-0 bottom-0 transition-all duration-350 ${
                              isActiveNow
                                ? 'bg-gradient-to-r from-[var(--accent-violet)] to-[var(--accent-cyan)] shadow-[0_0_12px_rgba(124,58,237,0.3)]'
                                : 'bg-gradient-to-r from-[var(--text-muted)] to-[var(--border-color)]'
                            }`}
                          ></div>
                        </div>
                        
                        <div className="col-span-2 text-right">
                          <button
                            onClick={() => startEditMembership(m)}
                            className="btn-ghost hover:border-[var(--accent-cyan)] hover:text-white text-[9px] px-2 py-1 transition-all cursor-pointer font-mono"
                          >
                            EDIT DATES
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </div>

                <div className="mt-4 pt-2 border-t border-[var(--border-color)] grid grid-cols-12 text-[8px] text-[var(--text-muted)] font-bold font-mono uppercase pl-[25%] pr-[16.6%] select-none">
                  <div className="text-left col-span-3">FEB 2026</div>
                  <div className="text-center col-span-3">MAR 2026</div>
                  <div className="text-center col-span-3">APR 2026</div>
                  <div className="text-right col-span-3">MAY 2026</div>
                </div>
              </div>
            )}
          </div>
        </main>

        {/* Right Sidebar */}
        <aside className="w-80 border-l border-[var(--border-color)] bg-[var(--bg-secondary)]/30 backdrop-blur-md flex flex-col overflow-y-auto px-5 py-5 shrink-0 select-none z-10">
          <div className="flex items-center justify-between pb-3.5 border-b border-[var(--border-color)] mb-4">
            <span className="text-xs font-black uppercase tracking-widest text-[var(--text-primary)] font-display">
              Roommate Registry
            </span>
            <span className="text-[9px] text-[var(--text-secondary)] font-mono uppercase font-bold">
              {balances.length} Flatmates
            </span>
          </div>

          {selectedUserAudit && (
            <div className="mb-4 glass-card p-3 font-mono border-[var(--accent-violet)] bg-[var(--accent-violet)]/5">
              <div className="flex justify-between items-start">
                <span className="text-[9px] font-bold uppercase text-[var(--accent-violet)]">LEDGER FILTER RUNNING</span>
                <button
                  onClick={() => setSelectedUserAudit(null)}
                  className="text-[var(--text-primary)] hover:text-white text-[9px] font-bold focus:outline-none cursor-pointer"
                >
                  CLEAR
                </button>
              </div>
              <div className="text-xs font-black text-[var(--text-primary)] mt-1 uppercase tracking-wider">
                {selectedUserAudit}'s AUDIT TRAIL
              </div>
            </div>
          )}

          <div className="space-y-2.5">
            {balances.map(b => {
              const isNegative = b.netBalance < -0.01;
              const isPositive = b.netBalance > 0.01;
              const { initials, avatarClass } = getAvatarStyles(b.name);
              const isFiltered = selectedUserAudit === b.name;

              return (
                <div
                  key={b.name}
                  onClick={() => {
                    setSelectedUserAudit(b.name);
                    setActiveTab('ledger');
                  }}
                  className={`sidebar-user-row ${isFiltered ? 'active' : ''}`}
                >
                  <div className="flex items-center justify-between w-full">
                    <div className="flex items-center gap-2">
                      <div className={`w-6 h-6 flex items-center justify-center text-[9px] font-bold text-white uppercase rounded-full shrink-0 ${avatarClass}`}>
                        {initials}
                      </div>
                      <span className="text-xs font-semibold text-[var(--text-primary)] uppercase tracking-wider">{b.name}</span>
                    </div>

                    <div className="text-right">
                      <div className={`text-xs font-mono font-bold ${
                        isPositive ? 'text-positive' : isNegative ? 'text-negative' : 'text-neutral'
                      }`}>
                        {isPositive ? '↑ ' : isNegative ? '↓ ' : ''}
                        {formatAmount(Math.abs(b.netBalance))}
                      </div>
                    </div>
                  </div>

                  <div className="grid grid-cols-2 text-[9px] text-[var(--text-secondary)] border-t border-[var(--border-color)] pt-2 font-mono w-full">
                    <div>PAID: {useUSD ? `$${(b.totalPaid/EXCHANGE_RATE).toFixed(0)}` : `₹${b.totalPaid.toFixed(0)}`}</div>
                    <div className="text-right">OWED: {useUSD ? `$${(b.totalOwed/EXCHANGE_RATE).toFixed(0)}` : `₹${b.totalOwed.toFixed(0)}`}</div>
                  </div>
                </div>
              );
            })}
          </div>

          {/* Quick diagnostics statistics */}
          <div className="mt-auto pt-6 border-t border-[var(--border-color)]">
            <h4 className="text-[9px] font-black uppercase tracking-widest text-[var(--text-muted)] mb-3 font-mono">
              SYSTEM STATISTICS
            </h4>
            <div className="space-y-2 text-[9px] font-mono text-[var(--text-secondary)]">
              <div className="flex justify-between">
                <span>TOTAL EXPORTED:</span>
                <span className="text-[var(--text-primary)] font-bold">{expenses.length + stagedExpenses.length} ROWS</span>
              </div>
              <div className="flex justify-between">
                <span>ACTIVE LEDGER:</span>
                <span className="text-[var(--text-primary)] font-bold">{expenses.length} ROWS</span>
              </div>
              <div className="flex justify-between">
                <span>STAGED AUDITS:</span>
                <span className="text-[var(--text-primary)] font-bold">{stagedExpenses.filter(s => s.status === 'PENDING').length} ROWS</span>
              </div>
              <div className="flex justify-between">
                <span>SETTLEMENTS DUE:</span>
                <span className="text-[var(--text-primary)] font-bold">{settlements.length} CHECKS</span>
              </div>
            </div>
          </div>
        </aside>
      </div>

      {/* MODAL 1: Resolve staged expense */}
      {editingStaged && editForm && (
        <div className="modal-overlay">
          <div className="modal-content text-[var(--text-primary)]">
            <h3 className="text-xs font-black uppercase tracking-widest text-[var(--text-primary)] mb-2">RECONCILE & COMMIT STAGED TRANSACTION</h3>
            <p className="text-[var(--text-secondary)] text-[10px] mb-4 font-mono">
              Correct data anomalies and memberships mismatch before saving into ledger.
            </p>

            {/* List of anomalies in modal */}
            <div className="mb-5 bg-[var(--bg-card)] border border-[var(--border-color)] p-3.5 rounded-xl">
              <div className="text-[8px] font-black uppercase text-[var(--text-muted)] tracking-widest">ANOMALIES DIAGNOSED:</div>
              <div className="flex flex-wrap gap-1 mt-2">
                {editingStaged.anomalies.map((a: string, idx: number) => (
                  <span key={`${a}-${idx}`} className="anomaly-tag">
                    {a.replace(/_/g, ' ')}
                  </span>
                ))}
              </div>
              <div className="text-[10px] text-[var(--text-secondary)] mt-2.5 leading-relaxed font-mono">
                {Object.keys(editingStaged.anomalyDetails).map(k => (
                  <div key={k}>• {editingStaged.anomalyDetails[k]}</div>
                ))}
              </div>
            </div>

            {/* Edit Fields Form */}
            <div className="space-y-4 font-mono">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-[9px] uppercase font-black text-[var(--text-secondary)] mb-1.5">Date</label>
                  <input
                    type="date"
                    value={editForm.date}
                    onChange={e => setEditForm({ ...editForm, date: e.target.value })}
                    className="w-full glass-input px-3 py-2 text-xs"
                  />
                </div>
                <div>
                  <label className="block text-[9px] uppercase font-black text-[var(--text-secondary)] mb-1.5">Description</label>
                  <input
                    type="text"
                    value={editForm.description}
                    onChange={e => setEditForm({ ...editForm, description: e.target.value })}
                    className="w-full glass-input px-3 py-2 text-xs"
                  />
                </div>
              </div>

              <div className="grid grid-cols-3 gap-4">
                <div>
                  <label className="block text-[9px] uppercase font-black text-[var(--text-secondary)] mb-1.5">Payer</label>
                  <select
                    value={editForm.paid_by}
                    onChange={e => setEditForm({ ...editForm, paid_by: e.target.value })}
                    className="w-full glass-input px-2 py-2 text-xs"
                  >
                    <option value="">Select Payer</option>
                    {memberships.map(m => (
                      <option key={m.user.id} value={m.user.name}>{m.user.name}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-[9px] uppercase font-black text-[var(--text-secondary)] mb-1.5">Amount</label>
                  <input
                    type="number"
                    value={editForm.amount}
                    onChange={e => setEditForm({ ...editForm, amount: parseFloat(e.target.value) || 0 })}
                    className="w-full glass-input px-3 py-2 text-xs"
                  />
                </div>
                <div>
                  <label className="block text-[9px] uppercase font-black text-[var(--text-secondary)] mb-1.5">Currency</label>
                  <select
                    value={editForm.currency}
                    onChange={e => setEditForm({ ...editForm, currency: e.target.value })}
                    className="w-full glass-input px-2 py-2 text-xs"
                  >
                    <option value="INR">INR (₹)</option>
                    <option value="USD">USD ($)</option>
                  </select>
                </div>
              </div>

              <div>
                <label className="block text-[9px] uppercase font-black text-[var(--text-secondary)] mb-1.5">Split Type</label>
                <select
                  value={editForm.split_type}
                  onChange={e => setEditForm({ ...editForm, split_type: e.target.value })}
                  className="w-full glass-input px-2 py-2 text-xs"
                >
                  <option value="equal">Equal</option>
                  <option value="percentage">Percentage</option>
                  <option value="share">Share</option>
                  <option value="unequal">Unequal</option>
                </select>
              </div>

              <div>
                <label className="block text-[9px] uppercase font-black text-[var(--text-secondary)] mb-1.5">Split With Members</label>
                <div className="grid grid-cols-3 gap-2 mt-2">
                  {memberships.map(m => {
                    const isChecked = editForm.split_with.includes(m.user.name);
                    return (
                      <label key={m.user.id} className="flex items-center gap-2 glass-card p-2 rounded-lg cursor-pointer hover:bg-white/5 transition-colors">
                        <input
                          type="checkbox"
                          checked={isChecked}
                          onChange={() => {
                            const updated = isChecked
                              ? editForm.split_with.filter(name => name !== m.user.name)
                              : [...editForm.split_with, m.user.name];
                            setEditForm({ ...editForm, split_with: updated });
                          }}
                        />
                        <span className="text-[10px] font-semibold text-[var(--text-primary)]">{m.user.name}</span>
                      </label>
                    );
                  })}
                </div>
              </div>

              {editForm.split_type !== 'equal' && (
                <div>
                  <label className="block text-[9px] uppercase font-black text-[var(--text-secondary)] mb-1.5">Split Details / Shares / Percentages</label>
                  <input
                    type="text"
                    value={editForm.split_details}
                    onChange={e => setEditForm({ ...editForm, split_details: e.target.value })}
                    placeholder="e.g. Aisha 30%; Rohan 30%; Priya 40%"
                    className="w-full glass-input px-3 py-2 text-xs"
                  />
                  <span className="text-[9px] text-[var(--text-secondary)] mt-1 block">
                    Format: Name 30%; Name 40% (sums to 100%) or Name 1; Name 2 (shares).
                  </span>
                </div>
              )}
            </div>

            {/* Actions */}
            <div className="mt-6 flex justify-end gap-2.5">
              <button
                onClick={() => {
                  setEditingStaged(null);
                  setEditForm(null);
                }}
                className="btn-ghost text-xs px-4 py-2 transition-all focus:outline-none cursor-pointer"
              >
                CANCEL
              </button>
              <button
                onClick={handleApproveEdit}
                className="btn-primary text-xs px-4 py-2 transition-all focus:outline-none cursor-pointer"
              >
                APPROVE & COMMIT
              </button>
            </div>
          </div>
        </div>
      )}

      {/* MODAL 2: Modify Membership dates */}
      {editingMembership && (
        <div className="modal-overlay">
          <div className="modal-content text-[var(--text-primary)]">
            <h3 className="text-xs font-black uppercase tracking-widest text-[var(--text-primary)] mb-1">ADJUST MEMB TIMELINE</h3>
            <p className="text-[var(--text-secondary)] text-[10px] mb-4">
              Modify occupancy duration for roommate <strong className="text-[var(--text-primary)]">{editingMembership.user.name}</strong>.
            </p>

            <div className="space-y-4">
              <div>
                <label className="block text-[9px] uppercase font-black text-[var(--text-secondary)] mb-1.5">Joined Group At</label>
                <input
                  type="date"
                  value={membershipForm.joinedAt}
                  onChange={e => setMembershipForm({ ...membershipForm, joinedAt: e.target.value })}
                  className="w-full glass-input px-3 py-2 text-xs"
                />
              </div>
              <div>
                <label className="block text-[9px] uppercase font-black text-[var(--text-secondary)] mb-1.5">Left Group At (Blank if active)</label>
                <input
                  type="date"
                  value={membershipForm.leftAt}
                  onChange={e => setMembershipForm({ ...membershipForm, leftAt: e.target.value })}
                  className="w-full glass-input px-3 py-2 text-xs"
                />
              </div>
            </div>

            <div className="mt-6 flex justify-end gap-2.5">
              <button
                onClick={() => setEditingMembership(null)}
                className="btn-ghost text-xs px-4 py-2.5 transition-all focus:outline-none cursor-pointer"
              >
                CANCEL
              </button>
              <button
                onClick={handleSaveMembership}
                className="btn-primary text-xs px-4 py-2.5 transition-all focus:outline-none cursor-pointer"
              >
                SAVE TIMELINE
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
