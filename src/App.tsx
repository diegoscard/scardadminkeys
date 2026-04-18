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
  Edit2
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { ActivationKey, KeyStatus, ManagedDatabase, DashboardStats } from './types';

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
  
  const [editingDbId, setEditingDbId] = useState<number | null>(null);
  const [editingDbUrl, setEditingDbUrl] = useState('');
  const [isUpdatingDb, setIsUpdatingDb] = useState(false);

  const [isRenewModalOpen, setIsRenewModalOpen] = useState(false);
  const [renewKeyId, setRenewKeyId] = useState<string>('');
  const [renewDays, setRenewDays] = useState<number>(30);
  const [isRenewing, setIsRenewing] = useState(false);

  const fetchData = async () => {
    try {
      const results = await Promise.all([
        fetch('/api/keys'),
        fetch('/api/databases'),
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
      
      const [k, d, s] = data;
      
      setKeys(k);
      setDatabases(d);
      setStats(s);
      
      if (d.length > 0 && !selectedDb) {
        setSelectedDb(d[0].id.toString());
      }
      
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
    if (window.confirm('Realmente deseja excluir esta chave?')) {
      const res = await fetch(`/api/keys/${id}`, { method: 'DELETE' });
      if (res.ok) fetchData();
    }
  };

  const openRenewModalPerKey = (key: ActivationKey) => {
    setRenewKeyId(key.id.toString());
    setRenewDays(30);
    setIsRenewModalOpen(true);
  };

  const toggleStatus = async (item: ActivationKey, nextStatus: 'activated' | 'expired') => {
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

  const openUpdateModal = (db: ManagedDatabase) => {
    setEditingDbId(db.id);
    setEditingDbUrl(db.url || '');
  };

  const closeUpdateModal = () => {
    setEditingDbId(null);
    setEditingDbUrl('');
    setIsUpdatingDb(false);
  };

  const handleUpdateDatabaseUrl = async () => {
    if (!editingDbId || !editingDbUrl.trim()) return;
    setIsUpdatingDb(true);
    try {
      const res = await fetch(`/api/databases/${editingDbId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: editingDbUrl.trim() })
      });
      if (res.ok) {
        fetchData();
        closeUpdateModal();
      } else {
        alert('Erro ao atualizar URL');
      }
    } catch (err) {
      console.error(err);
    } finally {
      setIsUpdatingDb(false);
    }
  };

  const handleRenewKey = async () => {
    if (!renewKeyId || !renewDays) return;
    setIsRenewing(true);
    try {
      const res = await fetch(`/api/keys/${renewKeyId}/renew`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ additionalDays: renewDays })
      });
      if (res.ok) {
        fetchData();
        closeRenewModal();
      } else {
        const data = await res.json();
        alert(data.error || 'Erro ao renovar chave');
      }
    } catch (err) {
      console.error(err);
    } finally {
      setIsRenewing(false);
    }
  };

  const closeRenewModal = () => {
    setIsRenewModalOpen(false);
    setRenewKeyId('');
    setRenewDays(30);
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
            <h1 className="text-xl font-bold tracking-tight">Scard Admin Keys</h1>
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
        <div className="bento-grid grid grid-cols-2 lg:grid-cols-4">
          {/* Stats Section */}
          <StatCard label="Total Geradas" value={stats.total} trend="All time" color="success" />
          <StatCard label="Licenças Ativas" value={stats.activated} trend="Ready or in use" color="accent" />

          {/* Generator Card */}
          <div className="bento-card col-span-2 lg:col-span-2 row-span-1 border border-border">
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
                <label className="text-[10px] font-bold text-text-dim uppercase tracking-widest mb-3 block">Vincular ao Sistema</label>
                <select 
                  value={selectedDb}
                  onChange={(e) => setSelectedDb(e.target.value)}
                  className="w-full bg-card border border-border rounded-xl py-3 px-4 text-xs font-bold text-text outline-none focus:border-accent appearance-none bg-no-repeat bg-[right_1rem_center] bg-[length:1em_1em]"
                >
                  {databases.length === 0 ? (
                    <option value="" disabled>Nenhum sistema disponível</option>
                  ) : (
                    databases.map(db => (
                      <option key={db.id} value={db.id}>{db.name}</option>
                    ))
                  )}
                </select>
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

          {/* Table Card */}
          <div className="bento-card col-span-2 lg:col-span-4 overflow-hidden !p-0 mt-6">
            <div className="p-6 border-b border-border flex items-center justify-between bg-card/50">
              <h2 className="text-sm font-bold uppercase tracking-wider text-text-dim">Gerenciamento de Licenças</h2>
              <div className="flex gap-2 items-center">
                <Filter className="w-4 h-4 text-text-dim" />
                <select 
                  value={statusFilter}
                  onChange={(e) => setStatusFilter(e.target.value as any)}
                  className="bg-transparent text-[10px] font-bold uppercase text-text-dim focus:outline-none cursor-pointer"
                >
                  <option value="all">Filtro: Todos</option>
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
                    <th className="px-6 py-4">Validade</th>
                    <th className="px-6 py-4">Expira em</th>
                    <th className="px-6 py-4">HWID (Placa-Mãe)</th>
                    <th className="px-6 py-4">Status</th>
                    <th className="px-6 py-4 text-right">Ações</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border/50">
                  {filteredKeys.length === 0 ? (
                    <tr>
                      <td colSpan={7} className="px-6 py-12 text-center text-text-dim text-xs italic">
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
                          <span className="text-[10px] font-bold text-text-dim">{item.validityDays} Dias</span>
                        </td>
                        <td className="px-6 py-4">
                          <span className="text-[10px] font-bold text-text-dim">
                            {(() => {
                               const start = item.activatedAt ? new Date(item.activatedAt) : new Date(item.createdAt);
                               const end = new Date(start.getTime() + item.validityDays * 24 * 60 * 60 * 1000);
                               const diff = Math.ceil((end.getTime() - new Date().getTime()) / (1000 * 3600 * 24));
                               if (item.status === 'expired' || diff <= 0) return <span className="text-error">Expirou</span>;
                               return `${diff} dias restantes`;
                            })()}
                          </span>
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
                          <select
                            value={item.status}
                            onChange={(e) => toggleStatus(item, e.target.value as 'activated' | 'expired')}
                            className={`px-2 py-0.5 rounded text-[10px] font-bold border focus:outline-none focus:ring-1 focus:ring-accent cursor-pointer ${
                              item.status === 'activated' ? 'bg-success/10 text-success border-success/20' :
                              item.status === 'expired' ? 'bg-error/10 text-error border-error/20' :
                              'bg-text-dim text-bg border-text-dim'
                            }`}
                          >
                            <option value="activated" className="bg-bg text-success font-bold">ACTIVATED</option>
                            <option value="expired" className="bg-bg text-error font-bold">EXPIRED</option>
                          </select>
                        </td>
                        <td className="px-6 py-4 text-right">
                          <div className="flex items-center justify-end gap-3 opacity-0 group-hover:opacity-100 transition-opacity">
                            <button 
                              onClick={() => openRenewModalPerKey(item)}
                              className="p-1.5 text-text-dim hover:text-accent transition-colors bg-bg/50 rounded-lg"
                              title="Renovar Chave"
                            >
                              <RefreshCw className="w-3 h-3" />
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
                    <div className="flex gap-2">
                       <button 
                         onClick={() => openUpdateModal(db)}
                         className="opacity-0 group-hover:opacity-100 p-1.5 text-text-dim hover:text-accent transition-all"
                         title="Editar URL"
                       >
                         <Edit2 className="w-4 h-4" />
                       </button>
                       <button 
                         onClick={() => handleDeleteDatabase(db.id)}
                         className="opacity-0 group-hover:opacity-100 p-1.5 text-text-dim hover:text-error transition-all"
                         title="Remover Sistema"
                       >
                         <Trash2 className="w-4 h-4" />
                       </button>
                    </div>
                  </div>
                  <h3 className="font-bold text-lg mb-1">{db.name}</h3>
                  <div className="flex items-center gap-2 text-text-dim mt-auto pt-4">
                    <div className="w-1.5 h-1.5 rounded-full bg-success opacity-80" />
                    <span className="text-[10px] font-bold uppercase tracking-wider text-success">Sync Active</span>
                  </div>
                </motion.div>
              ))}
            </AnimatePresence>
          </div>
        </div>
      )}

      {/* Modal for Editing DB URL */}
      <AnimatePresence>
        {editingDbId && (
          <motion.div 
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-4"
          >
            <motion.div 
              initial={{ scale: 0.95, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.95, opacity: 0 }}
              className="bg-card w-full max-w-lg rounded-2xl border border-border shadow-2xl overflow-hidden"
            >
              <div className="p-6">
                <h3 className="text-xl font-bold mb-6">Atualizar URL do Banco de Dados</h3>
                <div className="space-y-4">
                  <div>
                    <label className="text-[10px] font-bold text-text-dim uppercase tracking-widest mb-2 block">Nova PostgreSQL URL</label>
                    <input 
                      type="text" 
                      placeholder="postgres://user:pass@host:port/db"
                      className="w-full bg-bg border border-border rounded-xl py-3 px-4 text-sm focus:outline-none focus:border-accent transition-all font-mono"
                      value={editingDbUrl}
                      onChange={(e) => setEditingDbUrl(e.target.value)}
                    />
                  </div>
                </div>
              </div>
              <div className="border-t border-border p-4 bg-bg/50 flex justify-end gap-3">
                <button 
                  onClick={closeUpdateModal}
                  className="px-6 py-2 rounded-xl text-sm font-semibold hover:bg-white/5 transition-colors"
                >
                  Cancelar
                </button>
                <button 
                  onClick={handleUpdateDatabaseUrl}
                  disabled={isUpdatingDb || !editingDbUrl.trim()}
                  className="bg-accent hover:opacity-90 text-white font-bold py-2 px-6 rounded-xl text-sm transition-all active:scale-95 disabled:opacity-50"
                >
                  {isUpdatingDb ? 'Salvando...' : 'Salvar Alterações'}
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Modal for Renewing Key */}
      <AnimatePresence>
        {isRenewModalOpen && (
          <motion.div 
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-4"
          >
            <motion.div 
              initial={{ scale: 0.95, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.95, opacity: 0 }}
              className="bg-card w-full max-w-lg rounded-2xl border border-border shadow-2xl overflow-hidden"
            >
              <div className="p-6">
                <h3 className="text-xl font-bold mb-6">Renovar Chave de Acesso</h3>
                <div className="space-y-6">
                  <div>
                    <label className="text-[10px] font-bold text-text-dim uppercase tracking-widest mb-2 block">Chave Selecionada</label>
                    <div className="w-full bg-bg/50 border border-border/50 rounded-xl py-3 px-4 text-sm font-mono text-text-dim cursor-not-allowed">
                      {keys.find(k => k.id.toString() === renewKeyId)?.key || 'Carregando...'}
                    </div>
                  </div>
                  <div>
                    <label className="text-[10px] font-bold text-text-dim uppercase tracking-widest mb-3 block">Adicionar Período de Validade</label>
                    <div className="grid grid-cols-3 gap-3">
                      {[30, 90, 365].map(days => (
                        <button
                          key={days}
                          onClick={() => setRenewDays(days)}
                          className={`py-3 text-xs font-bold transition-all border rounded-xl ${
                            renewDays === days 
                              ? 'border-accent bg-accent/10 text-accent shadow-sm' 
                              : 'border-border text-text-dim hover:border-gray-500 bg-bg'
                          }`}
                        >
                          +{days} Dias
                        </button>
                      ))}
                    </div>
                  </div>
                </div>
              </div>
              <div className="border-t border-border p-4 bg-bg/50 flex justify-end gap-3">
                <button 
                  onClick={closeRenewModal}
                  className="px-6 py-2 rounded-xl text-sm font-semibold hover:bg-white/5 transition-colors"
                >
                  Cancelar
                </button>
                <button 
                  onClick={handleRenewKey}
                  disabled={isRenewing || !renewKeyId}
                  className="bg-accent hover:opacity-90 text-white font-bold py-2 px-6 rounded-xl text-sm transition-all active:scale-95 disabled:opacity-50 flex items-center gap-2"
                >
                  <RefreshCw className={`w-4 h-4 ${isRenewing ? 'animate-spin' : ''}`} />
                  {isRenewing ? 'Renovando...' : 'Confirmar Renovação'}
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

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
