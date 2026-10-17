import { Outlet, NavLink, useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { useAuth } from '../contexts/AuthContext'
import { useTheme } from '../contexts/ThemeContext'
import { useQueryClient } from '@tanstack/react-query'
import {
  LayoutDashboard, Wallet, ArrowLeftRight, CreditCard,
  Tags, BarChart3, LogOut, Menu, X, Upload, Repeat,
  Wand2, Settings, Users, Shield, FolderTree, Cog, CalendarRange, Building2, Plus,
  Settings2, Archive, RotateCcw, Trash2, Save, UserCog, Lock, Sun, Moon
} from 'lucide-react'
import { useState } from 'react'
import { workspaceApi } from '../lib/api'
import WorkspaceMembers from './WorkspaceMembers'
import { cn } from '../lib/utils'
import { BRAND } from '../lib/brand'
import Modal from './Modal'

// Finance module items first, in the order of the PAINEL spec (RF-IN-13),
// each shown only with its permission. Receitas and Precificação arrive in later releases.
export const navigation = [
  { name: 'nav.dashboard', href: '/', icon: LayoutDashboard, permission: 'financeiro.visao_geral' },
  { name: 'nav.reports', href: '/reports', icon: BarChart3, permission: 'financeiro.relatorios' },
  { name: 'nav.accounts', href: '/accounts', icon: Wallet, permission: 'financeiro.contas' },
  { name: 'nav.creditCards', href: '/credit-cards', icon: CreditCard, permission: 'financeiro.cartoes' },
  { name: 'nav.transactions', href: '/transactions', icon: ArrowLeftRight, permission: 'financeiro.faturas' },
  { name: 'nav.recurring', href: '/planned', icon: Repeat, permission: 'financeiro.recorrencias' },
  { name: 'nav.forecast', href: '/forecast', icon: CalendarRange, permission: 'financeiro.relatorios' },
  { name: 'nav.categories', href: '/categories', icon: Tags, permission: 'financeiro.relatorios.config', action: 'editar' },
  { name: 'nav.payees', href: '/payees', icon: Users, permission: 'financeiro.relatorios.config', action: 'editar' },
  { name: 'nav.import', href: '/import', icon: Upload, permission: 'financeiro.entradas', action: 'criar' },
  { name: 'nav.rules', href: '/rules', icon: Wand2, permission: 'financeiro.relatorios.config', action: 'editar' },
  { name: 'nav.settings', href: '/settings', icon: Settings },
]

const adminNavigation = [
  { name: 'admin.users.title', href: '/admin/users', icon: Users },
  { name: 'admin.groups.title', href: '/admin/groups', icon: FolderTree },
  { name: 'admin.settings.title', href: '/admin/settings', icon: Cog },
]

export default function Layout() {
  const { user, isGroupAdmin, logout, workspaces, activeWorkspace, switchWorkspace, createWorkspace, deactivateWorkspace, reactivateWorkspace, updateWorkspaceNotes, deleteWorkspace, restoreWorkspace, can = () => true } = useAuth()
  const { t } = useTranslation()
  const { theme, toggleTheme } = useTheme()
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const [sidebarOpen, setSidebarOpen] = useState(false)
  const [showNewClient, setShowNewClient] = useState(false)
  const [showManageClients, setShowManageClients] = useState(false)
  const [newClient, setNewClient] = useState({ name: '', notes: '', locale: 'pt', currency: 'BRL' })
  const [clientNoteDrafts, setClientNoteDrafts] = useState({})
  const [savingNotesWorkspace, setSavingNotesWorkspace] = useState(null)
  const [workspaceError, setWorkspaceError] = useState('')
  const [switchingWorkspace, setSwitchingWorkspace] = useState(false)
  const [creatingWorkspace, setCreatingWorkspace] = useState(false)
  const [membersWorkspaceId, setMembersWorkspaceId] = useState(null)
  const [archivedWorkspaces, setArchivedWorkspaces] = useState([])
  const [retentionDays, setRetentionDays] = useState(90)
  const visibleNavigation = navigation.filter((item) => !item.permission || can(item.permission, item.action || 'ver'))

  const loadArchivedWorkspaces = async () => {
    try {
      const { data } = await workspaceApi.getArchived()
      setArchivedWorkspaces(data.data.workspaces || [])
      setRetentionDays(data.data.retentionDays || 90)
    } catch {
      setArchivedWorkspaces([])
    }
  }

  const openManageClients = () => {
    setWorkspaceError('')
    setShowManageClients(true)
    loadArchivedWorkspaces()
  }

  const handleRestoreWorkspace = async (workspace) => {
    setWorkspaceError('')
    try {
      await restoreWorkspace(workspace.id)
      await loadArchivedWorkspaces()
    } catch (error) {
      setWorkspaceError(error.response?.data?.error?.message || t('common.error'))
    }
  }

  const handleLogout = async () => {
    await logout()
    navigate('/login')
  }

  const handleWorkspaceChange = async (event) => {
    setWorkspaceError('')
    setSwitchingWorkspace(true)
    try {
      await switchWorkspace(event.target.value)
      queryClient.clear()
    } catch (error) {
      setWorkspaceError(error.response?.data?.error?.message || t('common.error'))
    } finally {
      setSwitchingWorkspace(false)
    }
  }

  const handleCreateWorkspace = async (event) => {
    event.preventDefault()
    setWorkspaceError('')
    setCreatingWorkspace(true)
    try {
      await createWorkspace(newClient)
      queryClient.clear()
      setShowNewClient(false)
      setNewClient({ name: '', notes: '', locale: 'pt', currency: 'BRL' })
    } catch (error) {
      setWorkspaceError(error.response?.data?.error?.message || t('common.error'))
    } finally {
      setCreatingWorkspace(false)
    }
  }

  const handleSaveWorkspaceNotes = async (workspace) => {
    const notes = clientNoteDrafts[workspace.id] ?? workspace.notes ?? ''
    setSavingNotesWorkspace(workspace.id)
    setWorkspaceError('')
    try {
      await updateWorkspaceNotes(workspace.id, notes)
    } catch (error) {
      setWorkspaceError(error.response?.data?.error?.message || t('common.error'))
    } finally {
      setSavingNotesWorkspace(null)
    }
  }

  const handleDeactivateWorkspace = async (workspace) => {
    setWorkspaceError('')
    try {
      await deactivateWorkspace(workspace.id)
      if (activeWorkspace?.id === workspace.id) queryClient.clear()
    } catch (error) {
      setWorkspaceError(error.response?.data?.error?.message || t('common.error'))
    }
  }

  const handleReactivateWorkspace = async (workspace) => {
    setWorkspaceError('')
    try {
      await reactivateWorkspace(workspace.id)
    } catch (error) {
      setWorkspaceError(error.response?.data?.error?.message || t('common.error'))
    }
  }

  const handleDeleteWorkspace = async (workspace) => {
    const confirmation = t('workspaces.confirmDelete', {
      name: workspace.name,
      days: retentionDays,
      defaultValue: `Excluir o cliente "${workspace.name}"? Ele fica arquivado por ${retentionDays} dias e pode ser restaurado nesse prazo; depois, os dados financeiros são apagados definitivamente.`,
    })
    if (!window.confirm(confirmation)) return
    setWorkspaceError('')
    try {
      await deleteWorkspace(workspace.id)
      if (activeWorkspace?.id === workspace.id) queryClient.clear()
      await loadArchivedWorkspaces()
    } catch (error) {
      setWorkspaceError(error.response?.data?.error?.message || t('common.error'))
    }
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <a href="#main-content" className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-[70] focus:rounded-md focus:bg-white focus:px-4 focus:py-2 focus:text-primary-700 focus:shadow-md">
        {t('nav.skipToContent', { defaultValue: 'Pular para o conteúdo' })}
      </a>
      {/* Mobile sidebar backdrop */}
      {sidebarOpen && (
        <div 
          className="fixed inset-0 bg-black/50 z-40 lg:hidden"
          onClick={() => setSidebarOpen(false)}
        />
      )}

      {/* Sidebar */}
      <aside className={cn(
        "fixed inset-y-0 left-0 z-50 w-64 bg-primary-600 text-white border-r border-primary-700 transform transition-transform lg:translate-x-0",
        sidebarOpen ? "translate-x-0" : "-translate-x-full"
      )}>
        <div className="flex flex-col h-full">
          {/* Logo */}
          <div className="flex items-center justify-between h-20 px-5 border-b border-white/15">
            <img src="/logos/assessoria-carvalho.svg" alt={BRAND.name} className="h-12 w-48 object-contain object-left" />
            <button 
              className="lg:hidden p-1 rounded hover:bg-white/10"
              onClick={() => setSidebarOpen(false)}
            >
              <X className="w-5 h-5" />
            </button>
          </div>

          {/* Navigation */}
          <nav id="primary-navigation" aria-label={t('nav.main', { defaultValue: 'Navegação principal' })} className="flex-1 px-3 py-4 space-y-1 overflow-y-auto">
            {visibleNavigation.map((item) => (
              <NavLink
                key={item.href}
                to={item.href}
                end={item.href === '/'}
                className={({ isActive }) => cn(
                  "flex items-center gap-3 px-3 py-2 rounded-lg text-sm font-medium transition-colors",
                  isActive
                    ? "bg-white/15 text-white"
                    : "text-white/80 hover:bg-white/10 hover:text-white"
                )}
                onClick={() => setSidebarOpen(false)}
              >
                <item.icon className="w-5 h-5" />
                {t(item.name)}
              </NavLink>
            ))}

            {/* Admin section - super_admin and group admins */}
            {(user?.role === 'super_admin' || isGroupAdmin) && (
              <>
                <div className="border-t border-white/15 my-3" />
                <p className="px-3 text-xs font-semibold text-white/50 uppercase tracking-wider mb-1 flex items-center gap-2">
                  <Shield className="w-3.5 h-3.5" />
                  {t('nav.administration')}
                </p>
                {adminNavigation
                  .filter((item) => {
                    // Group admins only see Groups link
                    if (user?.role === 'super_admin') return true
                    return item.href === '/admin/groups'
                  })
                  .map((item) => (
                  <NavLink
                    key={item.href}
                    to={item.href}
                    className={({ isActive }) => cn(
                      "flex items-center gap-3 px-3 py-2 rounded-lg text-sm font-medium transition-colors",
                      isActive
                        ? "bg-white/15 text-white"
                        : "text-white/80 hover:bg-white/10 hover:text-white"
                    )}
                    onClick={() => setSidebarOpen(false)}
                  >
                    <item.icon className="w-5 h-5" />
                    {t(item.name)}
                  </NavLink>
                ))}
              </>
            )}
          </nav>

          {/* Version */}
          <div className="mx-4 mb-2 px-3 py-1.5 rounded-lg text-center">
            <span className="text-xs text-white/50 font-medium tracking-wide">{BRAND.name} v{__APP_VERSION__}</span>
          </div>

          {/* User */}
          <div className="p-4 border-t border-white/15">
            <div className="flex items-center gap-3">
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-white truncate">
                  {user?.fullName || user?.email}
                </p>
                <p className="text-xs text-white/60 truncate">{user?.email}</p>
              </div>
              <button
                onClick={handleLogout}
                className="p-2 text-white/60 hover:text-white rounded-lg hover:bg-white/10"
                title={t('nav.logout')}
              >
                <LogOut className="w-5 h-5" />
              </button>
            </div>
          </div>
        </div>
      </aside>

      {/* Main content */}
      <div className="lg:pl-64">
        {/* Top bar */}
        <header className="sticky top-0 z-30 bg-white border-b border-gray-200">
          <div className="flex items-center h-16 px-4 gap-4">
            <button 
              className="lg:hidden p-2 rounded-lg hover:bg-gray-100"
              onClick={() => setSidebarOpen(true)}
            >
              <Menu className="w-5 h-5" />
            </button>
            <div className="ml-auto flex min-w-0 items-center gap-2">
              <Building2 className="hidden h-4 w-4 shrink-0 text-gray-500 sm:block" />
              <label htmlFor="active-workspace" className="sr-only">{t('workspaces.current', { defaultValue: 'Cliente atual' })}</label>
              <select
                id="active-workspace"
                value={activeWorkspace?.id || ''}
                onChange={handleWorkspaceChange}
                disabled={switchingWorkspace}
                className="input h-10 max-w-[min(52vw,240px)] py-1 text-sm"
                aria-label={t('workspaces.current', { defaultValue: 'Cliente atual' })}
              >
                {workspaces.map((workspace) => (
                  <option key={workspace.id} value={workspace.id}>
                    {workspace.isPersonal ? t('workspaces.personal', { defaultValue: 'Meu espaço' }) : workspace.name}
                    {!workspace.isActive ? ` (${t('common.inactive')})` : ''}
                  </option>
                ))}
              </select>
              <button
                type="button"
                onClick={() => setShowNewClient(true)}
                className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-md border border-gray-300 text-gray-600 hover:bg-gray-50"
                title={t('workspaces.add', { defaultValue: 'Adicionar cliente' })}
                aria-label={t('workspaces.add', { defaultValue: 'Adicionar cliente' })}
              >
                <Plus className="h-4 w-4" />
              </button>
              <button
                type="button"
                onClick={toggleTheme}
                className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-md border border-gray-300 text-gray-600 hover:bg-gray-50"
                title={theme === 'dark' ? t('theme.light', { defaultValue: 'Tema claro' }) : t('theme.dark', { defaultValue: 'Tema escuro' })}
                aria-label={theme === 'dark' ? t('theme.light', { defaultValue: 'Tema claro' }) : t('theme.dark', { defaultValue: 'Tema escuro' })}
              >
                {theme === 'dark' ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
              </button>
              {(
                <button
                  type="button"
                  onClick={openManageClients}
                  className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-md border border-gray-300 text-gray-600 hover:bg-gray-50"
                  title={t('workspaces.manage', { defaultValue: 'Gerir clientes' })}
                  aria-label={t('workspaces.manage', { defaultValue: 'Gerir clientes' })}
                >
                  <Settings2 className="h-4 w-4" />
                </button>
              )}
            </div>
          </div>
        </header>

        {/* Page content */}
        <main id="main-content" tabIndex={-1} className="p-4 lg:p-6 focus:outline-none">
          {workspaceError && !showNewClient && !showManageClients && <p role="alert" className="mb-4 text-sm text-red-600">{workspaceError}</p>}
          {activeWorkspace && activeWorkspace.isActive === false && (
            <p role="status" className="mb-4 flex items-center gap-2 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">
              <Lock className="h-4 w-4 shrink-0" />
              {t('workspaces.inactiveNotice', { defaultValue: 'Cliente inativo: relatórios e histórico ficam disponíveis para consulta, mas não é possível fazer novos lançamentos.' })}
            </p>
          )}
          {activeWorkspace?.finance && !activeWorkspace.finance.actor && (
            <p role="alert" className="mb-4 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
              {t('workspaces.noFinanceAccess', { defaultValue: 'Seu papel neste cliente não dá acesso ao módulo financeiro. Fale com o administrador.' })}
            </p>
          )}
          <Outlet />
        </main>
      </div>

      {showNewClient && (
        <Modal onClose={() => setShowNewClient(false)}>
          <section className="w-full max-w-md rounded-lg bg-white p-6 shadow-xl" role="dialog" aria-modal="true" aria-labelledby="new-client-title">
            <div className="mb-5 flex items-center justify-between">
              <h2 id="new-client-title" className="text-lg font-semibold">{t('workspaces.newTitle', { defaultValue: 'Novo cliente' })}</h2>
              <button type="button" onClick={() => setShowNewClient(false)} className="rounded p-1 text-gray-500 hover:bg-gray-100" aria-label={t('common.close', { defaultValue: 'Fechar' })}>
                <X className="h-5 w-5" />
              </button>
            </div>
            <form onSubmit={handleCreateWorkspace} className="space-y-4">
              <div>
                <label htmlFor="client-name" className="mb-1 block text-sm font-medium text-gray-700">{t('workspaces.name', { defaultValue: 'Nome do cliente' })}</label>
                <input id="client-name" autoFocus required maxLength={120} value={newClient.name} onChange={(event) => setNewClient({ ...newClient, name: event.target.value })} className="input" />
              </div>
              <div>
                <label htmlFor="new-client-notes" className="mb-1 block text-sm font-medium text-gray-700">{t('workspaces.notes', { defaultValue: 'Notas do cliente' })}</label>
                <textarea id="new-client-notes" rows={3} maxLength={5000} value={newClient.notes} onChange={(event) => setNewClient({ ...newClient, notes: event.target.value })} className="input resize-y" placeholder={t('workspaces.notesPlaceholder', { defaultValue: 'Prazos, contatos e orientações de atendimento' })} />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label htmlFor="client-locale" className="mb-1 block text-sm font-medium text-gray-700">{t('settings.preferences.language', { defaultValue: 'Idioma' })}</label>
                  <select id="client-locale" value={newClient.locale} onChange={(event) => setNewClient({ ...newClient, locale: event.target.value, currency: event.target.value === 'pt' ? 'BRL' : newClient.currency })} className="input">
                    <option value="pt">Português (Brasil)</option>
                    <option value="en">English</option>
                    <option value="es">Español</option>
                    <option value="fr">Français</option>
                  </select>
                </div>
                <div>
                  <label htmlFor="client-currency" className="mb-1 block text-sm font-medium text-gray-700">{t('settings.preferences.currency', { defaultValue: 'Moeda' })}</label>
                  <select id="client-currency" value={newClient.currency} onChange={(event) => setNewClient({ ...newClient, currency: event.target.value })} className="input">
                    <option value="BRL">BRL - Real brasileiro</option>
                    <option value="EUR">EUR - Euro</option>
                    <option value="USD">USD - Dólar americano</option>
                    <option value="GBP">GBP - Libra esterlina</option>
                    <option value="CAD">CAD - Dólar canadense</option>
                    <option value="CHF">CHF - Franco suíço</option>
                  </select>
                </div>
              </div>
              {workspaceError && <p role="alert" className="text-sm text-red-600">{workspaceError}</p>}
              <div className="flex justify-end gap-2 pt-2">
                <button type="button" onClick={() => setShowNewClient(false)} className="btn btn-secondary">{t('common.cancel', { defaultValue: 'Cancelar' })}</button>
                <button type="submit" disabled={creatingWorkspace} className="btn btn-primary disabled:opacity-60">
                  {creatingWorkspace ? t('common.saving', { defaultValue: 'Salvando...' }) : t('workspaces.create', { defaultValue: 'Criar cliente' })}
                </button>
              </div>
            </form>
          </section>
        </Modal>
      )}

      {showManageClients && (
        <Modal onClose={() => setShowManageClients(false)}>
          <section className="w-full max-w-xl rounded-lg bg-white p-6 shadow-xl" role="dialog" aria-modal="true" aria-labelledby="manage-clients-title">
            <div className="mb-4 flex items-center justify-between">
              <h2 id="manage-clients-title" className="text-lg font-semibold">{t('workspaces.manage', { defaultValue: 'Gerir clientes' })}</h2>
              <button type="button" onClick={() => setShowManageClients(false)} className="rounded p-1 text-gray-500 hover:bg-gray-100" aria-label={t('common.close', { defaultValue: 'Fechar' })}>
                <X className="h-5 w-5" />
              </button>
            </div>
            {workspaceError && <p role="alert" className="mb-3 text-sm text-red-600">{workspaceError}</p>}
            <div className="max-h-[60vh] divide-y overflow-y-auto">
              {workspaces.filter((workspace) => !workspace.isPersonal).map((workspace) => {
                const notes = clientNoteDrafts[workspace.id] ?? workspace.notes ?? ''
                const notesChanged = notes !== (workspace.notes ?? '')
                return (
                  <div key={workspace.id} className="flex flex-wrap items-center justify-between gap-3 py-3">
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium text-gray-900">{workspace.name}</p>
                      <p className={`mt-0.5 text-xs ${workspace.isActive ? 'text-green-700' : 'text-gray-500'}`}>
                        {workspace.isActive ? t('common.active') : t('common.inactive')}
                      </p>
                    </div>
                    <div className="flex flex-wrap items-center gap-2">
                      {workspace.role === 'owner' && (workspace.isActive ? (
                        <button type="button" onClick={() => handleDeactivateWorkspace(workspace)} className="inline-flex items-center gap-1.5 rounded-md border border-gray-300 px-2.5 py-1.5 text-sm text-gray-700 hover:bg-gray-50">
                          <Archive className="h-4 w-4" />{t('workspaces.deactivate', { defaultValue: 'Desativar' })}
                        </button>
                      ) : (
                        <button type="button" onClick={() => handleReactivateWorkspace(workspace)} className="inline-flex items-center gap-1.5 rounded-md border border-gray-300 px-2.5 py-1.5 text-sm text-gray-700 hover:bg-gray-50">
                          <RotateCcw className="h-4 w-4" />{t('workspaces.reactivate', { defaultValue: 'Reativar' })}
                        </button>
                      ))}
                      {workspace.role === 'owner' && (
                        <button
                          type="button"
                          onClick={() => setMembersWorkspaceId(membersWorkspaceId === workspace.id ? null : workspace.id)}
                          aria-expanded={membersWorkspaceId === workspace.id}
                          className="inline-flex items-center gap-1.5 rounded-md border border-gray-300 px-2.5 py-1.5 text-sm text-gray-700 hover:bg-gray-50"
                        >
                          <UserCog className="h-4 w-4" />{t('workspaces.manageMembers', { defaultValue: 'Acessos' })}
                        </button>
                      )}
                      {workspace.role === 'owner' && (
                        <button type="button" onClick={() => handleDeleteWorkspace(workspace)} className="inline-flex items-center gap-1.5 rounded-md border border-red-200 px-2.5 py-1.5 text-sm text-red-700 hover:bg-red-50">
                          <Trash2 className="h-4 w-4" />{t('workspaces.delete', { defaultValue: 'Excluir' })}
                        </button>
                      )}
                    </div>
                    {membersWorkspaceId === workspace.id && (
                      <div className="w-full basis-full">
                        <WorkspaceMembers workspace={workspace} />
                      </div>
                    )}
                    <div className="w-full basis-full">
                      <label htmlFor={`client-notes-${workspace.id}`} className="mb-1 block text-sm font-medium text-gray-700">{t('workspaces.notes', { defaultValue: 'Notas do cliente' })}</label>
                      <div className="flex items-end gap-2">
                        <textarea
                          id={`client-notes-${workspace.id}`}
                          rows={2}
                          maxLength={5000}
                          readOnly={workspace.role !== 'owner'}
                          value={notes}
                          onChange={(event) => setClientNoteDrafts((current) => ({ ...current, [workspace.id]: event.target.value }))}
                          className="input min-h-16 resize-y"
                          placeholder={t('workspaces.notesPlaceholder', { defaultValue: 'Prazos, contatos e orientações de atendimento' })}
                        />
                        {workspace.role === 'owner' && (
                          <button
                            type="button"
                            onClick={() => handleSaveWorkspaceNotes(workspace)}
                            disabled={!notesChanged || savingNotesWorkspace === workspace.id}
                            className="btn btn-primary inline-flex shrink-0 items-center gap-2 disabled:cursor-not-allowed disabled:opacity-50"
                          >
                            <Save className="h-4 w-4" />
                            {savingNotesWorkspace === workspace.id ? t('common.saving') : t('common.save')}
                          </button>
                        )}
                      </div>
                    </div>
                  </div>
                )
              })}
              {archivedWorkspaces.length > 0 && (
                <div className="py-3">
                  <p className="mb-2 text-sm font-medium text-gray-700">{t('workspaces.archived', { defaultValue: 'Arquivados' })}</p>
                  <p className="mb-2 text-xs text-gray-500">
                    {t('workspaces.archivedHint', { days: retentionDays, defaultValue: `Clientes excluídos ficam ${retentionDays} dias aqui antes de serem apagados.` })}
                  </p>
                  <ul className="space-y-2">
                    {archivedWorkspaces.map((workspace) => (
                      <li key={workspace.id} className="flex items-center justify-between gap-2 text-sm">
                        <span className="truncate">{workspace.name}</span>
                        <button type="button" onClick={() => handleRestoreWorkspace(workspace)} className="inline-flex items-center gap-1.5 rounded-md border border-gray-300 px-2.5 py-1.5 text-sm text-gray-700 hover:bg-gray-50">
                          <RotateCcw className="h-4 w-4" />{t('workspaces.restore', { defaultValue: 'Restaurar' })}
                        </button>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          </section>
        </Modal>
      )}
    </div>
  )
}
