import { createRoot } from "react-dom/client";
import "@apps-simples/ui/style.css";
import "../styles/global.css";
import "../styles/app.css";
import { DashboardApp } from "../features/dashboard/DashboardApp";
import { LoginView } from "../features/auth/LoginView";
import { PaywallView } from "../features/subscription/PaywallView";
import { categoriesRepository, clearUserDataForTesting, profilesRepository, transactionsRepository } from "../storage/database";
import type { Category, FinancialProfile, Transaction } from "../domain/models";

const ownerUid = "visual-user";
const now = new Date();
const ym = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
const iso = (day: number) => `${ym}-${String(day).padStart(2, "0")}`;
const timestamp = now.toISOString();
const visualProfiles: FinancialProfile[] = ["Principal", "João", "Maria"].map((name, index) => ({ id: `visual-profile-${index + 1}`, ownerUid, name, createdAt: timestamp, updatedAt: timestamp }));
const samples: Transaction[] = [
  {
    id: "visual-1",
    ownerUid,
    profileId: visualProfiles[0]!.id,
    occurrenceKey: "single:1",
    description: "Salário",
    amountCents: 480000,
    type: "income",
    status: "received",
    dueDate: iso(5),
    categoryId: "income",
    categoryName: "Salário",
    notes: "",
    kind: "single",
    paidAt: timestamp,
    createdAt: timestamp,
    updatedAt: timestamp,
  },
  {
    id: "visual-2",
    ownerUid,
    profileId: visualProfiles[1]!.id,
    occurrenceKey: "single:2",
    description: "Aluguel",
    amountCents: 135000,
    type: "expense",
    status: "paid",
    dueDate: iso(8),
    categoryId: "home",
    categoryName: "Casa",
    notes: "Pagamento mensal",
    kind: "single",
    paidAt: timestamp,
    createdAt: timestamp,
    updatedAt: timestamp,
  },
  {
    id: "visual-3",
    ownerUid,
    profileId: visualProfiles[2]!.id,
    occurrenceKey: "series:1",
    seriesId: "series",
    description: "Curso de inglês com descrição longa para validar quebra de texto no relatório financeiro",
    amountCents: 18990,
    type: "expense",
    status: "pending",
    dueDate: iso(20),
    categoryId: "education",
    categoryName: "Educação",
    notes: "",
    kind: "installment",
    installmentCurrent: 3,
    installmentTotal: 12,
    createdAt: timestamp,
    updatedAt: timestamp,
  },
  {
    id: "visual-4",
    ownerUid,
    profileId: visualProfiles[1]!.id,
    occurrenceKey: "single:4",
    description: "Reembolso",
    amountCents: 8500,
    type: "income",
    status: "pending",
    dueDate: iso(22),
    categoryId: "visual-income",
    categoryName: "Outras receitas",
    notes: "",
    kind: "single",
    createdAt: timestamp,
    updatedAt: timestamp,
  },
];
const visualCategories: Category[] = [
  {
    id: "visual-free",
    ownerUid,
    name: "Viagem",
    type: "expense",
    isDefault: false,
  },
  {
    id: "education",
    ownerUid,
    name: "Educação personalizada",
    type: "expense",
    isDefault: false,
  },
];
samples.push(...Array.from({ length: 55 }, (_, index): Transaction => ({
  id: `visual-report-${index}`,
  ownerUid,
  profileId: visualProfiles[index % visualProfiles.length]!.id,
  occurrenceKey: `visual-report:${index}`,
  description: `Lançamento detalhado ${index + 1} para validar relatório financeiro com várias páginas e textos extensos`,
  amountCents: 1250 + index * 25,
  type: index % 3 === 0 ? "income" : "expense",
  status: index % 4 === 0 ? (index % 3 === 0 ? "received" : "paid") : "pending",
  dueDate: iso((index % 28) + 1),
  categoryId: index % 3 === 0 ? "income" : "home",
  categoryName: index % 3 === 0 ? "Salário" : "Casa",
  notes: "Amostra local para inspeção visual",
  kind: "single",
  createdAt: timestamp,
  updatedAt: timestamp,
})));
const mode = new URLSearchParams(location.search).get("mode");
const root = createRoot(document.getElementById("root")!);
if (mode === "login")
  root.render(<LoginView busy={false} onLogin={() => {}} />);
else if (mode === "paywall")
  root.render(
    <PaywallView
      entitlement={{ status: "none", hasAccess: false }}
      loading={false}
      onStart={() => {}}
      onRefresh={() => {}}
      onLogout={() => {}}
    />,
  );
else {
  await clearUserDataForTesting(ownerUid);
  await transactionsRepository.putMany(samples);
  await categoriesRepository.putMany(visualCategories);
  await profilesRepository.putMany(visualProfiles);
  root.render(
    <DashboardApp
      user={{
        uid: ownerUid,
        displayName: "Jean Luis",
        email: "jean@example.test",
        photoURL: null,
      }}
      entitlement={{ status: "active", hasAccess: true }}
      onLogout={() => {}}
    />,
  );
}
