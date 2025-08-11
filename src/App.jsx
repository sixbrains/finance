
import React, { useEffect, useMemo, useState } from "react";
import { PieChart, Pie, Cell, Tooltip, Legend, BarChart, Bar, XAxis, YAxis, CartesianGrid, ResponsiveContainer } from "recharts";
import { Plus, Wallet, CreditCard, Trash2, BarChart2, Download, Upload, RefreshCcw, CheckCircle2, XCircle } from "lucide-react";

// --- Utilidades ---
const COP = new Intl.NumberFormat("es-CO", { style: "currency", currency: "COP", maximumFractionDigits: 0 });
const fmtCOP = (cents) => COP.format((cents ?? 0) / 100);
const toCents = (str) => {
  if (!str) return 0;
  const s = ("" + str).replace(/[^0-9.,-]/g, "").replace(/,/g, ".");
  const v = parseFloat(s);
  if (isNaN(v)) return 0;
  return Math.round(v * 100);
};
const todayStr = () => new Date().toISOString().slice(0, 10);

// --- Modelos ---
const ACCOUNT_TYPES = { CASH: "CASH", CREDIT: "CREDIT" };
const PAYMENT_METHODS = [
  { id: "VISA", label: "Tarjeta de crédito Visa", accountName: "Tarjeta de crédito Visa" },
  { id: "DEBITO_AHORROS", label: "Tarjeta débito cuenta de ahorros", accountName: "Cuenta de ahorros" },
  { id: "NEQUI", label: "Nequi", accountName: "Nequi" },
  { id: "DAVIPLATA", label: "Daviplata", accountName: "Daviplata" },
  { id: "CUENTA_AHORROS", label: "Cuenta de ahorros", accountName: "Cuenta de ahorros" },
];

// --- Seed inicial ---
const defaultAccounts = [
  { id: "ahorros", name: "Cuenta de ahorros", type: ACCOUNT_TYPES.CASH, initialBalanceCents: 0 },
  { id: "empresa", name: "Cuenta de la empresa", type: ACCOUNT_TYPES.CASH, initialBalanceCents: 0 },
  { id: "nequi", name: "Nequi", type: ACCOUNT_TYPES.CASH, initialBalanceCents: 0 },
  { id: "daviplata", name: "Daviplata", type: ACCOUNT_TYPES.CASH, initialBalanceCents: 0 },
  { id: "visa", name: "Tarjeta de crédito Visa", type: ACCOUNT_TYPES.CREDIT, creditLimitCents: 300000000, initialDebtCents: 0 },
  { id: "rotativo", name: "Crédito Rotativo", type: ACCOUNT_TYPES.CREDIT, creditLimitCents: 500000000, initialDebtCents: 0 },
];

const defaultCategories = [
  { id: "comida", name: "Comida" },
  { id: "servicios", name: "Servicios" },
  { id: "restaurantes", name: "Restaurantes" },
  { id: "transportes", name: "Transportes" },
];

// --- Storage helpers ---
const LS_KEYS = {
  ACCOUNTS: "ga_accounts",
  CATEGORIES: "ga_categories",
  TXS: "ga_transactions",
};

function useLocalState(key, initial) {
  const [state, setState] = useState(() => {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : initial;
  });
  useEffect(() => {
    localStorage.setItem(key, JSON.stringify(state));
  }, [key, state]);
  return [state, setState];
}

