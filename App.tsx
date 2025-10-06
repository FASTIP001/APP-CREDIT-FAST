import React, { useEffect, useMemo, useState } from "react";
import { jsPDF } from "jspdf";
import * as XLSX from "xlsx";

// ===================== Utils =====================
function formatXAF(n) {
  try { return new Intl.NumberFormat("fr-FR", { style: "currency", currency: "XAF" }).format(n || 0); }
  catch { return String(n || 0) + " FCFA"; }
}
function splitIntoTwelve(amount) {
  const a = Math.max(0, Math.floor(Number(amount) || 0));
  const base = Math.floor(a / 12);
  const r = a - base * 12;
  return Array.from({ length: 12 }, (_, i) => (i < r ? base + 1 : base));
}
function addMonths(dateStr, m) {
  const d = new Date(dateStr);
  const nd = new Date(d.getFullYear(), d.getMonth() + m, d.getDate());
  return nd.toISOString().slice(0, 10);
}
function sumPaid(schedule) { return schedule.reduce((s, it) => s + Math.min(it.paid || 0, it.amount), 0); }
function todayYMD() { return new Date().toISOString().slice(0, 10); }
function startOfWeekYMD() { const d=new Date(); const g=d.getDay()||7; d.setHours(0,0,0,0); d.setDate(d.getDate()-(g-1)); return d.toISOString().slice(0,10); }
function endOfWeekYMD() { const d=new Date(); const g=d.getDay()||7; d.setHours(0,0,0,0); d.setDate(d.getDate()+(7-g)); return d.toISOString().slice(0,10); }
function uid() { return Math.random().toString(36).slice(2) + Date.now().toString(36); }

// ===================== Storage =====================
const USERS_KEY = "app-credit-users";
const SESS_KEY = "app-credit-session";
const CONTRACTS_KEY = "app-credit-contracts";
const RECEIPTS_KEY = "app-credit-receipts"; // { [userId]: ReceiptEntry[] }

function loadUsers() { try { return JSON.parse(localStorage.getItem(USERS_KEY) || "[]"); } catch { return []; } }
function saveUsers(v) { localStorage.setItem(USERS_KEY, JSON.stringify(v)); }
function getUser(id) { return loadUsers().find(u => u.id === id) || null; }

function loadContracts() { try { return JSON.parse(localStorage.getItem(CONTRACTS_KEY) || "{}"); } catch { return {}; } }
function saveContracts(v) { localStorage.setItem(CONTRACTS_KEY, JSON.stringify(v)); }

function loadReceipts() { try { return JSON.parse(localStorage.getItem(RECEIPTS_KEY) || "{}"); } catch { return {}; } }
function saveReceipts(v) { localStorage.setItem(RECEIPTS_KEY, JSON.stringify(v)); }

function buildContract(amount, startDate) {
  const schedule = splitIntoTwelve(amount).map((amt, i) => ({ amount: amt, dueDate: addMonths(startDate, i), paid: 0, closed: false }));
  return { amount: Math.max(0, Math.floor(Number(amount) || 0)), startDate, schedule };
}

// ===================== Session =====================
function useSession() {
  const [session, setSession] = useState(() => {
    try { return JSON.parse(localStorage.getItem(SESS_KEY) || "null"); } catch { return null; }
  });
  function login(email, password) {
    const u = loadUsers().find(x => x.email === email && x.password === password);
    if (!u) throw new Error("Identifiants invalides");
    const s = { userId: u.id };
    localStorage.setItem(SESS_KEY, JSON.stringify(s));
    setSession(s);
  }
  function logout() { localStorage.removeItem(SESS_KEY); setSession(null); }
  return { session, login, logout };
}

// ===================== Exports / PDF =====================
function safeFileName(s) { return String(s || "client").replace(/\s+/g, "_"); }

