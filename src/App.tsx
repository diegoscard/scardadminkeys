import React, { useState, useEffect, useMemo } from 'react';
import { 
  Plus, 
  Search, 
  Trash2, 
  RefreshCw, 
  Shield, 
  Key as KeyIcon, 
  Users, 
  AlertCircle, 
  CheckCircle2, 
  Clock,
  LogOut,
  ChevronDown,
  Filter,
  Monitor,
  Database,
  ExternalLink,
  PlusCircle,
  Activity
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { ActivationKey, KeyStatus, ManagedDatabase, AuditLog, DashboardStats } from './types';

// Helper to generate key: XXXXX-XXXXX-XXXXX-XXXXX-XXXXX
const generateKey = () => {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  const segment = () => Array.from({ length: 5 }, () => chars[Math.floor(Math.random() * chars.length)]).join('');
  return `${segment()}-${segment()}-${segment()}-${segment()}-${segment()}`;
};

export default function App() {
  const [loading, setLoading] = useState(true);
  const [keys, setKeys] = useState<ActivationKey[]>([]);
  const [databases, setDatabases] = useState<ManagedDatabase[]>([]);
  const [logs, setLogs] = useState<AuditLog[]>([]);
  const [stats, setStats] = useState<DashboardStats>({ total: 0, activated: 0, expired: 0, systems: 0 });
  
  const [searchTerm, setSearchTerm] = useState('');
  const [statusFilter, setStatusFilter] = useState<KeyStatus | 'all'>('all');
  const [newKeyValidity, setNewKeyValidity] = useState<number>(30);
  const [selectedDb, setSelectedDb] = useState<string>('');
  const [isGenerating, setIsGenerating] = useState(false);
  const [dbError, setDbError] = useState<string | null>(null);
  
  const [activeTab, setActiveTab] = useState<'licenses' | 'ecosystem'>('licenses');
  const [dbName, setDbName] = useState('');
  const [dbUrl, setDbUrl] = useState('');
  const [isAddingDb, setIsAddingDb] = useState(false);

  const fetchData = async () => {
    try {
      const results = await Promise.all([
        fetch('/api/keys'),
        fetch('/api/databases'),
        fetch('/api/logs'),
        fetch('/api/stats')
      ]);

      const data = [];
      for (const res of results) {
        const contentType = res.headers.get("content-type");
        if (res.ok && contentType && contentType.includes("application/json")) {
          data.push(await res.json());
        } else {
          const text = await res.text();
          if (!res.ok) {
            if (res.status === 503 && contentType?.includes("application/json")) {
              const err = JSON.parse(text);
              setDbError(err.message);
              return;
            }
            throw new Error(`Erro ${res.status}: ${text.substring(0, 50)}`);
          }
          // res.ok is true but not JSON (likely Vite SPA fallback)
          console.error("Expected JSON but got:", text.substring(0, 100));
          throw new Error("O servidor retornou uma resposta inesperada (HTML). Verifique se o backend está rodando corretamente.");
        }
      }
      
      const [k, d, l, s] = data;
      
      setKeys(k);
      setDatabases(d);
      setLogs(l);
      setStats(s);
      setDbError(null);
    } catch (err) {
      console.error("Fetch error:", err);
    }
  };

  useEffect(() => {
    fetchData();
    setLoading(false);
    const interval = setInterval(fetchData, 10000); // Polling every 10s as it's fullstack now
    return () => clearInterval(interval);
  }, []);

  const filteredKeys = useMemo(() => {
    return keys.filter(k => {
      const matchesSearch = k.key.toLowerCase().includes(searchTerm.toLowerCase()) || 
                          (k.hwid && k.hwid.toLowerCase().includes(searchTerm.toLowerCase()));
      const matchesFilter = statusFilter === 'all' || k.status === statusFilter;
      return matchesSearch && matchesFilter;
    });
  }, [keys, searchTerm, statusFilter]);

  const handleCreateKey = async () => {
    setIsGenerating(true);
    try {
      const newKeyValue = generateKey();
      const res = await fetch('/api/keys', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          key: newKeyValue,
          validityDays: newKeyValidity,
          databaseId: selectedDb || null
        })
      });
      if (res.ok) {
        fetchData();
      }
    } catch (err) {
      console.error(err);
    } finally {
      setIsGenerating(false);
    }
  };

  const handleDeleteKey = async (id: number) => {
    if (confirm('Deseja realmente remover esta chave?')) {
      const res = await fetch(`/api/keys/${id}`, { method: 'DELETE' });
      if (res.ok) fetchData();
    }
  };

  const toggleStatus = async (item: ActivationKey) => {
    const nextStatus = item.status === 'available' ? 'activated' : 
                      item.status === 'activated' ? 'expired' : 'available';
    const res = await fetch(`/api/keys/${item.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: nextStatus })
    });
    if (res.ok) fetchData();
  };

  const handleAddDatabase = async () => {
    if (!dbName || !dbUrl) return;
    setIsAddingDb(true);
    try {
      const res = await fetch('/api/databases', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: dbName, url: dbUrl })
      });
      if (res.ok) {
        setDbName('');
        setDbUrl('');
        fetchData();
      }
    } catch (err) {
      console.error(err);
    } finally {
      setIsAddingDb(false);
    }
  };

  const handleDeleteDatabase = async (id: number) => {
    if (confirm('Deseja remover este sistema do ecossistema?')) {
      const res = await fetch(`/api/databases/${id}`, { method: 'DELETE' });
      if (res.ok) fetchData();
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-bg flex items-center justify-center">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-accent"></div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-bg text-text selection:bg-accent/30 p-6 max-w-7xl mx-auto">
      {/* Header */}
      <header className="flex items-center justify-between mb-8">
        <div className="flex items-center gap-4">
          <div className="w-10 h-10 bg-accent rounded-xl grid place-items-center font-bold text-white shadow-lg shadow-accent/20">
            S
          </div>
          <div>
            <h1 className="text-xl font-bold tracking-tight">Scard Ecosystem Admin</h1>
            <div className="flex items-center gap-2 mt-0.5">
              <nav className="flex gap-4 ml-6">
                <button 
                  onClick={() => setActiveTab('licenses')} 
                  className={`text-xs font-bold uppercase transition-colors hover:text-accent ${activeTab === 'licenses' ? 'text-accent' : 'text-text-dim'}`}
                >
                  Licenças
                </button>
                <button 
                  onClick={() => setActiveTab('ecosystem')} 
                  className={`text-xs font-bold uppercase transition-colors hover:text-accent ${activeTab === 'ecosystem' ? 'text-accent' : 'text-text-dim'}`}
                >
                  Ecossistema
                </button>
              </nav>
            </div>
          </div>
        </div>
        
        <div className="flex items-center gap-6">
          <div className="relative hidden md:block">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-text-dim" />
            <input 
              type="text" 
              placeholder="Search keys..."
              className="bg-card border border-border rounded-xl py-2 pl-10 pr-4 text-sm focus:outline-none focus:border-accent transition-all w-64"
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
            />
          </div>
          <div className="flex items-center gap-3 bg-card border border-border p-1.5 pr-4 rounded-2xl">
            <div className="w-8 h-8 rounded-xl bg-accent/20 flex items-center justify-center text-accent">
              <Shield className="w-4 h-4" />
            </div>
            <div className="flex flex-col">
              <span className="text-xs font-semibold leading-none">Administrador</span>
            </div>
          </div>
        </div>
      </header>

      {dbError ? (
        <div className="bento-card bg-error/5 border-error/20 p-12 text-center max-w-2xl mx-auto mt-20">
          <Database className="w-16 h-16 text-error mx-auto mb-6 opacity-80" />
          <h2 className="text-2xl font-bold mb-4">Problema na Conexão SQL</h2>
          <p className="text-text-dim mb-8">{dbError}</p>
          <div className="bg-bg/50 p-6 rounded-xl text-left border border-border/50">
            <h3 className="text-xs font-bold uppercase tracking-widest text-accent mb-4">Passo a Passo para Corrigir:</h3>
            <ol className="text-sm space-y-4 text-text-dim list-decimal pl-4">
              <li>Acesse o menu superior <span className="text-text font-bold">Settings</span> no AI Studio.</li>
              <li>Clique em <span className="text-text font-bold">Secrets</span>.</li>
              <li>Adicione um novo segredo com chave <code className="bg-white/5 px-2 py-0.5 rounded text-accent">DATABASE_URL</code>.</li>
              <li>O valor deve ser o link do seu Postgres (Prisma Postgres), ex: <br />
                <code className="text-[10px] block mt-1 break-all bg-card p-2 rounded">postgres://user:pass@host:port/db?sslmode=require</code>
              </li>
              <li>Após salvar, o sistema carregará automaticamente.</li>
            </ol>
          </div>
        </div>
      ) : activeTab === 'licenses' ? (
        <div className="bento-grid">
          {/* Stats Section */}
          <StatCard label="Licenças Ativas" value={stats.activated} trend="↑ 12% vs last month" color="accent" />
          <StatCard label="Disponíveis" value={stats.total - stats.activated - stats.expired} trend="Ready for use" color="success" />
          <StatCard label="Expiradas" value={stats.expired} trend="Action required" color="error" />
          <StatCard label="Sistemas Vinculados" value={stats.systems} trend="Integrated DBs" color="accent" />

          {/* Generator Card */}
          <div className="bento-card col-span-4 lg:col-span-2">
            <div className="flex items-center justify-between mb-6">
              <h2 className="text-sm font-bold uppercase tracking-wider text-text-dim">Gerador de Chaves</h2>
              <KeyIcon className="w-4 h-4 text-accent" />
            </div>
            
            <div className="space-y-6 flex-grow flex flex-col justify-center">
              <div>
                <label className="text-[10px] font-bold text-text-dim uppercase tracking-widest mb-3 block">Período de Validade</label>
                <div className="duration-options grid grid-cols-3 gap-3">
                  {[30, 90, 365].map(days => (
                    <button
                      key={days}
                      onClick={() => setNewKeyValidity(days)}
                      className={`btn-option py-3 text-xs font-bold transition-all border rounded-xl ${
                        newKeyValidity === days 
                          ? 'border-accent bg-accent/10 text-accent shadow-sm' 
                          : 'border-border text-text-dim hover:border-gray-500'
                      }`}
                    >
                      {days} Dias
                    </button>
                  ))}
                </div>
              </div>

              <div>
                <label className="text-[10px] font-bold text-text-dim uppercase tracking-widest mb-3 block">Vincular ao Sistema (Opcional)</label>
                <select 
                  value={selectedDb}
                  onChange={(e) => setSelectedDb(e.target.value)}
                  className="w-full bg-card border border-border rounded-xl py-3 px-4 text-xs font-bold text-text outline-none focus:border-accent appearance-none bg-no-repeat bg-[right_1rem_center] bg-[length:1em_1em]"
                >
                  <option value="">Apenas Banco Central (Admin)</option>
                  {databases.map(db => (
                    <option key={db.id} value={db.id}>{db.name}</option>
                  ))}
                </select>
              </div>

              <div className="p-4 bg-accent/5 border border-accent/10 rounded-xl">
                <div className="flex items-center gap-3">
                  <div className="w-2 h-2 rounded-full bg-accent animate-pulse" />
                  <span className="text-xs font-medium text-text-dim leading-none">Auto-lock to Baseboard Serial enabled</span>
                </div>
              </div>
              
              <button 
                onClick={handleCreateKey}
                disabled={isGenerating}
                className="w-full bg-accent hover:opacity-90 text-white font-bold py-4 rounded-xl flex items-center justify-center gap-3 transition-all active:scale-[0.98] disabled:opacity-50 mt-auto"
              >
                <RefreshCw className={`w-4 h-4 ${isGenerating ? 'animate-spin' : ''}`} />
                {isGenerating ? 'Generating...' : 'Gerar Chave de Ativação'}
              </button>
            </div>
          </div>

          {/* System Logs Card */}
          <div className="bento-card col-span-4 lg:col-span-2">
            <div className="flex items-center justify-between mb-6">
              <h2 className="text-sm font-bold uppercase tracking-wider text-text-dim">Auditoria de Atividades</h2>
              <Activity className="w-4 h-4 text-accent" />
            </div>
            <div className="font-mono text-[10px] space-y-3 overflow-y-auto max-h-[300px] pr-2 custom-scrollbar">
              {logs.map((log) => (
                <div key={log.id} className="flex gap-3 leading-relaxed border-l border-border pl-3 group relative hover:border-accent transition-colors">
                  <span className="text-text-dim/40 w-12 shrink-0">[{new Date(log.createdAt).toLocaleTimeString()}]</span>
                  <span className={`font-bold shrink-0 ${log.action.includes('FAIL') ? 'text-error' : 'text-accent'}`}>{log.action}</span>
                  <span className="text-text-dim truncate">{log.details}</span>
                </div>
              ))}
            </div>
          </div>

          {/* Table Card */}
          <div className="bento-card col-span-4 overflow-hidden !p-0">
            <div className="p-6 border-b border-border flex items-center justify-between bg-card/50">
              <h2 className="text-sm font-bold uppercase tracking-wider text-text-dim">Gerenciamento de Licenças</h2>
              <div className="flex gap-2">
                <Filter className="w-4 h-4 text-text-dim" />
                <select 
                  value={statusFilter}
                  onChange={(e) => setStatusFilter(e.target.value as any)}
                  className="bg-transparent text-[10px] font-bold uppercase text-text-dim focus:outline-none cursor-pointer"
                >
                  <option value="all">Filtro: Todos</option>
                  <option value="available">Disponível</option>
                  <option value="activated">Ativado</option>
                  <option value="expired">Expirado</option>
                </select>
              </div>
            </div>
            
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="bg-bg/50 text-[10px] uppercase font-bold tracking-widest text-text-dim border-b border-border">
                    <th className="px-6 py-4">Chave de Acesso</th>
                    <th className="px-6 py-4">Sistema Alvo</th>
                    <th className="px-6 py-4">HWID (Placa-Mãe)</th>
                    <th className="px-6 py-4">Status</th>
                    <th className="px-6 py-4 text-right">Ações</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border/50">
                  {filteredKeys.length === 0 ? (
                    <tr>
                      <td colSpan={5} className="px-6 py-12 text-center text-text-dim text-xs italic">
                        Nenhuma licença encontrada.
                      </td>
                    </tr>
                  ) : (
                    filteredKeys.map((item) => (
                      <motion.tr 
                        key={item.id}
                        layout
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        className="group transition-colors hover:bg-white/[0.02]"
                      >
                        <td className="px-6 py-4">
                          <span className="font-mono text-accent text-xs font-medium">{item.key}</span>
                        </td>
                        <td className="px-6 py-4">
                          <span className="text-[10px] font-bold text-text-dim">{item.database?.name || 'Local Only'}</span>
                        </td>
                        <td className="px-6 py-4">
                          {item.hwid ? (
                            <div className="flex items-center gap-2">
                              <Monitor className="w-3 h-3 text-text-dim" />
                              <span className="font-mono text-text-dim text-[10px]">{item.hwid}</span>
                            </div>
                          ) : (
                            <span className="text-text-dim/40 text-[10px] italic">Aguardando ativação...</span>
                          )}
                        </td>
                        <td className="px-6 py-4">
                          <span className={`px-2 py-0.5 rounded text-[10px] font-bold border ${
                            item.status === 'activated' ? 'bg-accent/10 text-accent border-accent/20' :
                            item.status === 'expired' ? 'bg-error/10 text-error border-error/20' :
                            'bg-success/10 text-success border-success/20'
                          }`}>
                            {item.status.toUpperCase()}
                          </span>
                        </td>
                        <td className="px-6 py-4 text-right">
                          <div className="flex items-center justify-end gap-3 opacity-0 group-hover:opacity-100 transition-opacity">
                            <button 
                              onClick={() => toggleStatus(item)}
                              className="text-[10px] font-bold text-accent uppercase hover:underline"
                            >
                              Mudar Status
                            </button>
                            <button 
                              onClick={() => handleDeleteKey(item.id)}
                              className="p-1.5 text-text-dim hover:text-error transition-colors bg-bg/50 rounded-lg"
                            >
                              <Trash2 className="w-3 h-3" />
                            </button>
                          </div>
                        </td>
                      </motion.tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      ) : (
        <div className="space-y-6">
          <div className="bento-card overflow-hidden">
            <div className="p-6 border-b border-border flex items-center justify-between">
              <h2 className="text-sm font-bold uppercase tracking-wider text-text-dim">Adicionar Novo Sistema ao Ecossistema</h2>
              <Database className="w-4 h-4 text-accent" />
            </div>
            <div className="p-6 space-y-4">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <label className="text-[10px] font-bold text-text-dim uppercase tracking-widest mb-2 block">Nome do Sistema</label>
                  <input 
                    type="text" 
                    placeholder="Ex: ERP Corporate, Software Gestão"
                    className="w-full bg-bg border border-border rounded-xl py-3 px-4 text-sm focus:outline-none focus:border-accent transition-all"
                    value={dbName}
                    onChange={(e) => setDbName(e.target.value)}
                  />
                </div>
                <div>
                  <label className="text-[10px] font-bold text-text-dim uppercase tracking-widest mb-2 block">PostgreSQL URL (SSL required)</label>
                  <input 
                    type="password" 
                    placeholder="postgres://user:pass@host:port/db?sslmode=require"
                    className="w-full bg-bg border border-border rounded-xl py-3 px-4 text-sm focus:outline-none focus:border-accent transition-all font-mono"
                    value={dbUrl}
                    onChange={(e) => setDbUrl(e.target.value)}
                  />
                </div>
              </div>
              <button 
                onClick={handleAddDatabase}
                disabled={isAddingDb}
                className="bg-accent hover:opacity-90 text-white font-bold py-3 px-6 rounded-xl flex items-center gap-2 transition-all active:scale-95 disabled:opacity-50"
              >
                <PlusCircle className="w-4 h-4" />
                {isAddingDb ? 'Cadastrando...' : 'Vincular Novo Banco de Dados'}
              </button>
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            <AnimatePresence>
              {databases.map(db => (
                <motion.div 
                  key={db.id}
                  initial={{ opacity: 0, scale: 0.9 }}
                  animate={{ opacity: 1, scale: 1 }}
                  exit={{ opacity: 0, scale: 0.9 }}
                  className="bento-card group"
                >
                  <div className="flex items-center justify-between mb-4">
                    <div className="p-2 bg-accent/10 rounded-lg">
                      <Database className="w-5 h-5 text-accent" />
                    </div>
                    <button 
                      onClick={() => handleDeleteDatabase(db.id)}
                      className="opacity-0 group-hover:opacity-100 p-1.5 text-text-dim hover:text-error transition-all"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                  <h3 className="font-bold text-lg mb-1">{db.name}</h3>
                  <div className="flex items-center gap-2 text-text-dim mb-4">
                    <div className="w-1.5 h-1.5 rounded-full bg-success" />
                    <span className="text-[10px] font-bold uppercase tracking-wider">Sync Active</span>
                  </div>
                  <div className="bg-bg p-3 rounded-lg flex items-center justify-between">
                    <span className="text-[10px] font-mono text-text-dim truncate mr-2 italic">URL Oculta por Segurança</span>
                    <ExternalLink className="w-3 h-3 text-text-dim" />
                  </div>
                </motion.div>
              ))}
            </AnimatePresence>
          </div>
        </div>
      )}
    </div>
  );
}

function StatCard({ label, value, trend, color }: { label: string, value: number | string, trend: string, color: 'accent' | 'error' | 'success' }) {
  const colors = {
    accent: 'text-accent',
    error: 'text-error',
    success: 'text-success',
  };

  return (
    <div className="bento-card">
      <span className="text-[10px] font-bold text-text-dim uppercase tracking-widest mb-2">{label}</span>
      <span className={`text-4xl font-black font-mono tracking-tighter mb-4 ${colors[color]}`}>{value}</span>
      <span className="text-[10px] text-success font-medium flex items-center gap-1 mt-auto">
        <div className="w-1 h-1 rounded-full bg-success" />
        {trend}
      </span>
    </div>
  );
}