// --- Cálculos de saldos ---
function computeBalances(accounts, txs) {
  const ef = {}; // efectivo por cuenta CASH
  const debt = {}; // deuda por cuenta CREDIT

  accounts.forEach((a) => {
    if (a.type === ACCOUNT_TYPES.CASH) {
      ef[a.id] = a.initialBalanceCents || 0;
    } else {
      debt[a.id] = a.initialDebtCents || 0;
    }
  });

  txs.forEach((t) => {
    if (t.type === "INGRESO") {
      if (t.accountToId && ef[t.accountToId] !== undefined) ef[t.accountToId] += t.amountCents;
    } else if (t.type === "GASTO") {
      const acc = accounts.find((a) => a.id === t.accountFromId);
      if (acc?.type === ACCOUNT_TYPES.CREDIT) {
        debt[acc.id] = (debt[acc.id] || 0) + t.amountCents;
      } else if (acc?.type === ACCOUNT_TYPES.CASH) {
        ef[acc.id] = (ef[acc.id] || 0) - t.amountCents;
      }
    } else if (t.type === "TRANSFERENCIA") {
      const from = accounts.find((a) => a.id === t.accountFromId);
      const to = accounts.find((a) => a.id === t.accountToId);
      if (!from || !to || from.id === to.id) return;
      if (to.type === ACCOUNT_TYPES.CREDIT) {
        // Pago a tarjeta
        debt[to.id] = (debt[to.id] || 0) - t.amountCents;
        if (from.type === ACCOUNT_TYPES.CASH) ef[from.id] = (ef[from.id] || 0) - t.amountCents;
      } else if (from.type === ACCOUNT_TYPES.CASH && to.type === ACCOUNT_TYPES.CASH) {
        ef[from.id] = (ef[from.id] || 0) - t.amountCents;
        ef[to.id] = (ef[to.id] || 0) + t.amountCents;
      }
    }
  });

  const efectivoTotal = Object.values(ef).reduce((a, b) => a + b, 0);
  let creditoDisponibleTotal = 0;
  const perAccount = accounts.map((a) => {
    if (a.type === ACCOUNT_TYPES.CREDIT) {
      const d = debt[a.id] || 0;
      const disp = (a.creditLimitCents || 0) - d; // si deuda < 0, disponible > cupo
      creditoDisponibleTotal += disp;
      return { account: a, balanceCents: -d, creditAvailableCents: disp };
    }
    return { account: a, balanceCents: ef[a.id] || 0, creditAvailableCents: null };
  });

  return { accounts: perAccount, efectivoTotal, creditoDisponibleTotal, ef, debt };
}