function exportToCSV(contract, clientName) {
  const rows = [["Client", clientName],["Montant total", contract.amount],["Date de départ", contract.startDate],[],["#","Échéance","Montant","Payé","Reste","Clos?"]];
  contract.schedule.forEach((it, i) => rows.push([i+1, it.dueDate, it.amount, it.paid, Math.max(0, it.amount - (it.paid||0)), it.closed ? "Oui" : "Non"]));
  const csv = rows.map(r => r.map(v => '"' + String(v).replace(/"/g,'""') + '"').join(",")).join("\n");
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
  const a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = `echeancier_${safeFileName(clientName)}.csv`; a.click(); URL.revokeObjectURL(a.href);
}

function exportToXLSX(contract, clientName) {
  const data = contract.schedule.map((it,i)=>({"#":i+1,"Échéance":it.dueDate,"Montant":it.amount,"Payé":it.paid,"Reste":Math.max(0,it.amount-(it.paid||0)),"Clos":it.closed?"Oui":"Non"}));
  const ws = XLSX.utils.json_to_sheet(data); const wb = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(wb, ws, "Échéancier"); XLSX.writeFile(wb, `echeancier_${safeFileName(clientName)}.xlsx`);
}

function exportToPDF(contract, clientName) {
  const doc = new jsPDF(); const top = 14;
  doc.text("FAST AND SURE TRAVEL SARL", 14, top);
  doc.text("Échéancier – " + clientName, 14, top + 8);
  doc.text("Montant total: " + formatXAF(contract.amount), 14, top + 16);
  doc.text("Date de départ: " + contract.startDate, 14, top + 24);
  let y = top + 36;
  doc.text("# | Échéance | Montant | Payé | Reste | Clos", 14, y); y += 6;
  contract.schedule.forEach((it, i) => { const row = [i+1, it.dueDate, it.amount, it.paid, Math.max(0, it.amount - (it.paid||0)), it.closed?"Oui":"Non"].join("  |  "); doc.text(row, 14, y); y += 6; if (y > 280) { doc.addPage(); y = 14; } });
  const filename = `echeancier_${safeFileName(clientName)}.pdf`;
  try {
    // Generate a Blob URL, open it in a new tab (preview), and also trigger a download as fallback
    const blob = doc.output('blob');
    const url = URL.createObjectURL(blob);
    // Open in a new tab/window for preview (some sandboxes block direct save)
    window.open(url, '_blank');
    // Also trigger download silently
    const a = document.createElement('a'); a.href = url; a.download = filename; document.body.appendChild(a); a.click(); a.remove();
    // Revoke URL a bit later to allow the new tab to load
    setTimeout(() => URL.revokeObjectURL(url), 10000);
  } catch {
    // Fallback to built-in save
    doc.save(filename);
  }
}

function receiptPDF({ clientName, contract, index, paidDelta }) {
  const it = contract.schedule[index]; const now = new Date(); const doc = new jsPDF(); let y = 14;
  doc.text("FAST AND SURE TRAVEL SARL", 14, y); y += 8;
  doc.text("Reçu de paiement – Échéance", 14, y); y += 8;
  doc.text("Client : " + clientName, 14, y); y += 6;
  doc.text("Date reçu : " + now.toISOString().slice(0,10) + " " + now.toTimeString().slice(0,8), 14, y); y += 6;
  doc.text("Échéance : " + (index + 1) + " (" + it.dueDate + ")", 14, y); y += 6;
  doc.text("Montant de l'échéance : " + formatXAF(it.amount), 14, y); y += 6;
  doc.text("Montant payé (opération) : " + formatXAF(paidDelta), 14, y); y += 6;
  doc.text("Total payé à ce jour : " + formatXAF(Math.min(it.paid, it.amount)), 14, y); y += 6;
  doc.text("Reste sur cette échéance : " + formatXAF(Math.max(0, it.amount - it.paid)), 14, y); y += 10;
  doc.text("Signature et cachet :", 14, y); y += 20;
  doc.text("Merci pour votre paiement.", 14, y);
  const filename = `recu_${safeFileName(clientName)}_echeance${index + 1}_${now.getTime()}.pdf`;
  try {
    const blob = doc.output('blob');
    const url = URL.createObjectURL(blob);
    window.open(url, '_blank');
    const a = document.createElement('a'); a.href = url; a.download = filename; document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 10000);
  } catch {
    doc.save(filename);
  }
}

// === PDF open/download helpers + receiptOpen/receiptDownload ===
function pdfOpen(doc) {
  const blob = doc.output('blob');
  const url = URL.createObjectURL(blob);
  window.open(url, '_blank');
  setTimeout(() => URL.revokeObjectURL(url), 20000);
}
function pdfDownload(doc, filename) {
  const blob = doc.output('blob');
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a'); a.href = url; a.download = filename; document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 20000);
}
function receiptOpen({ clientName, contract, index, paidDelta }) {
  const it = contract.schedule[index]; const now = new Date(); const doc = new jsPDF(); let y = 14;
  doc.text("FAST AND SURE TRAVEL SARL", 14, y); y += 8;
  doc.text("Reçu de paiement – Échéance", 14, y); y += 8;
  doc.text("Client : " + clientName, 14, y); y += 6;
  doc.text("Date reçu : " + now.toISOString().slice(0,10) + " " + now.toTimeString().slice(0,8), 14, y); y += 6;
  doc.text("Échéance : " + (index + 1) + " (" + it.dueDate + ")", 14, y); y += 6;
  doc.text("Montant de l'échéance : " + formatXAF(it.amount), 14, y); y += 6;
  doc.text("Montant payé (opération) : " + formatXAF(paidDelta), 14, y); y += 6;
  doc.text("Total payé à ce jour : " + formatXAF(Math.min(it.paid, it.amount)), 14, y); y += 6;
  doc.text("Reste sur cette échéance : " + formatXAF(Math.max(0, it.amount - it.paid)), 14, y); y += 10;
  doc.text("Signature et cachet :", 14, y); y += 20;
  doc.text("Merci pour votre paiement.", 14, y);
  try { pdfOpen(doc); } catch {}
}
function receiptDownload({ clientName, contract, index, paidDelta }) {
  const it = contract.schedule[index]; const now = new Date(); const doc = new jsPDF(); let y = 14;
  doc.text("FAST AND SURE TRAVEL SARL", 14, y); y += 8;
  doc.text("Reçu de paiement – Échéance", 14, y); y += 8;
  doc.text("Client : " + clientName, 14, y); y += 6;
  doc.text("Date reçu : " + now.toISOString().slice(0,10) + " " + now.toTimeString().slice(0,8), 14, y); y += 6;
  doc.text("Échéance : " + (index + 1) + " (" + it.dueDate + ")", 14, y); y += 6;
  doc.text("Montant de l'échéance : " + formatXAF(it.amount), 14, y); y += 6;
  doc.text("Montant payé (opération) : " + formatXAF(paidDelta), 14, y); y += 6;
  doc.text("Total payé à ce jour : " + formatXAF(Math.min(it.paid, it.amount)), 14, y); y += 6;
  doc.text("Reste sur cette échéance : " + formatXAF(Math.max(0, it.amount - it.paid)), 14, y); y += 10;
  doc.text("Signature et cachet :", 14, y); y += 20;
  doc.text("Merci pour votre paiement.", 14, y);
  const filename = `recu_${safeFileName(clientName)}_echeance${index + 1}_${now.getTime()}.pdf`;
  try { pdfDownload(doc, filename); } catch { doc.save(filename); }
}

// ===================== Auth =====================
function AuthGate({ onReady }) {
  const { session, login } = useSession();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    const users = loadUsers();
    if (users.length === 0) {
      const admin = { id: uid(), name: "Admin", email: "admin@local", password: "admin", role: "admin" };
      saveUsers([admin]);
    }
  }, []);

  useEffect(() => { if (session) onReady(session); }, [session, onReady]);

  function handleLogin(e) {
    e.preventDefault();
    try { login(email.trim(), password); setError(""); }
    catch (err) { setError(err.message || "Erreur de connexion"); }
  }

  return (
    <div className="min-h-screen bg-gray-50 flex items-start justify-center p-6">
      <div className="max-w-sm w-full bg-white rounded-2xl shadow p-6 mt-16">
        <h2 className="text-xl font-bold mb-4">Connexion</h2>
        {error && <div className="mb-3 text-red-600 text-sm">{error}</div>}
        <form onSubmit={handleLogin} className="space-y-3">
          <div>
            <label className="text-sm">Email</label>
            <input className="w-full border rounded-xl px-3 py-2" value={email} onChange={e => setEmail(e.target.value)} placeholder="admin@local" />
          </div>
          <div>
            <label className="text-sm">Mot de passe</label>
            <input type="password" className="w-full border rounded-xl px-3 py-2" value={password} onChange={e => setPassword(e.target.value)} placeholder="admin" />
          </div>
          <button className="w-full bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl py-2">Se connecter</button>
          <p className="text-xs text-gray-500">Par défaut : admin@local / admin</p>
        </form>
      </div>
    </div>
  );
}

