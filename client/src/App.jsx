import { Routes, Route, Navigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { useAuth } from './contexts/AuthContext'
import Layout from './components/Layout'
import Login from './pages/Login'
import Register from './pages/Register'
import Dashboard from './pages/Dashboard'
import Accounts from './pages/Accounts'
import Transactions from './pages/Transactions'
import CreditCards from './pages/CreditCards'
import Categories from './pages/Categories'
import Reports from './pages/Reports'
import Import from './pages/Import'
import PlannedTransactions from './pages/PlannedTransactions'
import Rules from './pages/Rules'
import Settings from './pages/Settings'
import Payees from './pages/Payees'
import AdminUsers from './pages/AdminUsers'
import AdminGroups from './pages/AdminGroups'
import AdminSettings from './pages/AdminSettings'
import Forecast from './pages/Forecast'
import Invoices from './pages/Invoices'
import CardSales from './pages/CardSales'
import BankEntries from './pages/BankEntries'
import Recurrences from './pages/Recurrences'
import Revenues from './pages/Revenues'
import ForgotPassword from './pages/ForgotPassword'
import ResetPassword from './pages/ResetPassword'

function PrivateRoute({ children }) {
  const { user, needsSetup, loading } = useAuth()

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary-600"></div>
      </div>
    )
  }

  if (!user) {
    return needsSetup ? <Navigate to="/register" /> : <Navigate to="/login" />
  }

  return children
}

function AdminRoute({ children }) {
  const { user, loading } = useAuth()

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary-600"></div>
      </div>
    )
  }

  if (!user) return <Navigate to="/login" />
  if (user.role !== 'super_admin') return <Navigate to="/" />

  return children
}

function GroupAdminRoute({ children }) {
  const { user, isGroupAdmin, loading } = useAuth()

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary-600"></div>
      </div>
    )
  }

  if (!user) return <Navigate to="/login" />
  if (user.role !== 'super_admin' && !isGroupAdmin) return <Navigate to="/" />

  return children
}

/** Direct access to a finance screen also respects the module permissions (RF-IN-02). */
function FinanceRoute({ permission, action = 'ver', children }) {
  const { can } = useAuth()
  const { t } = useTranslation()
  if (can && !can(permission, action)) {
    return (
      <div role="alert" className="rounded-md border border-gray-200 bg-white p-6 text-sm text-gray-700">
        {t('common.noPermission', { defaultValue: 'Você não tem permissão para acessar esta tela.' })}
      </div>
    )
  }
  return children
}

function LoginRoute() {
  const { user, needsSetup, loading } = useAuth()

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary-600"></div>
      </div>
    )
  }

  if (user) return <Navigate to="/" />
  if (needsSetup) return <Navigate to="/register" />

  return <Login />
}

function App() {
  return (
    <Routes>
      <Route path="/login" element={<LoginRoute />} />
      <Route path="/register" element={<Register />} />
      <Route path="/forgot-password" element={<ForgotPassword />} />
      <Route path="/reset-password" element={<ResetPassword />} />
      <Route path="/" element={<PrivateRoute><Layout /></PrivateRoute>}>
        <Route index element={<FinanceRoute permission="financeiro.visao_geral"><Dashboard /></FinanceRoute>} />
        <Route path="accounts" element={<FinanceRoute permission="financeiro.contas"><Accounts /></FinanceRoute>} />
        <Route path="transactions" element={<FinanceRoute permission="financeiro.faturas"><Transactions /></FinanceRoute>} />
        <Route path="forecast" element={<FinanceRoute permission="financeiro.relatorios"><Forecast /></FinanceRoute>} />
        <Route path="credit-cards" element={<FinanceRoute permission="financeiro.cartoes"><CreditCards /></FinanceRoute>} />
        <Route path="invoices" element={<FinanceRoute permission="financeiro.faturas"><Invoices /></FinanceRoute>} />
        <Route path="card-sales" element={<FinanceRoute permission="financeiro.vendas_cartao"><CardSales /></FinanceRoute>} />
        <Route path="bank-entries" element={<FinanceRoute permission="financeiro.entradas"><BankEntries /></FinanceRoute>} />
        <Route path="recurrences" element={<FinanceRoute permission="financeiro.recorrencias"><Recurrences /></FinanceRoute>} />
        <Route path="revenues" element={<FinanceRoute permission="financeiro.receitas"><Revenues /></FinanceRoute>} />
        <Route path="categories" element={<FinanceRoute permission="financeiro.relatorios.config" action="editar"><Categories /></FinanceRoute>} />
        <Route path="reports" element={<FinanceRoute permission="financeiro.relatorios"><Reports /></FinanceRoute>} />
        <Route path="import" element={<FinanceRoute permission="financeiro.entradas" action="criar"><Import /></FinanceRoute>} />
        <Route path="planned" element={<FinanceRoute permission="financeiro.recorrencias"><PlannedTransactions /></FinanceRoute>} />
        <Route path="rules" element={<FinanceRoute permission="financeiro.relatorios.config" action="editar"><Rules /></FinanceRoute>} />
        <Route path="payees" element={<FinanceRoute permission="financeiro.relatorios.config" action="editar"><Payees /></FinanceRoute>} />
        <Route path="settings" element={<Settings />} />
        <Route path="admin/users" element={<AdminRoute><AdminUsers /></AdminRoute>} />
        <Route path="admin/groups" element={<GroupAdminRoute><AdminGroups /></GroupAdminRoute>} />
        <Route path="admin/settings" element={<AdminRoute><AdminSettings /></AdminRoute>} />
      </Route>
    </Routes>
  )
}

export default App