function monthKey(dateStr) {
  const d = new Date(dateStr);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

// --- CSV helpers ---
function buildCSV(txs) {
  const header = "id,type,date,amountCents,accountFromId,accountToId,categoryId,paymentMethod,note";
  const rows = txs.map((t) => [
    t.id,
    t.type,
    t.date,
    t.amountCents,
    t.accountFromId || "",
    t.accountToId || "",
    t.categoryId || "",
    t.paymentMethod || "",
    (t.note || "").replace(/,/g, ";"),
  ].join(","));
  return [header, ...rows].join("\n");
}

function parseCSV(text) {
  const lines = text.split(/\r?\n/).filter(Boolean);
  if (lines.length <= 1) return [];
  return lines.slice(1).map((line) => {
    const [id, type, date, amountCents, accountFromId, accountToId, categoryId, paymentMethod, note] = line.split(",");
    return {
      id: id || crypto.randomUUID(),
      type,
      date,
      amountCents: Number(amountCents || 0),
      accountFromId: accountFromId || null,
      accountToId: accountToId || null,
      categoryId: categoryId || null,
      paymentMethod: paymentMethod || null,
      note: note || null,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
  });
}

// --- Helpers UI ---
const cardClass = "rounded-2xl border border-white/40 bg-white/70 backdrop-blur shadow-sm hover:shadow-md transition-shadow";
const chipClass = "text-[10px] px-2 py-0.5 rounded-full bg-slate-100 border border-slate-200";

function ProgressBar({ value = 0 }) {
  const v = Math.max(0, Math.min(100, value));
  return (
    <div className="w-full h-2 rounded-full bg-slate-200 overflow-hidden">
      <div className="h-full bg-slate-900" style={{ width: `${v}%` }} />
    </div>
  );
}

const dotPatternStyle = {
  backgroundImage: 'radial-gradient(#1f2937 1px, transparent 1px)',
  backgroundSize: '16px 16px'
};

// --- Componente principal ---
export default function App() {
  const [accounts, setAccounts] = useLocalState(LS_KEYS.ACCOUNTS, defaultAccounts);
  const [categories, setCategories] = useLocalState(LS_KEYS.CATEGORIES, defaultCategories);
  const [txs, setTxs] = useLocalState(LS_KEYS.TXS, []);
  const [tab, setTab] = useState("dashboard");

  const summary = useMemo(() => computeBalances(accounts, txs), [accounts, txs]);

  // --- Formulario de transacción ---
  const [form, setForm] = useState({
    type: "GASTO", // INGRESO | GASTO | TRANSFERENCIA
    date: todayStr(),
    amount: "",
    accountFromId: "visa",
    accountToId: "ahorros",
    paymentMethod: "VISA",
    categoryId: "comida",
    note: "",
  });

  useEffect(() => {
    // Auto-ajustar cuenta según medio en GASTO
    if (form.type === "GASTO") {
      const pm = PAYMENT_METHODS.find((m) => m.id === form.paymentMethod);
      if (pm) {
        const target = accounts.find((a) => a.name.includes(pm.accountName));
        if (target && form.accountFromId !== target.id) {
          setForm((f) => ({ ...f, accountFromId: target.id }));
        }
      }
    }
  }, [form.paymentMethod, form.type, accounts]);

  const resetForm = () => setForm({
    type: "GASTO",
    date: todayStr(),
    amount: "",
    accountFromId: "visa",
    accountToId: "ahorros",
    paymentMethod: "VISA",
    categoryId: "comida",
    note: "",
  });

  const addTx = () => {
    const amountCents = toCents(form.amount);
    if (amountCents <= 0) return alert("Monto inválido");

    const base = {
      id: crypto.randomUUID(),
      amountCents,
      date: form.date,
      note: form.note?.trim() || null,
      createdAt: Date.now(),
      updatedAt: Date.now(),
      categoryId: null,
      paymentMethod: null,
      accountFromId: null,
      accountToId: null,
    };

    let tx;
    if (form.type === "INGRESO") {
      tx = { ...base, type: "INGRESO", accountToId: form.accountToId, categoryId: form.categoryId };
    } else if (form.type === "GASTO") {
      tx = {
        ...base,
        type: "GASTO",
        accountFromId: form.accountFromId,
        categoryId: form.categoryId,
        paymentMethod: form.paymentMethod,
      };
    } else {
      if (form.accountFromId === form.accountToId) return alert("Cuentas deben ser diferentes");
      tx = { ...base, type: "TRANSFERENCIA", accountFromId: form.accountFromId, accountToId: form.accountToId };
    }
    setTxs((prev) => [tx, ...prev]);
    resetForm();
    setTab("dashboard");
  };

  const deleteTx = (id) => setTxs((prev) => prev.filter((t) => t.id !== id));

  const loadDemoData = () => {
    // Inserta 3 transacciones de ejemplo
    const demo = [
      { id: crypto.randomUUID(), type: "INGRESO", amountCents: 20000000, date: todayStr(), accountToId: "ahorros", categoryId: null, note: "Ingreso ejemplo" },
      { id: crypto.randomUUID(), type: "GASTO", amountCents: 6380000, date: todayStr(), accountFromId: "visa", categoryId: "comida", paymentMethod: "VISA", note: "Comida" },
      { id: crypto.randomUUID(), type: "TRANSFERENCIA", amountCents: 15000000, date: todayStr(), accountFromId: "ahorros", accountToId: "visa", note: "Pago a tarjeta" },
    ];
    setTxs((prev) => [...demo, ...prev]);
    setTab("dashboard");
  };

  // Reportes: gastos por categoría del mes actual
  const gastosPorCategoria = useMemo(() => {
    const now = new Date();
    const key = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
    const map = {};
    txs.filter((t) => t.type === "GASTO" && monthKey(t.date) === key).forEach((t) => {
      const cat = categories.find((c) => c.id === t.categoryId)?.name || "Sin categoría";
      map[cat] = (map[cat] || 0) + t.amountCents;
    });
    return Object.entries(map).map(([name, value]) => ({ name, value }));
  }, [txs, categories]);

  // Barras: gastos por mes (últimos 6)
  const gastosPorMes = useMemo(() => {
    const map = {};
    txs.filter((t) => t.type === "GASTO").forEach((t) => {
      const k = monthKey(t.date);
      map[k] = (map[k] || 0) + t.amountCents;
    });
    const keys = Object.keys(map).sort().slice(-6);
    return keys.map((k) => ({ name: k, value: map[k] }));
  }, [txs]);

  // Export/Import CSV sencillo (usa helpers)
  const exportCSV = () => {
    const csv = buildCSV(txs);
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "gastosapp-transacciones.csv";
    a.click();
    URL.revokeObjectURL(url);
  };

  const importCSV = (file) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      const text = e.target.result;
      const parsed = parseCSV(text);
      setTxs((prev) => [...parsed, ...prev]);
    };
    reader.readAsText(file);
  };

  return (
    <div className="min-h-screen relative">
      {/* Fondo con gradiente y patrón sutil */}
      <div className="absolute inset-0 -z-10 bg-gradient-to-br from-slate-50 via-white to-slate-100" />
      <div className="absolute inset-0 -z-10 opacity-10" style={dotPatternStyle} />

      <header className="sticky top-0 z-10 border-b border-slate-200/60 bg-white/75 backdrop-blur">
        <div className="max-w-6xl mx-auto px-4 py-3 flex items-center gap-3">
          <div className="p-2 rounded-xl bg-slate-900 text-white"><Wallet className="w-5 h-5" /></div>
          <h1 className="text-xl font-semibold bg-clip-text text-transparent bg-gradient-to-r from-slate-900 to-slate-600">Gastos App — Demo</h1>
          <nav className="ml-auto flex items-center gap-2 p-1 rounded-xl border border-slate-200 bg-white/70">
            {[
              { id: "dashboard", label: "Dashboard" },
              { id: "agregar", label: "Agregar" },
              { id: "historial", label: "Historial & Reportes" },
              { id: "tests", label: "Pruebas" },
            ].map((t) => (
              <button
                key={t.id}
                onClick={() => setTab(t.id)}
                className={`px-3 py-1.5 rounded-lg text-sm transition ${tab === t.id ? "bg-slate-900 text-white" : "hover:bg-slate-100"}`}
              >
                {t.label}
              </button>
            ))}
          </nav>
        </div>
      </header>

      <main className="max-w-6xl mx-auto px-4 py-6 space-y-6">
        {tab === "dashboard" && (
          <Dashboard summary={summary} onLoadDemo={loadDemoData} />
        )}

        {tab === "agregar" && (
          <section className="grid md:grid-cols-2 gap-6">
            <TxForm
              form={form}
              setForm={setForm}
              accounts={accounts}
              categories={categories}
              addTx={addTx}
            />
            <QuickHelp />
          </section>
        )}

        {tab === "historial" && (
          <HistoryAndReports
            txs={txs}
            categories={categories}
            accounts={accounts}
            deleteTx={deleteTx}
            gastosPorCategoria={gastosPorCategoria}
            gastosPorMes={gastosPorMes}
            exportCSV={exportCSV}
            importCSV={importCSV}
          />
        )}

        {tab === "tests" && (
          <TestsPanel />
        )}
      </main>

      {/* Botón flotante para agregar rápido */}
      <button onClick={() => setTab("agregar")} className="fixed bottom-6 right-6 shadow-lg hover:shadow-xl transition rounded-full bg-slate-900 text-white p-4">
        <Plus className="w-5 h-5" />
      </button>

      <footer className="max-w-6xl mx-auto px-4 py-6 text-xs text-slate-500">
        <p>
          * Demo web con almacenamiento local. En la app Android real, los cálculos y reglas serán los mismos (Room + MVVM).
        </p>
      </footer>
    </div>
  );
}

