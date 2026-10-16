/**
 * @fileoverview Admin system settings page
 * Provides system-level configuration: public registration toggle, default group
 */

import { useState, useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { adminApi, groupsApi } from '../lib/api'
import { translateError } from '../lib/errorHelper'
import { Cog, Save, Mail, Send, CheckCircle, XCircle, Wrench, Trash2, Search, AlertTriangle } from 'lucide-react'
import FormLanguageSelect from '../components/FormLanguageSelect'
import ConfirmModal from '../components/ConfirmModal'
import { useToast } from '../components/Toast'

/**
 * Admin system settings page
 * Allows super_admin to configure public registration and default group
 */
export default function AdminSettings() {
  const { t } = useTranslation()
  const [formData, setFormData] = useState({
    publicRegistration: false,
    defaultGroupId: '',
    defaultLocale: 'pt',
    defaultDecimalSeparator: ',',
    defaultDigitGrouping: ' ',
  })
  const [smtpData, setSmtpData] = useState({
    smtpHost: '',
    smtpPort: '587',
    smtpSecure: false,
    smtpUser: '',
    smtpPass: '',
    smtpFrom: '',
    appUrl: '',
  })
  const [dirty, setDirty] = useState(false)
  const [smtpDirty, setSmtpDirty] = useState(false)
  const [smtpTestResult, setSmtpTestResult] = useState(null)
  const [duplicatesPreview, setDuplicatesPreview] = useState(null)
  const [cleanupConfirmOpen, setCleanupConfirmOpen] = useState(false)
  const queryClient = useQueryClient()
  const toast = useToast()

  const { data: settingsData, isLoading: settingsLoading } = useQuery({
    queryKey: ['admin-settings'],
    queryFn: () => adminApi.getSettings().then(r => r.data),
  })

  const { data: smtpSettingsData } = useQuery({
    queryKey: ['admin-smtp-settings'],
    queryFn: () => adminApi.getSmtpSettings().then(r => r.data),
  })

  const { data: groupsData } = useQuery({
    queryKey: ['admin-groups'],
    queryFn: () => groupsApi.getAll().then(r => r.data),
  })

  // Sync form data with server data
  useEffect(() => {
    if (settingsData?.data) {
      setFormData({
        publicRegistration: settingsData.data.allowPublicRegistration ?? false,
        defaultGroupId: settingsData.data.defaultRegistrationGroupId || '',
        defaultLocale: settingsData.data.defaultLocale || 'pt',
        defaultDecimalSeparator: settingsData.data.defaultDecimalSeparator || ',',
        defaultDigitGrouping: settingsData.data.defaultDigitGrouping || ' ',
      })
      setDirty(false)
    }
  }, [settingsData])

  // Sync SMTP data
  useEffect(() => {
    if (smtpSettingsData?.data) {
      setSmtpData({
        smtpHost: smtpSettingsData.data.smtpHost || '',
        smtpPort: smtpSettingsData.data.smtpPort || '587',
        smtpSecure: smtpSettingsData.data.smtpSecure ?? false,
        smtpUser: smtpSettingsData.data.smtpUser || '',
        smtpPass: smtpSettingsData.data.smtpPass || '',
        smtpFrom: smtpSettingsData.data.smtpFrom || '',
        appUrl: smtpSettingsData.data.appUrl || '',
      })
      setSmtpDirty(false)
    }
  }, [smtpSettingsData])

  const updateMutation = useMutation({
    mutationFn: adminApi.updateSettings,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin-settings'] })
      setDirty(false)
      toast.success(t('admin.settings.saved'))
    },
    onError: (err) => {
      toast.error(translateError(err))
    },
  })

  const smtpUpdateMutation = useMutation({
    mutationFn: adminApi.updateSmtpSettings,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin-smtp-settings'] })
      setSmtpDirty(false)
      toast.success(t('admin.smtp.saved'))
    },
    onError: (err) => {
      toast.error(translateError(err))
    },
  })

  const smtpTestMutation = useMutation({
    mutationFn: adminApi.testSmtpConnection,
    onSuccess: () => {
      setSmtpTestResult('success')
      toast.success(t('admin.smtp.testSuccess'))
    },
    onError: (err) => {
      setSmtpTestResult('error')
      toast.error(translateError(err) || t('admin.smtp.testFail'))
    },
  })

  const duplicatesPreviewMutation = useMutation({
    mutationFn: adminApi.previewRecurringDuplicates,
    onSuccess: (res) => {
      setDuplicatesPreview(res.data?.data || null)
    },
    onError: (err) => {
      toast.error(translateError(err))
    },
  })

  const duplicatesCleanupMutation = useMutation({
    mutationFn: adminApi.cleanupRecurringDuplicates,
    onSuccess: (res) => {
      const result = res.data?.data
      toast.success(t('admin.duplicates.cleanupSuccess', { count: result?.deleted ?? 0 }))
      // Refresh preview so the user sees the updated state
      duplicatesPreviewMutation.mutate()
      // Invalidate transaction-related queries so other pages reflect the deletions
      queryClient.invalidateQueries({ queryKey: ['transactions'] })
      queryClient.invalidateQueries({ queryKey: ['accounts'] })
      queryClient.invalidateQueries({ queryKey: ['dashboard'] })
    },
    onError: (err) => {
      toast.error(translateError(err))
    },
  })

  const handleCleanupDuplicates = () => {
    const total = duplicatesPreview?.totalDuplicates ?? 0
    if (!total) return
    setCleanupConfirmOpen(true)
  }

  const handleSmtpChange = (key, value) => {
    setSmtpData((prev) => ({ ...prev, [key]: value }))
    setSmtpDirty(true)
    setSmtpTestResult(null)
  }

  const handleSmtpSubmit = (e) => {
    e.preventDefault()
    smtpUpdateMutation.mutate(smtpData)
  }

  const handleChange = (key, value) => {
    setFormData((prev) => ({ ...prev, [key]: value }))
    setDirty(true)
  }

  const handleSubmit = (e) => {
    e.preventDefault()
    const data = {
      allowPublicRegistration: formData.publicRegistration,
      defaultRegistrationGroupId: formData.defaultGroupId || null,
      defaultLocale: formData.defaultLocale,
      defaultDecimalSeparator: formData.defaultDecimalSeparator,
      defaultDigitGrouping: formData.defaultDigitGrouping,
    }
    updateMutation.mutate(data)
  }

  const groups = groupsData?.data || []

  if (settingsLoading) {
    return (
      <div className="flex justify-center py-12">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary-600"></div>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold text-gray-900">{t('admin.settings.title')}</h1>
        <p className="text-gray-600">{t('admin.settings.subtitle')}</p>
      </div>

      {/* Settings form */}
      <form onSubmit={handleSubmit} className="card max-w-2xl space-y-6">
        <div className="flex items-center gap-3 pb-4 border-b">
          <div className="w-10 h-10 rounded-lg bg-primary-100 flex items-center justify-center">
            <Cog className="w-5 h-5 text-primary-600" />
          </div>
          <div>
            <h2 className="font-semibold text-gray-900">{t('admin.settings.generalConfig')}</h2>
            <p className="text-sm text-gray-500">{t('admin.settings.configSubtitle')}</p>
          </div>
        </div>

        {/* Public registration toggle */}
        <div className="flex items-center justify-between">
          <div>
            <label className="text-sm font-medium text-gray-900">{t('admin.settings.publicRegistration')}</label>
            <p className="text-sm text-gray-500">
              {t('admin.settings.publicRegistrationDesc')}
            </p>
          </div>
          <button
            type="button"
            onClick={() => handleChange('publicRegistration', !formData.publicRegistration)}
            className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${
              formData.publicRegistration ? 'bg-primary-600' : 'bg-gray-300'
            }`}
          >
            <span
              className={`inline-block h-4 w-4 transform rounded-full bg-[#fff] transition-transform ${
                formData.publicRegistration ? 'translate-x-6' : 'translate-x-1'
              }`}
            />
          </button>
        </div>

        {/* Default group */}
        <div>
          <label className="block text-sm font-medium text-gray-900 mb-1">
            {t('admin.settings.defaultGroup')}
          </label>
          <p className="text-sm text-gray-500 mb-2">
            {t('admin.settings.defaultGroupDesc')}
          </p>
          <select
            value={formData.defaultGroupId}
            onChange={(e) => handleChange('defaultGroupId', e.target.value)}
            className="input max-w-md"
          >
            <option value="">{t('admin.settings.noDefaultGroup')}</option>
            {groups.map((g) => (
              <option key={g.id} value={g.id}>{g.name}</option>
            ))}
          </select>
        </div>

        {/* Default locale */}
        <div>
          <label className="block text-sm font-medium text-gray-900 mb-1">
            {t('admin.settings.defaultLocale')}
          </label>
          <p className="text-sm text-gray-500 mb-2">
            {t('admin.settings.defaultLocaleDesc')}
          </p>
          <FormLanguageSelect
            value={formData.defaultLocale}
            onChange={(locale) => handleChange('defaultLocale', locale)}
            className="max-w-md"
          />
        </div>

        {/* Default decimal separator */}
        <div>
          <label className="block text-sm font-medium text-gray-900 mb-1">
            {t('admin.settings.defaultDecimalSeparator')}
          </label>
          <p className="text-sm text-gray-500 mb-2">
            {t('admin.settings.defaultDecimalSeparatorDesc')}
          </p>
          <select
            value={formData.defaultDecimalSeparator}
            onChange={(e) => handleChange('defaultDecimalSeparator', e.target.value)}
            className="input max-w-md"
          >
            <option value=",">{t('settings.preferences.decimalSeparators.comma')}</option>
            <option value=".">{t('settings.preferences.decimalSeparators.dot')}</option>
          </select>
        </div>

        {/* Default digit grouping */}
        <div>
          <label className="block text-sm font-medium text-gray-900 mb-1">
            {t('admin.settings.defaultDigitGrouping')}
          </label>
          <p className="text-sm text-gray-500 mb-2">
            {t('admin.settings.defaultDigitGroupingDesc')}
          </p>
          <select
            value={formData.defaultDigitGrouping}
            onChange={(e) => handleChange('defaultDigitGrouping', e.target.value)}
            className="input max-w-md"
          >
            <option value=" ">{t('settings.preferences.digitGroupings.space')}</option>
            <option value=",">{t('settings.preferences.digitGroupings.comma')}</option>
            <option value=".">{t('settings.preferences.digitGroupings.dot')}</option>
            <option value="">{t('settings.preferences.digitGroupings.none')}</option>
          </select>
        </div>

        {/* Save button */}
        <div className="pt-4 border-t">
          <button
            type="submit"
            disabled={!dirty || updateMutation.isPending}
            className="btn btn-primary flex items-center gap-2 disabled:opacity-50"
          >
            <Save className="w-4 h-4" />
            {updateMutation.isPending ? t('admin.settings.saving') : t('common.save')}
          </button>
        </div>
      </form>

      {/* SMTP Settings */}
      <form onSubmit={handleSmtpSubmit} className="card max-w-2xl space-y-6">
        <div className="flex items-center gap-3 pb-4 border-b">
          <div className="w-10 h-10 rounded-lg bg-primary-100 flex items-center justify-center">
            <Mail className="w-5 h-5 text-primary-600" />
          </div>
          <div>
            <h2 className="font-semibold text-gray-900">{t('admin.smtp.title')}</h2>
            <p className="text-sm text-gray-500">{t('admin.smtp.subtitle')}</p>
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <label className="block text-sm font-medium text-gray-900 mb-1">
              {t('admin.smtp.host')}
            </label>
            <input
              type="text"
              value={smtpData.smtpHost}
              onChange={(e) => handleSmtpChange('smtpHost', e.target.value)}
              className="input"
              placeholder="smtp.example.com"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-900 mb-1">
              {t('admin.smtp.port')}
            </label>
            <input
              type="number"
              value={smtpData.smtpPort}
              onChange={(e) => handleSmtpChange('smtpPort', e.target.value)}
              className="input"
              placeholder="587"
            />
          </div>
        </div>

        <div className="flex items-center justify-between">
          <div>
            <label className="text-sm font-medium text-gray-900">{t('admin.smtp.secure')}</label>
            <p className="text-sm text-gray-500">{t('admin.smtp.secureDesc')}</p>
          </div>
          <button
            type="button"
            onClick={() => handleSmtpChange('smtpSecure', !smtpData.smtpSecure)}
            className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${
              smtpData.smtpSecure ? 'bg-primary-600' : 'bg-gray-300'
            }`}
          >
            <span
              className={`inline-block h-4 w-4 transform rounded-full bg-[#fff] transition-transform ${
                smtpData.smtpSecure ? 'translate-x-6' : 'translate-x-1'
              }`}
            />
          </button>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <label className="block text-sm font-medium text-gray-900 mb-1">
              {t('admin.smtp.user')}
            </label>
            <input
              type="text"
              value={smtpData.smtpUser}
              onChange={(e) => handleSmtpChange('smtpUser', e.target.value)}
              className="input"
              placeholder="user@example.com"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-900 mb-1">
              {t('admin.smtp.password')}
            </label>
            <input
              type="password"
              value={smtpData.smtpPass}
              onChange={(e) => handleSmtpChange('smtpPass', e.target.value)}
              className="input"
              placeholder="••••••••"
            />
          </div>
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-900 mb-1">
            {t('admin.smtp.from')}
          </label>
          <input
            type="text"
            value={smtpData.smtpFrom}
            onChange={(e) => handleSmtpChange('smtpFrom', e.target.value)}
            className="input max-w-md"
            placeholder="Carvalho <noreply@example.com>"
          />
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-900 mb-1">
            {t('admin.smtp.appUrl')}
          </label>
          <p className="text-sm text-gray-500 mb-2">
            {t('admin.smtp.appUrlDesc')}
          </p>
          <input
            type="url"
            value={smtpData.appUrl}
            onChange={(e) => handleSmtpChange('appUrl', e.target.value)}
            className="input max-w-md"
            placeholder="https://carvalho.example.com"
          />
        </div>

        <div className="pt-4 border-t flex items-center gap-3">
          <button
            type="submit"
            disabled={!smtpDirty || smtpUpdateMutation.isPending}
            className="btn btn-primary flex items-center gap-2 disabled:opacity-50"
          >
            <Save className="w-4 h-4" />
            {smtpUpdateMutation.isPending ? t('admin.settings.saving') : t('common.save')}
          </button>
          <button
            type="button"
            onClick={() => smtpTestMutation.mutate()}
            disabled={smtpTestMutation.isPending || !smtpData.smtpHost}
            className="btn flex items-center gap-2 disabled:opacity-50"
          >
            {smtpTestMutation.isPending ? (
              <div className="w-4 h-4 border-2 border-gray-400/30 border-t-gray-400 rounded-full animate-spin" />
            ) : smtpTestResult === 'success' ? (
              <CheckCircle className="w-4 h-4 text-green-600" />
            ) : smtpTestResult === 'error' ? (
              <XCircle className="w-4 h-4 text-red-600" />
            ) : (
              <Send className="w-4 h-4" />
            )}
            {t('admin.smtp.testButton')}
          </button>
        </div>
      </form>

      {/* Maintenance: recurring duplicates */}
      <div className="card max-w-2xl space-y-4">
        <div className="flex items-center gap-3 pb-4 border-b">
          <div className="w-10 h-10 rounded-lg bg-amber-100 flex items-center justify-center">
            <Wrench className="w-5 h-5 text-amber-600" />
          </div>
          <div>
            <h2 className="font-semibold text-gray-900">{t('admin.duplicates.title')}</h2>
            <p className="text-sm text-gray-500">{t('admin.duplicates.subtitle')}</p>
          </div>
        </div>

        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={() => duplicatesPreviewMutation.mutate()}
            disabled={duplicatesPreviewMutation.isPending}
            className="btn flex items-center gap-2 disabled:opacity-50"
          >
            {duplicatesPreviewMutation.isPending ? (
              <div className="w-4 h-4 border-2 border-gray-400/30 border-t-gray-400 rounded-full animate-spin" />
            ) : (
              <Search className="w-4 h-4" />
            )}
            {t('admin.duplicates.analyze')}
          </button>
          {duplicatesPreview && duplicatesPreview.totalDuplicates > 0 && (
            <button
              type="button"
              onClick={handleCleanupDuplicates}
              disabled={duplicatesCleanupMutation.isPending}
              className="btn bg-red-600 hover:bg-red-700 text-white flex items-center gap-2 disabled:opacity-50"
            >
              {duplicatesCleanupMutation.isPending ? (
                <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
              ) : (
                <Trash2 className="w-4 h-4" />
              )}
              {t('admin.duplicates.cleanup', { count: duplicatesPreview.totalDuplicates })}
            </button>
          )}
        </div>

        {duplicatesPreview && (
          <div className="space-y-3">
            {duplicatesPreview.totalDuplicates === 0 ? (
              <div className="flex items-center gap-2 text-sm text-green-700 bg-green-50 border border-green-200 rounded-lg p-3">
                <CheckCircle className="w-4 h-4" />
                <span>{t('admin.duplicates.noDuplicates')}</span>
              </div>
            ) : (
              <>
                <div className="flex items-start gap-2 text-sm text-amber-800 bg-amber-50 border border-amber-200 rounded-lg p-3">
                  <AlertTriangle className="w-4 h-4 mt-0.5 flex-shrink-0" />
                  <span>
                    {t('admin.duplicates.found', {
                      groups: duplicatesPreview.groupsFound,
                      total: duplicatesPreview.totalDuplicates,
                    })}
                  </span>
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b text-gray-500 text-left">
                        <th className="py-2 px-2 font-medium">{t('admin.duplicates.col.date')}</th>
                        <th className="py-2 px-2 font-medium">{t('admin.duplicates.col.description')}</th>
                        <th className="py-2 px-2 font-medium">{t('admin.duplicates.col.account')}</th>
                        <th className="py-2 px-2 font-medium text-right">{t('admin.duplicates.col.amount')}</th>
                        <th className="py-2 px-2 font-medium text-right">{t('admin.duplicates.col.count')}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {duplicatesPreview.groups.map((g) => (
                        <tr key={`${g.recurringId}-${g.date}`} className="border-b last:border-b-0">
                          <td className="py-2 px-2 text-gray-700">{g.date}</td>
                          <td className="py-2 px-2 text-gray-900">{g.description || g.plannedDescription || '—'}</td>
                          <td className="py-2 px-2 text-gray-700">{g.accountName || '—'}</td>
                          <td className="py-2 px-2 text-right text-gray-700">{Number(g.amount).toFixed(2)}</td>
                          <td className="py-2 px-2 text-right text-gray-900 font-medium">{g.count}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </>
            )}
          </div>
        )}
      </div>

      {cleanupConfirmOpen && (
        <ConfirmModal
          variant="danger"
          title={t('admin.duplicates.cleanup', { count: duplicatesPreview?.totalDuplicates ?? 0 })}
          message={t('admin.duplicates.confirmCleanup', { count: duplicatesPreview?.totalDuplicates ?? 0 })}
          confirmLabel={t('admin.duplicates.cleanup', { count: duplicatesPreview?.totalDuplicates ?? 0 })}
          cancelLabel={t('common.cancel')}
          onConfirm={() => {
            duplicatesCleanupMutation.mutate()
            setCleanupConfirmOpen(false)
          }}
          onClose={() => setCleanupConfirmOpen(false)}
          isPending={duplicatesCleanupMutation.isPending}
        />
      )}
    </div>
  )
}