// ===================== Admin UI =====================
function AdminDashboard({ user, onLogout }) {
  const [users, setUsers] = useState(loadUsers());
  const [contracts, setContracts] = useState(loadContracts());
  const [receipts, setReceipts] = useState(loadReceipts());
  const [message, setMessage] = useState("");
  const [form, setForm] = useState({ name: "", email: "", password: "", amount: 0, startDate: todayYMD() });
  const [selectedClientId, setSelectedClientId] = useState(null);
  const [filter, setFilter] = useState("all"); // all | overdue | thisweek
  const [payInputs, setPayInputs] = useState({});

  useEffect(() => { saveUsers(users); }, [users]);
  useEffect(() => { saveContracts(contracts); }, [contracts]);
  useEffect(() => { saveReceipts(receipts); }, [receipts]);

  const clients = users.filter(u => u.role === "client");
  const selectedContract = selectedClientId ? contracts[selectedClientId] : null;
  const selectedClient = selectedClientId ? users.find(u => u.id === selectedClientId) : null;

  const portfolioAmount = clients.reduce((s, u) => s + (contracts[u.id]?.amount || 0), 0);
  const portfolioPaid = clients.reduce((s, u) => s + (contracts[u.id] ? sumPaid(contracts[u.id].schedule) : 0), 0);
  const portfolioRemain = Math.max(0, portfolioAmount - portfolioPaid);

  function createClient(e) {
    e.preventDefault();
    const id = uid();
    const newUser = { id, name: form.name || "Client", email: form.email, password: form.password || "1234", role: "client" };
    const newContract = buildContract(form.amount, form.startDate);
    setUsers(prev => [...prev, newUser]);
    setContracts(prev => ({ ...prev, [id]: newContract }));
    setForm({ name: "", email: "", password: "", amount: 0, startDate: todayYMD() });
    setMessage("Client créé et échéancier généré."); setTimeout(() => setMessage(""), 1500);
  }

  function updateAmount(u, amount) {
    const c = contracts[u.id] || { amount: 0, startDate: todayYMD(), schedule: [] };
    const rebuilt = buildContract(amount, c.startDate);
    setContracts(prev => ({ ...prev, [u.id]: rebuilt }));
  }
  function updateStart(u, date) {
    const c = contracts[u.id] || { amount: 0, startDate: date, schedule: [] };
    const rebuilt = buildContract(c.amount, date);
    setContracts(prev => ({ ...prev, [u.id]: rebuilt }));
  }

  function addPayment(clientId, idx, value) {
    const v = Math.max(0, Math.floor(Number(value) || 0)); if (!v) return;
    setContracts(prev => {
      const copy = { ...prev }; const c = copy[clientId]; if (!c) return prev;
      const it = c.schedule[idx]; if (it.closed) return prev;
      const before = it.paid || 0; const afterPaid = Math.min(it.amount, before + v);
      const delta = afterPaid - before; const sch = c.schedule.slice();
      const newIt = { ...it, paid: afterPaid, closed: afterPaid >= it.amount ? true : it.closed };
      sch[idx] = newIt; copy[clientId] = { ...c, schedule: sch };
      if (delta > 0) {
        const cl = users.find(u => u.id === clientId);
        const entry = { id: uid(), ts: Date.now(), echeance: idx, dueDate: newIt.dueDate, paidDelta: delta, totalPaid: newIt.paid, remainAfter: Math.max(0, newIt.amount - newIt.paid) };
        setReceipts(prevR => { const map = { ...prevR }; map[clientId] = [ ...(map[clientId]||[]), entry ]; return map; });
        try { receiptPDF({ clientName: cl?.name || cl?.email || "Client", contract: copy[clientId], index: idx, paidDelta: delta }); } catch {}
      }
      return copy;
    });
  }
  function toggleFullPayment(clientId, idx) {
    setContracts(prev => {
      const copy = { ...prev }; const c = copy[clientId]; if (!c) return prev;
      const it = c.schedule[idx]; if (it.closed) return prev;
      const delta = it.amount - (it.paid || 0); if (delta <= 0) return prev;
      const sch = c.schedule.slice(); const newIt = { ...it, paid: it.amount, closed: true };
      sch[idx] = newIt; copy[clientId] = { ...c, schedule: sch };
      const cl = users.find(u => u.id === clientId);
      const entry = { id: uid(), ts: Date.now(), echeance: idx, dueDate: newIt.dueDate, paidDelta: delta, totalPaid: newIt.paid, remainAfter: Math.max(0, newIt.amount - newIt.paid) };
      setReceipts(prevR => { const map = { ...prevR }; map[clientId] = [ ...(map[clientId]||[]), entry ]; return map; });
      try { receiptPDF({ clientName: cl?.name || cl?.email || "Client", contract: copy[clientId], index: idx, paidDelta: delta }); } catch {}
      return copy;
    });
  }
  function lockUnlock(clientId, idx) {
    setContracts(prev => { const copy = { ...prev }; const c = copy[clientId]; if (!c) return prev; const it = c.schedule[idx]; const sch = c.schedule.slice(); sch[idx] = { ...it, closed: !it.closed }; copy[clientId] = { ...c, schedule: sch }; return copy; });
  }
  function exportContract(u, fmt) {
    const c = contracts[u.id]; if (!c) return;
    if (fmt === "xlsx") exportToXLSX(c, u.name || u.email);
    if (fmt === "csv") exportToCSV(c, u.name || u.email);
    if (fmt === "pdf") exportToPDF(c, u.name || u.email);
  }

  const filteredSchedule = useMemo(() => {
    if (!selectedContract) return [];
    const t = todayYMD(), sw = startOfWeekYMD(), ew = endOfWeekYMD();
    return selectedContract.schedule.filter(it => {
      const remain = Math.max(0, it.amount - (it.paid || 0));
      if (filter === "all") return true;
      if (filter === "overdue") return remain > 0 && it.dueDate < t;
      if (filter === "thisweek") return remain > 0 && it.dueDate >= sw && it.dueDate <= ew;
      return true;
    });
  }, [selectedContract, filter]);

  return (
    <div className="max-w-6xl mx-auto p-6">
      <header className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold">Admin – Validation des paiements</h1>
        <div className="flex items-center gap-3 text-sm">
          <span className="text-gray-600">{user.name} (admin)</span>
          <button onClick={onLogout} className="px-3 py-1.5 rounded-lg bg-gray-200 hover:bg-gray-300">Se déconnecter</button>
        </div>
      </header>

      <div className="grid md:grid-cols-3 gap-3 mb-6">
        <div className="bg-white rounded-2xl shadow p-4"><div className="text-xs text-gray-500">Portefeuille</div><div className="text-xl font-semibold">{formatXAF(portfolioAmount)}</div></div>
        <div className="bg-white rounded-2xl shadow p-4"><div className="text-xs text-gray-500">Total encaissé</div><div className="text-xl font-semibold">{formatXAF(portfolioPaid)}</div></div>
        <div className="bg-white rounded-2xl shadow p-4"><div className="text-xs text-gray-500">Reste à encaisser</div><div className="text-xl font-semibold">{formatXAF(portfolioRemain)}</div></div>
      </div>

      <div className="bg-white rounded-2xl shadow p-5 mb-6">
        <h2 className="font-semibold mb-3">Créer un compte client + échéancier</h2>
        {message && <div className="mb-3 text-green-700 text-sm">{message}</div>}
        <form onSubmit={createClient} className="grid md:grid-cols-6 gap-3">
          <input className="border rounded-xl px-3 py-2 md:col-span-2" placeholder="Nom" value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} />
          <input className="border rounded-xl px-3 py-2 md:col-span-2" placeholder="Email" value={form.email} onChange={e => setForm({ ...form, email: e.target.value })} />
          <input className="border rounded-xl px-3 py-2" placeholder="Mot de passe" value={form.password} onChange={e => setForm({ ...form, password: e.target.value })} />
          <input type="number" min={0} step={1} className="border rounded-xl px-3 py-2" placeholder="Montant (FCFA)" value={form.amount} onChange={e => setForm({ ...form, amount: e.target.value })} />
          <label className="text-sm text-gray-600 md:col-span-1">Départ</label>
          <input type="date" className="border rounded-xl px-3 py-2 md:col-span-2" value={form.startDate} onChange={e => setForm({ ...form, startDate: e.target.value })} />
          <div className="md:col-span-6 flex justify-end"><button className="bg-indigo-600 text-white rounded-xl px-4 py-2 hover:bg-indigo-700">Créer</button></div>
        </form>
      </div>

      <div className="bg-white rounded-2xl shadow p-5">
        <h2 className="font-semibold mb-3">Clients</h2>
        <div className="overflow-x-auto">
          <table className="min-w-full">
            <thead>
              <tr className="text-left text-xs uppercase text-gray-600">
                <th className="px-3 py-2">Nom</th>
                <th className="px-3 py-2">Email</th>
                <th className="px-3 py-2">Montant</th>
                <th className="px-3 py-2">Départ</th>
                <th className="px-3 py-2">Encaissé</th>
                <th className="px-3 py-2">Reste</th>
                <th className="px-3 py-2">Exports</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {clients.map(u => {
                const c = contracts[u.id];
                const paid = c ? sumPaid(c.schedule) : 0;
                const remain = c ? Math.max(0, c.amount - paid) : 0;
                return (
                  <tr key={u.id} className={selectedClientId === u.id ? "bg-indigo-50" : "bg-white"}>
                    <td className="px-3 py-2 font-medium cursor-pointer" onClick={() => setSelectedClientId(u.id)}>{u.name}</td>
                    <td className="px-3 py-2">{u.email}</td>
                    <td className="px-3 py-2"><input type="number" className="border rounded-lg px-2 py-1 w-40" value={c?.amount || 0} onChange={e => updateAmount(u, e.target.value)} /></td>
                    <td className="px-3 py-2"><input type="date" className="border rounded-lg px-2 py-1" value={c?.startDate || todayYMD()} onChange={e => updateStart(u, e.target.value)} /></td>
                    <td className="px-3 py-2">{formatXAF(paid)}</td>
                    <td className="px-3 py-2">{formatXAF(remain)}</td>
                    <td className="px-3 py-2 flex gap-2">
                      <button onClick={() => exportContract(u, "xlsx")} className="px-3 py-1.5 rounded-lg bg-gray-100 hover:bg-gray-200 text-sm">Excel</button>
                      <button onClick={() => exportContract(u, "pdf")} className="px-3 py-1.5 rounded-lg bg-gray-100 hover:bg-gray-200 text-sm">PDF</button>
                      <button onClick={() => exportContract(u, "csv")} className="px-3 py-1.5 rounded-lg bg-gray-100 hover:bg-gray-200 text-sm">CSV</button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {selectedContract ? (
        <div className="bg-white rounded-2xl shadow p-5 mt-6">
          <div className="flex items-center justify-between mb-3">
            <h3 className="font-semibold">Échéancier – {selectedClient ? selectedClient.name : "Client"}</h3>
            <div className="flex items-center gap-3 text-sm">
              <label className="text-gray-600">Filtre</label>
              <select className="border rounded-lg px-2 py-1" value={filter} onChange={e => setFilter(e.target.value)}>
                <option value="all">Tous</option>
                <option value="overdue">En retard</option>
                <option value="thisweek">Cette semaine</option>
              </select>
              <div className="text-gray-600">Reste: {formatXAF(Math.max(0, selectedContract.amount - sumPaid(selectedContract.schedule)))}</div>
            </div>
          </div>
          <div className="overflow-x-auto">
            <table className="min-w-full">
              <thead className="bg-gray-50">
                <tr>
                  <th className="text-left text-xs font-semibold text-gray-600 uppercase tracking-wider px-4 py-3">#</th>
                  <th className="text-left text-xs font-semibold text-gray-600 uppercase tracking-wider px-4 py-3">Échéance</th>
                  <th className="text-left text-xs font-semibold text-gray-600 uppercase tracking-wider px-4 py-3">Montant</th>
                  <th className="text-left text-xs font-semibold text-gray-600 uppercase tracking-wider px-4 py-3">Payé</th>
                  <th className="text-left text-xs font-semibold text-gray-600 uppercase tracking-wider px-4 py-3">Reste</th>
                  <th className="text-left text-xs font-semibold text-gray-600 uppercase tracking-wider px-4 py-3">Verrou</th>
                  <th className="text-left text-xs font-semibold text-gray-600 uppercase tracking-wider px-4 py-3">Actions (ADMIN)</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {filteredSchedule.map(itAll => {
                  const idx = selectedContract.schedule.indexOf(itAll);
                  const remain = Math.max(0, itAll.amount - (itAll.paid || 0));
                  const locked = !!itAll.closed;
                  return (
                    <tr key={idx} className={remain === 0 ? "bg-green-50" : "bg-white"}>
                      <td className="px-4 py-3 text-sm font-medium text-gray-800">{idx + 1}</td>
                      <td className="px-4 py-3 text-sm text-gray-700">{itAll.dueDate}</td>
                      <td className="px-4 py-3 text-sm font-semibold">{formatXAF(itAll.amount)}</td>
                      <td className="px-4 py-3 text-sm">{formatXAF(Math.min(itAll.paid || 0, itAll.amount))}</td>
                      <td className="px-4 py-3 text-sm">{formatXAF(remain)}</td>
                      <td className="px-4 py-3 text-sm">
                        <button onClick={() => lockUnlock(selectedClientId, idx)} className={`px-2 py-1 rounded-lg text-xs border ${locked ? "bg-red-50 border-red-300" : "bg-gray-50 border-gray-300"}`}>{locked ? "Déverrouiller" : "Verrouiller"}</button>
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-2">
                          <input type="number" min={0} step={1} placeholder="Montant" className="w-28 border rounded-lg px-2 py-1 text-sm" disabled={locked} value={payInputs[idx] || ""} onChange={e => setPayInputs(prev => ({ ...prev, [idx]: e.target.value }))} />
                          <button onClick={() => { addPayment(selectedClientId, idx, payInputs[idx] || 0); setPayInputs(prev => ({ ...prev, [idx]: "" })); }} disabled={locked} className={`px-3 py-1.5 rounded-lg text-sm border ${locked ? "bg-gray-100 text-gray-400 border-gray-200" : "bg-white hover:bg-gray-100"}`}>Valider</button>
                          <button onClick={() => toggleFullPayment(selectedClientId, idx)} disabled={locked || remain === 0} className={`px-3 py-1.5 rounded-lg text-sm border ${locked || remain === 0 ? "bg-gray-100 text-gray-400 border-gray-200" : "bg-white hover:bg-gray-100"}`}>Payer tout</button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {/* Historique des reçus */}
          <div className="bg-white rounded-2xl shadow p-5 mt-6">
            <div className="flex items-center justify-between mb-3">
              <h3 className="font-semibold">Reçus – {selectedClient ? selectedClient.name : "Client"}</h3>
              <div className="text-sm text-gray-600">{(receipts[selectedClientId]?.length||0)} reçu(x)</div>
            </div>
            <div className="overflow-x-auto">
              <table className="min-w-full">
                <thead className="bg-gray-50">
                  <tr>
                    <th className="text-left text-xs font-semibold text-gray-600 uppercase tracking-wider px-4 py-3">Date</th>
                    <th className="text-left text-xs font-semibold text-gray-600 uppercase tracking-wider px-4 py-3">Échéance</th>
                    <th className="text-left text-xs font-semibold text-gray-600 uppercase tracking-wider px-4 py-3">Montant payé</th>
                    <th className="text-left text-xs font-semibold text-gray-600 uppercase tracking-wider px-4 py-3">Reste échéance</th>
                    <th className="text-left text-xs font-semibold text-gray-600 uppercase tracking-wider px-4 py-3">Action</th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {([...(receipts[selectedClientId]||[])]).sort((a,b)=>b.ts-a.ts).map(r => (
                    <tr key={r.id}>
                      <td className="px-4 py-3 text-sm">{new Date(r.ts).toISOString().slice(0,19).replace('T',' ')}</td>
                      <td className="px-4 py-3 text-sm">#{r.echeance+1} ({r.dueDate})</td>
                      <td className="px-4 py-3 text-sm">{formatXAF(r.paidDelta)}</td>
                      <td className="px-4 py-3 text-sm">{formatXAF(r.remainAfter)}</td>
                      <td className="px-4 py-3 text-sm">
  <button className="px-3 py-1.5 rounded-lg text-sm border bg-white hover:bg-gray-100" onClick={()=>{ try { receiptOpen({ clientName: (selectedClient?.name || selectedClient?.email || "Client"), contract: contracts[selectedClientId], index: r.echeance, paidDelta: r.paidDelta }); } catch{} }}>Ouvrir</button>
  <button className="ml-2 px-3 py-1.5 rounded-lg text-sm border bg-white hover:bg-gray-100" onClick={()=>{ try { receiptDownload({ clientName: (selectedClient?.name || selectedClient?.email || "Client"), contract: contracts[selectedClientId], index: r.echeance, paidDelta: r.paidDelta }); } catch{} }}>Télécharger</button>
</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      ) : (
        <div className="bg-white rounded-2xl shadow p-5 mt-6 text-gray-600">Cliquez sur un client dans la liste ci-dessus pour afficher et gérer ses paiements.</div>
      )}
    </div>
  );
}

// ===================== Client UI =====================
function ClientDashboard({ user, onLogout }) {
  const [contracts, setContracts] = useState(loadContracts());
  const contract = contracts[user.id] || null;
  const [receipts] = useState(loadReceipts());
  useEffect(() => { saveContracts(contracts); }, [contracts]);

  if (!contract) {
    return (
      <div className="max-w-3xl mx-auto p-6">
        <header className="flex items-center justify-between mb-6">
          <h1 className="text-2xl font-bold">Mon échéancier</h1>
          <button onClick={onLogout} className="px-3 py-1.5 rounded-lg bg-gray-200 hover:bg-gray-300">Se déconnecter</button>
        </header>
        <div className="bg-yellow-50 border border-yellow-200 text-yellow-800 rounded-xl p-4">Aucun échéancier n'est encore associé à votre compte.</div>
      </div>
    );
  }

  const totalPaid = sumPaid(contract.schedule);
  const remaining = Math.max(0, contract.amount - totalPaid);
  const progress = contract.amount > 0 ? Math.round((totalPaid / contract.amount) * 100) : 0;

  return (
    <div className="max-w-4xl mx-auto p-6">
      <header className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold">Mon échéancier</h1>
        <div className="flex items-center gap-3 text-sm">
          <span className="text-gray-600">{user.name} (client)</span>
          <button onClick={onLogout} className="px-3 py-1.5 rounded-lg bg-gray-200 hover:bg-gray-300">Se déconnecter</button>
        </div>
      </header>

      <div className="bg-white rounded-2xl shadow p-5 mb-6">
        <div className="grid md:grid-cols-3 gap-3">
          <div className="bg-gray-50 rounded-xl p-3"><div className="text-xs text-gray-500">Montant total</div><div className="text-lg font-semibold">{formatXAF(contract.amount)}</div></div>
          <div className="bg-gray-50 rounded-xl p-3"><div className="text-xs text-gray-500">Départ</div><div className="text-lg font-semibold">{contract.startDate}</div></div>
          <div className="bg-gray-50 rounded-xl p-3"><div className="text-xs text-gray-500">Reste à payer</div><div className="text-lg font-semibold">{formatXAF(remaining)}</div></div>
        </div>
        <div className="mt-4">
          <div className="flex items-center justify-between mb-2 text-sm text-gray-600"><span>Progression {progress}%</span></div>
          <div className="w-full bg-gray-200 rounded-full h-2"><div className="h-2 rounded-full bg-indigo-600" style={{ width: progress + "%" }} /></div>
        </div>
      </div>

      <div className="bg-white rounded-2xl shadow overflow-hidden">
        <table className="min-w-full">
          <thead className="bg-gray-50">
            <tr>
              <th className="text-left text-xs font-semibold text-gray-600 uppercase tracking-wider px-4 py-3">#</th>
              <th className="text-left text-xs font-semibold text-gray-600 uppercase tracking-wider px-4 py-3">Échéance</th>
              <th className="text-left text-xs font-semibold text-gray-600 uppercase tracking-wider px-4 py-3">Montant</th>
              <th className="text-left text-xs font-semibold text-gray-600 uppercase tracking-wider px-4 py-3">Payé (validé admin)</th>
              <th className="text-left text-xs font-semibold text-gray-600 uppercase tracking-wider px-4 py-3">Reste</th>
              <th className="text-left text-xs font-semibold text-gray-600 uppercase tracking-wider px-4 py-3">Statut</th>
            </tr>
          </thead>
          <tbody className="divide-y">
            {contract.schedule.map((it, idx) => {
              const remain = Math.max(0, it.amount - (it.paid || 0));
              return (
                <tr key={idx} className={remain === 0 ? "bg-green-50" : "bg-white"}>
                  <td className="px-4 py-3 text-sm font-medium text-gray-800">{idx + 1}</td>
                  <td className="px-4 py-3 text-sm text-gray-700">{it.dueDate}</td>
                  <td className="px-4 py-3 text-sm font-semibold">{formatXAF(it.amount)}</td>
                  <td className="px-4 py-3 text-sm">{formatXAF(Math.min(it.paid || 0, it.amount))}</td>
                  <td className="px-4 py-3 text-sm">{formatXAF(remain)}</td>
                  <td className="px-4 py-3 text-sm">{it.closed ? "Clôturée" : "En cours"}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* Historique des reçus (client) */}
      <div className="bg-white rounded-2xl shadow p-5 mt-6">
        <div className="flex items-center justify-between mb-3">
          <h3 className="font-semibold">Mes reçus</h3>
          <div className="text-sm text-gray-600">{(receipts[user.id]?.length||0)} reçu(x)</div>
        </div>
        <div className="overflow-x-auto">
          <table className="min-w-full">
            <thead className="bg-gray-50">
              <tr>
                <th className="text-left text-xs font-semibold text-gray-600 uppercase tracking-wider px-4 py-3">Date</th>
                <th className="text-left text-xs font-semibold text-gray-600 uppercase tracking-wider px-4 py-3">Échéance</th>
                <th className="text-left text-xs font-semibold text-gray-600 uppercase tracking-wider px-4 py-3">Montant payé</th>
                <th className="text-left text-xs font-semibold text-gray-600 uppercase tracking-wider px-4 py-3">Reste échéance</th>
                <th className="text-left text-xs font-semibold text-gray-600 uppercase tracking-wider px-4 py-3">Action</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {([...(receipts[user.id]||[])]).sort((a,b)=>b.ts-a.ts).map(r => (
                <tr key={r.id}>
                  <td className="px-4 py-3 text-sm">{new Date(r.ts).toISOString().slice(0,19).replace('T',' ')}</td>
                  <td className="px-4 py-3 text-sm">#{r.echeance+1} ({r.dueDate})</td>
                  <td className="px-4 py-3 text-sm">{formatXAF(r.paidDelta)}</td>
                  <td className="px-4 py-3 text-sm">{formatXAF(r.remainAfter)}</td>
                  <td className="px-4 py-3 text-sm">
  <button className="px-3 py-1.5 rounded-lg text-sm border bg-white hover:bg-gray-100" onClick={()=>{ try { receiptOpen({ clientName: (selectedClient?.name || selectedClient?.email || "Client"), contract: contracts[selectedClientId], index: r.echeance, paidDelta: r.paidDelta }); } catch{} }}>Ouvrir</button>
  <button className="ml-2 px-3 py-1.5 rounded-lg text-sm border bg-white hover:bg-gray-100" onClick={()=>{ try { receiptDownload({ clientName: (selectedClient?.name || selectedClient?.email || "Client"), contract: contracts[selectedClientId], index: r.echeance, paidDelta: r.paidDelta }); } catch{} }}>Télécharger</button>
</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

// ===================== Root =====================
export default function AppCredit12Echeances() {
  const { session, logout } = useSession();
  const [current, setCurrent] = useState(null);
  useEffect(() => { if (session?.userId) setCurrent(getUser(session.userId)); }, [session]);
  if (!current) return <AuthGate onReady={(s) => { if (s?.userId) setCurrent(getUser(s.userId)); }} />;
  if (current.role === "admin") return <AdminDashboard user={current} onLogout={logout} />;
  return <ClientDashboard user={current} onLogout={logout} />;
}