function Dashboard({ summary, onLoadDemo }) {
  const { accounts, efectivoTotal, creditoDisponibleTotal } = summary;
  return (
    <section className="space-y-6">
      <div className="grid md:grid-cols-3 gap-4">
        <SummaryCard title="Efectivo total" value={fmtCOP(efectivoTotal)} icon={<Wallet className="w-5 h-5" />} />
        <SummaryCard title="Crédito disponible" value={fmtCOP(creditoDisponibleTotal)} icon={<CreditCard className="w-5 h-5" />} />
        <button onClick={onLoadDemo} className={`${cardClass} p-4 text-left flex items-center gap-3`}>
          <div className="p-2 rounded-xl bg-slate-900 text-white"><RefreshCcw className="w-4 h-4" /></div>
          <div>
            <div className="text-sm font-medium">Cargar datos de ejemplo</div>
            <div className="text-xs text-slate-600">3 transacciones para probar rápidamente</div>
          </div>
        </button>
      </div>

      <div className="grid md:grid-cols-3 gap-4">
        {accounts.map(({ account, balanceCents, creditAvailableCents }) => (
          <div key={account.id} className={`${cardClass} p-4`}>
            <div className="flex items-center justify-between">
              <div className="font-medium">{account.name}</div>
              <span className={chipClass}>{account.type === ACCOUNT_TYPES.CASH ? "EFECTIVO" : "CRÉDITO"}</span>
            </div>
            <div className="mt-2 text-2xl font-semibold">{fmtCOP(balanceCents)}</div>
            {account.type === ACCOUNT_TYPES.CREDIT && (
              <div className="mt-3 space-y-1">
                <div className="text-xs text-slate-600">Disponible: <strong>{fmtCOP(creditAvailableCents)}</strong> / Cupo {fmtCOP(account.creditLimitCents || 0)}</div>
                <ProgressBar value={Math.round(((account.creditLimitCents || 0) - (creditAvailableCents || 0)) / (account.creditLimitCents || 1) * 100)} />
              </div>
            )}
          </div>
        ))}
      </div>
    </section>
  );
}

