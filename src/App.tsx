import { useCallback, useEffect, useState } from "react";
import { Navigate, Route, Routes } from "react-router-dom";
import { Alert, Spin, Typography } from "antd";
import { api } from "./api";
import { AppShell } from "./components/AppShell";
import { useMonth, withMonth } from "./hooks/useMonth";
import type {
  CashMovement,
  Category,
  CategoryRule,
  GoldLot,
  ImportBatch,
  Person,
  Transaction,
} from "./types";
import { OverviewPage } from "./pages/Overview";
import { TransactionsPage } from "./pages/Transactions";
import { ImportPage } from "./pages/Import";
import { BudgetsPage } from "./pages/Budgets";
import { RulesPage } from "./pages/Rules";
import { CashPage } from "./pages/Cash";
import { GoldPage } from "./pages/Gold";
import { ContractsPage } from "./pages/Contracts";
import { ReportPage } from "./pages/Report";
import { SetupWizard } from "./pages/SetupWizard";
import type { DetectedContract } from "./lib/contracts";

export function App() {
  const [ready, setReady] = useState(false);
  const [error, setError] = useState("");
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [people, setPeople] = useState<Person[]>([]);
  const [rules, setRules] = useState<CategoryRule[]>([]);
  const [imports, setImports] = useState<ImportBatch[]>([]);
  const [cashBalance, setCashBalance] = useState(0);
  const [bankBalance, setBankBalance] = useState<number | null>(null);
  const [bankBalanceAsOf, setBankBalanceAsOf] = useState<string | null>(null);
  const [openingBalance, setOpeningBalance] = useState(0);
  const [onboarded, setOnboarded] = useState(true);
  const [cashMovements, setCashMovements] = useState<CashMovement[]>([]);
  const [goldLots, setGoldLots] = useState<GoldLot[]>([]);
  const [contractRows, setContractRows] = useState<DetectedContract[]>([]);
  const [contractProvider, setContractProvider] = useState("local-pattern-model");
  const [contractsBusy, setContractsBusy] = useState(false);
  const { month, setMonth } = useMonth();

  const reload = useCallback(async () => {
    const [tx, cats, ppl, rls, imps, cash, account, contracts, gold] = await Promise.all([
      api.transactions(),
      api.categories(),
      api.people(),
      api.rules(),
      api.imports(),
      api.cash(),
      api.account(),
      api.contracts(),
      api.gold(),
    ]);
    setTransactions(tx);
    setCategories(cats);
    setPeople(ppl);
    setRules(rls);
    setImports(imps);
    setCashBalance(cash.balance);
    setBankBalance(account.bankBalance);
    setBankBalanceAsOf(account.bankBalanceAsOf);
    setOpeningBalance(account.openingBalance);
    setOnboarded(account.onboarded);
    setCashMovements(cash.movements);
    setGoldLots(gold.lots);
    setContractRows(contracts.contracts);
    setContractProvider(contracts.provider);
    setReady(true);
  }, []);

  useEffect(() => {
    reload().catch((err) => {
      setError(err instanceof Error ? err.message : "API is not running");
      setReady(true);
    });
  }, [reload]);

  if (!ready) {
    return (
      <div className="splash">
        <Spin size="large" tip="Opening Haushalt…">
          <div style={{ minHeight: 48 }} />
        </Spin>
      </div>
    );
  }

  if (!error && !onboarded) {
    return <SetupWizard onDone={reload} />;
  }

  if (error && transactions.length === 0) {
    return (
      <div className="offline">
        <div className="offline-card">
          <Typography.Title level={3} style={{ fontFamily: "var(--font-serif)" }}>
            Haushalt is offline
          </Typography.Title>
          <Typography.Paragraph>
            Start the app with <Typography.Text code>npm run dev</Typography.Text>, or with Docker Compose.
          </Typography.Paragraph>
          <Alert type="error" message={error} />
        </div>
      </div>
    );
  }

  return (
    <Routes>
      <Route element={<AppShell />}>
        <Route
          path="/"
          element={
            <OverviewPage
              month={month}
              transactions={transactions}
              categories={categories}
              cashOnHand={cashBalance}
              cashMovements={cashMovements}
              goldLots={goldLots}
              bankBalance={bankBalance}
              bankBalanceAsOf={bankBalanceAsOf}
              contracts={contractRows}
            />
          }
        />
        <Route
          path="/cash"
          element={
            <CashPage
              balance={cashBalance}
              movements={cashMovements}
              categories={categories}
              onAdd={async (body) => {
                await api.addCash(body);
                await reload();
              }}
              onPatch={async (id, body) => {
                await api.patchCash(id, body);
                await reload();
              }}
              onDelete={async (id) => {
                await api.deleteCash(id);
                await reload();
              }}
            />
          }
        />
        <Route
          path="/gold"
          element={
            <GoldPage
              lots={goldLots}
              onAdd={async (body) => {
                await api.addGold(body);
                await reload();
              }}
              onPatch={async (id, body) => {
                await api.patchGold(id, body);
                await reload();
              }}
              onDelete={async (id) => {
                await api.deleteGold(id);
                await reload();
              }}
            />
          }
        />
        <Route
          path="/transactions"
          element={
            <TransactionsPage
              month={month}
              transactions={transactions}
              categories={categories}
              people={people}
              cashMovements={cashMovements}
              openingBalance={openingBalance}
              onMonthChange={setMonth}
              onPatch={async (id, patch) => {
                await api.patchTransaction(id, patch);
                await reload();
              }}
              onPatchCash={async (id, body) => {
                await api.patchCash(id, body);
                await reload();
              }}
              onDeleteCash={async (id) => {
                await api.deleteCash(id);
                await reload();
              }}
            />
          }
        />
        <Route
          path="/import"
          element={
            <ImportPage
              imports={imports}
              onPreview={api.previewImport}
              onCommit={async (fileName, csvText, includeSoft) => {
                const batch = await api.commitImport(fileName, csvText, includeSoft);
                await reload();
                return batch;
              }}
              onRestored={reload}
            />
          }
        />
        <Route
          path="/budgets"
          element={
            <BudgetsPage
              month={month}
              categories={categories}
              transactions={transactions}
              rules={rules}
              onSave={async (id, patch) => {
                await api.patchCategory(id, patch);
                await reload();
              }}
              onAdd={async (body) => {
                await api.addCategory(body);
                await reload();
              }}
              onDelete={async (id, moveTo) => {
                await api.deleteCategory(id, moveTo);
                await reload();
              }}
            />
          }
        />
        <Route
          path="/contracts"
          element={
            <ContractsPage
              contracts={contractRows}
              provider={contractProvider}
              busy={contractsBusy}
              onRefresh={async () => {
                setContractsBusy(true);
                try {
                  const result = await api.analyzeContracts();
                  setContractRows(result.contracts);
                  setContractProvider(result.provider);
                } finally {
                  setContractsBusy(false);
                }
              }}
            />
          }
        />
        <Route
          path="/year"
          element={
            <ReportPage
              year={Number(month.slice(0, 4))}
              onYearChange={(year) => setMonth(`${year}-${month.slice(5)}`)}
              transactions={transactions}
              categories={categories}
            />
          }
        />
        <Route
          path="/rules"
          element={
            <RulesPage
              rules={rules}
              categories={categories}
              uncategorizedCount={transactions.filter((tx) => !tx.categoryId && tx.splits.length === 0).length}
              onAdd={async (rule) => {
                await api.addRule(rule);
                await reload();
              }}
              onDelete={async (id) => {
                await api.deleteRule(id);
                await reload();
              }}
              onApply={async () => {
                const result = await api.applyRules();
                await reload();
                return result;
              }}
            />
          }
        />
        <Route path="*" element={<Navigate to={withMonth("/", month)} replace />} />
      </Route>
    </Routes>
  );
}
