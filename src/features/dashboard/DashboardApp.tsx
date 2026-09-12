import { Alert, Button } from "@apps-simples/ui";
import { useEffect, useMemo, useRef, useState } from "react";
import { version } from "../../../package.json";
import { localCivilMonth, monthKey } from "../../domain/dates";
import type { Entitlement } from "../../domain/entitlement";
import { monthlyTotals } from "../../domain/money";
import type { Category, FinancialProfile, Transaction } from "../../domain/models";
import { recurringOccurrenceForMonth } from "../../domain/transactions";
import type { AuthUser } from "../../services/auth";
import {
  categoriesRepository,
  ensureDefaultCategories,
  ensureFinancialProfiles,
  getSelectedProfile,
  getTheme,
  profilesRepository,
  setSelectedProfile,
  transactionsRepository,
} from "../../storage/database";
import { CalculatorView } from "./CalculatorView";
import { CategoriesView } from "./CategoriesView";
import { DashboardView } from "./DashboardView";
import { SettingsView } from "./SettingsView";
import { TransactionsView } from "./TransactionsView";
import { ReportModal } from "./ReportModal";
import { ProfileSelect } from "./ProfileSelect";
import type { TransactionPrefill } from "./TransactionForm";
import type { View } from "./types";

const navigation: Array<[View, string]> = [
  ["dashboard", "Resumo"],
  ["transactions", "Lançamentos"],
  ["categories", "Categorias"],
  ["calculator", "Calculadora"],
];
export function DashboardApp({
  user,
  entitlement,
  onLogout,
}: {
  user: AuthUser;
  entitlement: Entitlement;
  onLogout: () => void;
}) {
  const [view, setView] = useState<View>("dashboard"),
    [month, setMonth] = useState(localCivilMonth()),
    [transactions, setTransactions] = useState<Transaction[]>([]),
    [allTransactions, setAllTransactions] = useState<Transaction[]>([]),
    [categories, setCategories] = useState<Category[]>([]),
    [profiles, setProfiles] = useState<FinancialProfile[]>([]),
    [selectedProfileId, setSelectedProfileId] = useState(""),
    [reportOpen, setReportOpen] = useState(false),
    [message, setMessage] = useState(""),
    [error, setError] = useState(""),
    [prefill, setPrefill] = useState<TransactionPrefill>();
  const monthInputRef = useRef<HTMLInputElement>(null);
  const reportTriggerRef = useRef<HTMLElement | null>(null);
  const refresh = async () => {
    await ensureDefaultCategories(user.uid);
    await ensureFinancialProfiles(user.uid);
    const all = await transactionsRepository.list(user.uid);
    const nextProfiles = await profilesRepository.list(user.uid);
    setAllTransactions(all);
    setTransactions(all.filter((i) => !i.isDeleted));
    setCategories(await categoriesRepository.list(user.uid));
    setProfiles(nextProfiles);
    if (selectedProfileId && !nextProfiles.some((profile) => profile.id === selectedProfileId)) {
      setSelectedProfileId("");
      await setSelectedProfile(user.uid, "");
    }
  };
  useEffect(() => {
    document.documentElement.dataset.theme = "dark";
    void (async () => {
      await refresh();
      const nextProfiles = await profilesRepository.list(user.uid);
      setSelectedProfileId(await getSelectedProfile(user.uid, nextProfiles));
    })().catch((e) => setError((e as Error).message));
    void getTheme(user.uid);
  }, [user.uid]);
  useEffect(() => {
    void transactionsRepository
      .list(user.uid)
      .then(async (all) => {
        const ids = [
          ...new Set(
            all
              .filter((i) => i.kind === "recurring" && i.seriesId)
              .map((i) => i.seriesId!),
          ),
        ];
        const additions = ids
          .map((id) =>
            recurringOccurrenceForMonth(
              all.filter((i) => i.seriesId === id),
              month,
            ),
          )
          .filter((i): i is Transaction => Boolean(i));
        if (additions.length) {
          await transactionsRepository.putMany(additions);
          await refresh();
        }
      })
      .catch((e) => setError((e as Error).message));
  }, [month, user.uid]);
  useEffect(() => {
    if (!message) return;
    const timer = setTimeout(() => setMessage(""), 5000);
    return () => clearTimeout(timer);
  }, [message]);
  const visible = useMemo(
    () => transactions.filter((i) => monthKey(i.dueDate) === month && (!selectedProfileId || i.profileId === selectedProfileId)),
    [transactions, month, selectedProfileId],
  );
  const changeProfile = async (profileId: string) => {
    try {
      await setSelectedProfile(user.uid, profileId);
      setSelectedProfileId(profileId);
    } catch (reason) { setError((reason as Error).message); }
  };
  const closeReport = () => {
    setReportOpen(false);
    setTimeout(() => reportTriggerRef.current?.focus(), 0);
  };
  const moveMonth = (delta: number) => {
    const [y, m] = month.split("-").map(Number);
    const date = new Date(Date.UTC(y!, m! - 1 + delta, 1));
    setMonth(
      `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}`,
    );
  };
  const openMonthPicker = () => {
    const input = monthInputRef.current;
    if (!input) return;
    if (typeof input.showPicker === "function") {
      try {
        input.showPicker();
        return;
      } catch {
        // O foco mantém disponível o seletor nativo em navegadores sem suporte.
      }
    }
    input.focus();
  };
  return (
    <div className="app-shell">
      <header className="app-header">
        <div className="app-container header-content">
          <div className="app-brand">
            <strong>Gastos Simples</strong>
            <small>Premium</small>
          </div>
          <div className="header-actions">
            <Button
              className="settings-button"
              size="compact"
              variant="ghost"
              aria-label="Abrir Ajustes"
              title="Ajustes"
              aria-pressed={view === "settings"}
              onClick={() => setView("settings")}
            >
              <svg
                viewBox="0 0 24 24"
                width="22"
                height="22"
                aria-hidden="true"
                focusable="false"
              >
                <path d="M12 15.25A3.25 3.25 0 1 0 12 8.75a3.25 3.25 0 0 0 0 6.5Z" />
                <path d="M19.4 13.5a7.8 7.8 0 0 0 0-3l1.7-1.3-1.8-3.1-2.1.9a8.2 8.2 0 0 0-2.6-1.5L14.3 3h-3.6l-.3 2.5A8.2 8.2 0 0 0 7.8 7l-2.1-.9-1.8 3.1 1.7 1.3a7.8 7.8 0 0 0 0 3l-1.7 1.3 1.8 3.1 2.1-.9a8.2 8.2 0 0 0 2.6 1.5l.3 2.5h3.6l.3-2.5a8.2 8.2 0 0 0 2.6-1.5l2.1.9 1.8-3.1-1.7-1.3Z" />
              </svg>
            </Button>
            <Button size="compact" variant="ghost" onClick={onLogout}>
              Sair
            </Button>
          </div>
        </div>
      </header>
      <nav className="app-nav" aria-label="Navegação principal">
        <div className="app-container nav-list">
          {navigation.map(([id, label]) => (
            <button
              key={id}
              className={view === id ? "active" : ""}
              onClick={() => setView(id)}
              aria-current={view === id ? "page" : undefined}
            >
              {label}
            </button>
          ))}
        </div>
      </nav>
      <main className="app-container app-main">
        {error && (
          <Alert type="error" dismissible onDismiss={() => setError("")}>
            {error}
          </Alert>
        )}
        {message && (
          <Alert type="success" dismissible onDismiss={() => setMessage("")}>
            {message}
          </Alert>
        )}
        {(view === "dashboard" || view === "transactions") && (
          <div className="planning-controls">
          <div className="month-control" aria-label="Mês do planejamento">
            <Button
              variant="ghost"
              className="month-arrow"
              aria-label="Mês anterior"
              onClick={() => moveMonth(-1)}
            >
              <svg viewBox="0 0 16 24" aria-hidden="true" focusable="false">
                <path d="M12.5 3 4 12l8.5 9" />
              </svg>
            </Button>
            <label className="month-picker">
              <span className="sr-only">Mês selecionado</span>
              <input
                ref={monthInputRef}
                type="month"
                value={month}
                onClick={openMonthPicker}
                onChange={(e) => {
                  if (/^\d{4}-(0[1-9]|1[0-2])$/.test(e.target.value))
                    setMonth(e.target.value);
                }}
              />
            </label>
            <Button
              variant="ghost"
              className="month-arrow"
              aria-label="Próximo mês"
              onClick={() => moveMonth(1)}
            >
              <svg viewBox="0 0 16 24" aria-hidden="true" focusable="false">
                <path d="m3.5 3 8.5 9-8.5 9" />
              </svg>
            </Button>
          </div>
          <div className="profile-control">
            <ProfileSelect className="global-profile-select" label="Perfil financeiro" profiles={profiles} includeAll value={selectedProfileId} onChange={(profileId) => void changeProfile(profileId)} />
          </div>
          </div>
        )}
        {view === "dashboard" && (
          <DashboardView items={visible} totals={monthlyTotals(visible)} />
        )}{" "}
        {view === "transactions" && (
          <TransactionsView
            ownerUid={user.uid}
            items={transactions}
            categories={categories}
            profiles={profiles}
            selectedProfileId={selectedProfileId}
            month={month}
            prefill={prefill}
            onPrefillUsed={() => setPrefill(undefined)}
            onChanged={refresh}
            onError={setError}
            onMessage={setMessage}
          />
        )}{" "}
        {view === "categories" && (
          <CategoriesView
            ownerUid={user.uid}
            items={transactions}
            categories={categories}
            profiles={profiles}
            onChanged={refresh}
            onError={setError}
            onMessage={setMessage}
          />
        )}{" "}
        {view === "calculator" && (
          <CalculatorView
            ownerUid={user.uid}
            onError={setError}
            onMessage={setMessage}
            onUseValue={(value) => {
              setPrefill(value);
              setView("transactions");
            }}
          />
        )}{" "}
        {view === "settings" && (
          <SettingsView
            user={user}
            entitlement={entitlement}
            onLogout={onLogout}
            onChanged={refresh}
            onError={setError}
            onMessage={setMessage}
            profiles={profiles}
            transactions={allTransactions}
            selectedProfileId={selectedProfileId}
            onProfilesChanged={refresh}
            onProfileSelectionChanged={changeProfile}
            onExportReport={(trigger) => { reportTriggerRef.current = trigger; setReportOpen(true); }}
          />
        )}
        <ReportModal open={reportOpen} ownerUid={user.uid} transactions={transactions} profiles={profiles} categories={categories} onClose={closeReport} onError={setError} onMessage={setMessage} />
      </main>
      <footer className="app-footer">
        Apps Simples — Gastos Simples v{version}
      </footer>
    </div>
  );
}