function SummaryCard({ title, value, icon }) {
  return (
    <div className={`${cardClass} p-4`}>
      <div className="flex items-center gap-2 text-slate-600 text-sm">{icon}{title}</div>
      <div className="mt-2 text-2xl font-semibold">{value}</div>
    </div>
  );
}

function Field({ label, children }) {
  return (
    <div>
      <label className="text-sm text-slate-600">{label}</label>
      <div className="mt-1">{children}</div>
    </div>
  );
}

function Input(props) {
  return <input {...props} className={`w-full rounded-xl border border-slate-300/80 bg-white px-3 py-2 outline-none focus:ring-2 focus:ring-slate-900/10 ${props.className || ""}`} />;
}

function Select({ children, ...props }) {
  return <select {...props} className={`w-full rounded-xl border border-slate-300/80 bg-white px-3 py-2 outline-none focus:ring-2 focus:ring-slate-900/10 ${props.className || ""}`}>{children}</select>;
}

function Segmented({ value, onChange, options }) {
  return (
    <div className="inline-flex p-1 rounded-xl border border-slate-200 bg-white/70">
      {options.map((o) => (
        <button key={o.id} onClick={() => onChange(o.id)} className={`px-3 py-1.5 rounded-lg text-sm transition ${value === o.id ? "bg-slate-900 text-white" : "hover:bg-slate-100"}`}>{o.label}</button>
      ))}
    </div>
  );
}

