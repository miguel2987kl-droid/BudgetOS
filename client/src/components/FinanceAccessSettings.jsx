import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { ShieldCheck, Save, RotateCcw, Activity } from 'lucide-react'
import { adminApi } from '../lib/api'
import { translateError } from '../lib/errorHelper'
import { memberRoleLabel } from './WorkspaceMembers'

const actorLabel = (t, actor) => ({
  admin: t('finance.actors.admin', { defaultValue: 'Administrador BPO' }),
  operator: t('finance.actors.operator', { defaultValue: 'Operador financeiro' }),
  client: t('finance.actors.client', { defaultValue: 'Cliente' }),
}[actor] || actor)

/**
 * Super admin settings of the finance module: role mapping (RF-IN-01),
 * permission matrix (RF-IN-07), archive retention (RN-16) and audit health (RF-IN-06).
 */
export default function FinanceAccessSettings() {
  const { t } = useTranslation()
  const queryClient = useQueryClient()
  const [roleMap, setRoleMap] = useState(null)
  const [matrix, setMatrix] = useState(null)
  const [retentionDays, setRetentionDays] = useState(90)
  const [message, setMessage] = useState(null)

  const { data, isLoading, isError } = useQuery({
    queryKey: ['admin', 'finance-access'],
    queryFn: () => adminApi.getFinanceAccess().then((r) => r.data.data),
  })
  const { data: health } = useQuery({
    queryKey: ['admin', 'integration-health'],
    queryFn: () => adminApi.getIntegrationHealth().then((r) => r.data.data),
  })

  useEffect(() => {
    if (!data) return
    setRoleMap(data.roleMap)
    setMatrix(data.matrix)
    setRetentionDays(data.workspaceRetentionDays)
  }, [data])

  const onError = (err) => setMessage({ type: 'error', text: translateError(err) })
  const onSaved = () => {
    queryClient.invalidateQueries({ queryKey: ['admin', 'finance-access'] })
    setMessage({ type: 'success', text: t('common.saved', { defaultValue: 'Salvo.' }) })
  }

  const saveMutation = useMutation({
    mutationFn: async () => {
      await adminApi.updateFinanceRoles(roleMap)
      await adminApi.updateFinancePermissions(matrix)
      await adminApi.updateFinanceSettings({ workspaceRetentionDays: Number(retentionDays) })
    },
    onSuccess: onSaved,
    onError,
  })
  const resetMutation = useMutation({ mutationFn: adminApi.resetFinancePermissions, onSuccess: onSaved, onError })

  if (isLoading) return null
  if (isError || !data || !roleMap || !matrix) {
    return isError ? <div className="card max-w-2xl text-sm text-red-600">{t('common.error')}</div> : null
  }

  const toggle = (actor, resource, action) => {
    setMatrix((current) => {
      const actions = current[actor][resource] || []
      const next = actions.includes(action) ? actions.filter((item) => item !== action) : [...actions, action]
      return { ...current, [actor]: { ...current[actor], [resource]: next } }
    })
  }

  return (
    <form
      onSubmit={(event) => { event.preventDefault(); setMessage(null); saveMutation.mutate() }}
      className="card max-w-4xl space-y-6"
    >
      <div className="flex items-center gap-2">
        <ShieldCheck className="w-5 h-5 text-primary-600" />
        <h2 className="text-lg font-semibold">{t('finance.accessTitle', { defaultValue: 'Módulo financeiro: papéis e permissões' })}</h2>
      </div>

      <fieldset>
        <legend className="text-sm font-medium text-gray-700 mb-2">{t('finance.roleMapping', { defaultValue: 'Papel no cliente → ator do módulo' })}</legend>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          {data.membershipRoles.map((role) => (
            <div key={role}>
              <label htmlFor={`role-map-${role}`} className="block text-sm text-gray-600 mb-1">{memberRoleLabel(t, role)}</label>
              <select
                id={`role-map-${role}`}
                value={roleMap[role] || ''}
                onChange={(event) => setRoleMap({ ...roleMap, [role]: event.target.value || null })}
                className="input"
              >
                <option value="">{t('finance.noAccess', { defaultValue: 'Sem acesso' })}</option>
                {data.actors.map((actor) => <option key={actor} value={actor}>{actorLabel(t, actor)}</option>)}
              </select>
            </div>
          ))}
        </div>
      </fieldset>

      <fieldset>
        <legend className="text-sm font-medium text-gray-700 mb-2">{t('finance.permissionMatrix', { defaultValue: 'Permissões por ator' })}</legend>
        <div className="overflow-x-auto">
          <table className="min-w-full text-sm">
            <thead>
              <tr className="text-left text-gray-500">
                <th scope="col" className="py-2 pr-4 font-medium">{t('finance.resource', { defaultValue: 'Recurso' })}</th>
                {data.actors.map((actor) => <th key={actor} scope="col" className="py-2 pr-4 font-medium">{actorLabel(t, actor)}</th>)}
              </tr>
            </thead>
            <tbody className="divide-y">
              {data.catalog.map((entry) => (
                <tr key={entry.key}>
                  <th scope="row" className="py-2 pr-4 font-mono text-xs font-normal text-gray-700 align-top">{entry.key}</th>
                  {data.actors.map((actor) => (
                    <td key={actor} className="py-2 pr-4 align-top">
                      <div className="flex flex-wrap gap-x-3 gap-y-1">
                        {entry.actions.map((action) => (
                          <label key={action} className="inline-flex items-center gap-1 text-xs text-gray-700">
                            <input
                              type="checkbox"
                              checked={matrix[actor]?.[entry.key]?.includes(action) || false}
                              onChange={() => toggle(actor, entry.key, action)}
                            />
                            {action}
                          </label>
                        ))}
                      </div>
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </fieldset>

      <div className="max-w-xs">
        <label htmlFor="workspace-retention" className="block text-sm font-medium text-gray-700 mb-1">
          {t('finance.retentionDays', { defaultValue: 'Dias de arquivamento de clientes excluídos' })}
        </label>
        <input
          id="workspace-retention"
          type="number"
          min={1}
          max={3650}
          required
          value={retentionDays}
          onChange={(event) => setRetentionDays(event.target.value)}
          className="input"
        />
      </div>

      {health && (
        <p className="flex items-center gap-2 text-sm text-gray-600">
          <Activity className="w-4 h-4" />
          {health.audit.pending === 0 && health.audit.recentFailures.length === 0
            ? t('finance.auditHealthy', { defaultValue: 'Auditoria: nenhuma falha de gravação.' })
            : t('finance.auditPending', {
              pending: health.audit.pending,
              failures: health.audit.recentFailures.length,
              defaultValue: `Auditoria: ${health.audit.pending} evento(s) aguardando reenvio, ${health.audit.recentFailures.length} falha(s) recentes.`,
            })}
        </p>
      )}

      {message && (
        <p role={message.type === 'error' ? 'alert' : 'status'} className={`text-sm ${message.type === 'error' ? 'text-red-600' : 'text-green-700'}`}>
          {message.text}
        </p>
      )}

      <div className="flex flex-wrap gap-2">
        <button type="submit" disabled={saveMutation.isPending} className="btn btn-primary inline-flex items-center gap-2 disabled:opacity-60">
          <Save className="w-4 h-4" />{t('common.save')}
        </button>
        <button type="button" onClick={() => { setMessage(null); resetMutation.mutate() }} disabled={resetMutation.isPending} className="btn btn-secondary inline-flex items-center gap-2">
          <RotateCcw className="w-4 h-4" />{t('finance.resetPermissions', { defaultValue: 'Restaurar permissões padrão' })}
        </button>
      </div>
    </form>
  )
}