function TxForm({ form, setForm, accounts, categories, addTx }) {
  const onChange = (k, v) => setForm((f) => ({ ...f, [k]: v }));
  const cashAccounts = accounts.filter((a) => a.type === ACCOUNT_TYPES.CASH);
  const creditAccounts = accounts.filter((a) => a.type === ACCOUNT_TYPES.CREDIT);

  return (
    <div className={`${cardClass} p-5 space-y-5`}>
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2 text-slate-700">
          <Plus className="w-5 h-5" />
          <h2 className="text-lg font-semibold">Nueva transacción</h2>
        </div>
        <Segmented
          value={form.type}
          onChange={(id) => onChange("type", id)}
          options={[{ id: "INGRESO", label: "Ingreso" }, { id: "GASTO", label: "Gasto" }, { id: "TRANSFERENCIA", label: "Transferencia" }]}
        />
      </div>

      <div className="grid md:grid-cols-2 gap-4">
        <Field label="Fecha">
          <Input type="date" value={form.date} onChange={(e) => onChange("date", e.target.value)} />
        </Field>
        <Field label="Monto (COP)">
          <div className="relative">
            <span className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400">$</span>
            <Input type="text" placeholder="63.800" value={form.amount} onChange={(e) => onChange("amount", e.target.value)} className="pl-7" />
          </div>
        </Field>
      </div>

      {form.type === "INGRESO" && (
        <div className="grid md:grid-cols-2 gap-4">
          <Field label="Cuenta destino">
            <Select value={form.accountToId} onChange={(e) => onChange("accountToId", e.target.value)}>
              {cashAccounts.map((a) => (
                <option key={a.id} value={a.id}>{a.name}</option>
              ))}
            </Select>
          </Field>
          <Field label="Categoría (opcional)">
            <Select value={form.categoryId} onChange={(e) => onChange("categoryId", e.target.value)}>
              <option value="">—</option>
              {categories.map((c) => (<option key={c.id} value={c.id}>{c.name}</option>))}
            </Select>
          </Field>
        </div>
      )}

      {form.type === "GASTO" && (
        <>
          <div className="grid md:grid-cols-2 gap-4">
            <Field label="Medio de pago">
              <Select value={form.paymentMethod} onChange={(e) => onChange("paymentMethod", e.target.value)}>
                {PAYMENT_METHODS.map((m) => (<option key={m.id} value={m.id}>{m.label}</option>))}
              </Select>
            </Field>
            <Field label="Cuenta origen">
              <Select value={form.accountFromId} onChange={(e) => onChange("accountFromId", e.target.value)}>
                {[...creditAccounts, ...cashAccounts].map((a) => (<option key={a.id} value={a.id}>{a.name}</option>))}
              </Select>
            </Field>
          </div>
          <Field label="Categoría">
            <Select value={form.categoryId} onChange={(e) => onChange("categoryId", e.target.value)}>
              {categories.map((c) => (<option key={c.id} value={c.id}>{c.name}</option>))}
            </Select>
          </Field>
        </>
      )}

      {form.type === "TRANSFERENCIA" && (
        <div className="grid md:grid-cols-2 gap-4">
          <Field label="Cuenta origen">
            <Select value={form.accountFromId} onChange={(e) => onChange("accountFromId", e.target.value)}>
              {[...creditAccounts, ...cashAccounts].map((a) => (<option key={a.id} value={a.id}>{a.name}</option>))}
            </Select>
          </Field>
          <Field label="Cuenta destino">
            <Select value={form.accountToId} onChange={(e) => onChange("accountToId", e.target.value)}>
              {[...creditAccounts, ...cashAccounts].map((a) => (<option key={a.id} value={a.id}>{a.name}</option>))}
            </Select>
          </Field>
        </div>
      )}

      <Field label="Nota">
        <Input type="text" placeholder="Descripción opcional" value={form.note} onChange={(e) => onChange("note", e.target.value)} />
      </Field>

      <div className="pt-2">
        <button onClick={addTx} className="inline-flex items-center gap-2 bg-slate-900 text-white px-4 py-2 rounded-xl hover:bg-slate-800 shadow">
          <Plus className="w-4 h-4" /> Guardar
        </button>
      </div>
    </div>
  );
}

function QuickHelp() {
  return (
    <div className={`${cardClass} p-5`}>
      <h3 className="text-lg font-semibold mb-2 flex items-center gap-2"><BarChart2 className="w-5 h-5"/> ¿Cómo funciona?</h3>
      <ol className="list-decimal ml-5 text-sm space-y-2 text-slate-700">
        <li>Elige el tipo: <strong>Ingreso</strong>, <strong>Gasto</strong> o <strong>Transferencia</strong>.</li>
        <li>Los <strong>Gastos</strong> con tarjeta o rotativo suman a la <em>deuda</em>; con cuentas de efectivo restan al saldo.</li>
        <li>Un <strong>pago a tarjeta</strong> es una <em>Transferencia</em> desde Ahorros/Nequi/etc. hacia la tarjeta.</li>
        <li>Ve al <strong>Dashboard</strong> para ver saldos y crédito disponible.</li>
        <li>En <strong>Historial & Reportes</strong> puedes borrar, exportar CSV o importar.</li>
      </ol>
      <p className="text-xs text-slate-500 mt-3">Tip: usa “Cargar datos de ejemplo” en el Dashboard para ver un flujo real.</p>
    </div>
  );
}

function HistoryAndReports({ txs, categories, accounts, deleteTx, gastosPorCategoria, gastosPorMes, exportCSV, importCSV }) {
  const [search, setSearch] = useState("");

  const filtered = useMemo(() => {
    const q = search.toLowerCase();
    return txs.filter((t) => {
      const cat = categories.find((c) => c.id === t.categoryId)?.name || "";
      const accFrom = accounts.find((a) => a.id === t.accountFromId)?.name || "";
      const accTo = accounts.find((a) => a.id === t.accountToId)?.name || "";
      const s = [t.type, t.date, cat, accFrom, accTo, t.note || ""].join(" ").toLowerCase();
      return s.includes(q);
    });
  }, [txs, search, categories, accounts]);

  return (
    <section className="space-y-6">
      <div className={`${cardClass} p-4`}>
        <div className="flex items-center gap-2">
          <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Buscar..." />
          <button onClick={exportCSV} className="inline-flex items-center gap-2 px-3 py-2 rounded-xl border border-slate-300 bg-white/80 hover:bg-white shadow-sm"><Download className="w-4 h-4"/>Exportar</button>
          <label className="inline-flex items-center gap-2 px-3 py-2 rounded-xl border border-slate-300 bg-white/80 hover:bg-white shadow-sm cursor-pointer">
            <Upload className="w-4 h-4"/>Importar
            <input type="file" accept=".csv" className="hidden" onChange={(e) => e.target.files?.[0] && importCSV(e.target.files[0])} />
          </label>
        </div>

        <div className="mt-4 overflow-x-auto">
          <table className="min-w-full text-sm">
            <thead className="sticky top-14 bg-white/80 backdrop-blur">
              <tr className="text-left text-slate-600">
                <th className="py-2">Fecha</th>
                <th>Tipo</th>
                <th>Monto</th>
                <th>Cuenta</th>
                <th>Categoría</th>
                <th>Nota</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((t) => (
                <tr key={t.id} className="border-t hover:bg-slate-50/80">
                  <td className="py-2 whitespace-nowrap">{t.date}</td>
                  <td className="whitespace-nowrap">{t.type}</td>
                  <td className="whitespace-nowrap">{fmtCOP(t.amountCents)}</td>
                  <td className="whitespace-nowrap">
                    {t.type === "INGRESO" && (accounts.find((a) => a.id === t.accountToId)?.name || "—")}
                    {t.type === "GASTO" && (accounts.find((a) => a.id === t.accountFromId)?.name || "—")}
                    {t.type === "TRANSFERENCIA" && `${accounts.find((a) => a.id === t.accountFromId)?.name || "—"} → ${accounts.find((a) => a.id === t.accountToId)?.name || "—"}`}
                  </td>
                  <td className="whitespace-nowrap">{categories.find((c) => c.id === t.categoryId)?.name || "—"}</td>
                  <td className="max-w-[280px] truncate" title={t.note || ""}>{t.note || ""}</td>
                  <td className="text-right">
                    <button onClick={() => deleteTx(t.id)} className="inline-flex items-center gap-1 text-red-600 hover:bg-red-50 px-2 py-1 rounded-lg">
                      <Trash2 className="w-4 h-4"/> Borrar
                    </button>
                  </td>
                </tr>
              ))}
              {filtered.length === 0 && (
                <tr><td colSpan={7} className="text-center text-slate-500 py-6">Sin transacciones</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      <div className="grid md:grid-cols-2 gap-6">
        <div className={`${cardClass} p-4`}>
          <h4 className="font-medium mb-2">Gastos por categoría (mes actual)</h4>
          <div className="h-64">
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie dataKey="value" data={gastosPorCategoria} label={(e) => e.name}>
                  {gastosPorCategoria.map((_, i) => (<Cell key={i} />))}
                </Pie>
                <Tooltip formatter={(v) => fmtCOP(v)} />
                <Legend />
              </PieChart>
            </ResponsiveContainer>
          </div>
        </div>
        <div className={`${cardClass} p-4`}>
          <h4 className="font-medium mb-2">Gastos por mes</h4>
          <div className="h-64">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={gastosPorMes}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="name" />
                <YAxis tickFormatter={(v) => COP.format(v / 100)} />
                <Tooltip formatter={(v) => fmtCOP(v)} />
                <Legend />
                <Bar dataKey="value" name="Gastos" />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
      </div>
    </section>
  );
}

// --- Pruebas (self-tests) ---
function TestsPanel() {
  const results = useMemo(() => runSelfTests(), []);
  const passed = results.every((r) => r.pass);
  return (
    <section className="space-y-4">
      <div className={`${cardClass} p-4`}>
        <h3 className="text-lg font-semibold">Pruebas automáticas</h3>
        <p className="text-sm text-slate-600">Estas pruebas validan cálculos de saldos y el manejo de CSV.</p>
      </div>
      <div className="grid md:grid-cols-2 gap-4">
        {results.map((r, i) => (
          <div key={i} className={`${cardClass} p-4 flex items-start gap-3`}>
            {r.pass ? <CheckCircle2 className="w-5 h-5 text-green-600"/> : <XCircle className="w-5 h-5 text-red-600"/>}
            <div>
              <div className="font-medium">{r.name}</div>
              <div className="text-sm text-slate-600 whitespace-pre-wrap">{r.details || "OK"}</div>
            </div>
          </div>
        ))}
      </div>
      <div className={`${cardClass} p-4`}>Resultado general: {passed ? "✅ Todas las pruebas pasaron" : "❌ Algunas pruebas fallaron"}</div>
    </section>
  );
}

function runSelfTests() {
  const results = [];
  const assert = (name, cond, details = "") => results.push({ name, pass: !!cond, details: cond ? "" : details });

  // Caso A: CSV genera y parsea correctamente 2 filas
  const txA = [
    { id: "1", type: "INGRESO", date: "2025-01-01", amountCents: 1000, accountToId: "ahorros" },
    { id: "2", type: "GASTO", date: "2025-01-02", amountCents: 500, accountFromId: "ahorros", categoryId: "comida", paymentMethod: "CUENTA_AHORROS" },
  ];
  const csvA = buildCSV(txA);
  const linesA = csvA.split(/\r?\n/);
  assert("CSV contiene encabezado + 2 filas", linesA.length === 3, `Líneas=${linesA.length}\nCSV=\n${csvA}`);
  const parsedA = parseCSV(csvA);
  assert("parseCSV devuelve 2 objetos", parsedA.length === 2, `len=${parsedA.length}`);

  // Caso B: computeBalances con efectivo + crédito + pago a tarjeta
  const accB = [
    { id: "ah", name: "Ahorros", type: ACCOUNT_TYPES.CASH, initialBalanceCents: 0 },
    { id: "vi", name: "Visa", type: ACCOUNT_TYPES.CREDIT, creditLimitCents: 100000, initialDebtCents: 0 },
  ];
  const txB = [
    { type: "INGRESO", amountCents: 50000, date: "2025-01-01", accountToId: "ah" },
    { type: "GASTO", amountCents: 20000, date: "2025-01-02", accountFromId: "ah", paymentMethod: "CUENTA_AHORROS", categoryId: "comida" },
    { type: "GASTO", amountCents: 30000, date: "2025-01-03", accountFromId: "vi", paymentMethod: "VISA", categoryId: "servicios" },
    { type: "TRANSFERENCIA", amountCents: 30000, date: "2025-01-04", accountFromId: "ah", accountToId: "vi" },
  ];
  const sumB = computeBalances(accB, txB);
  const ahSaldo = sumB.accounts.find((x) => x.account.id === "ah").balanceCents;
  const visaDeudaNeg = sumB.accounts.find((x) => x.account.id === "vi").balanceCents; // negativo = deuda
  assert("Ahorros termina en 0", ahSaldo === 0, `saldo=${ahSaldo}`);
  assert("Visa termina en 0 deuda", visaDeudaNeg === 0, `visa=${visaDeudaNeg}`);

  // Caso C: transferencia efectivo→efectivo conserva total
  const accC = [
    { id: "a", name: "Ahorros", type: ACCOUNT_TYPES.CASH, initialBalanceCents: 10000 },
    { id: "n", name: "Nequi", type: ACCOUNT_TYPES.CASH, initialBalanceCents: 0 },
  ];
  const txC = [ { type: "TRANSFERENCIA", amountCents: 7000, date: "2025-02-02", accountFromId: "a", accountToId: "n" } ];
  const sumC = computeBalances(accC, txC);
  const totalC = sumC.efectivoTotal;
  const aSaldo = sumC.accounts.find((x) => x.account.id === "a").balanceCents;
  const nSaldo = sumC.accounts.find((x) => x.account.id === "n").balanceCents;
  assert("Efectivo total se conserva", totalC === 10000, `total=${totalC}`);
  assert("Saldos movidos correctamente", aSaldo === 3000 && nSaldo === 7000, `a=${aSaldo}, n=${nSaldo}`);

  return results;
}
