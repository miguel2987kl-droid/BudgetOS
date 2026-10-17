import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { UserPlus, Trash2 } from 'lucide-react'
import { workspaceApi } from '../lib/api'

export const MEMBER_ROLES = ['owner', 'collaborator', 'client']

export const memberRoleLabel = (t, role) => ({
  owner: t('workspaces.roles.owner', { defaultValue: 'Administrador' }),
  collaborator: t('workspaces.roles.collaborator', { defaultValue: 'Colaborador' }),
  client: t('workspaces.roles.client', { defaultValue: 'Cliente' }),
}[role] || role)

/**
 * Users linked to a client workspace and their role there (owners only).
 */
export default function WorkspaceMembers({ workspace }) {
  const { t } = useTranslation()
  const [members, setMembers] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [form, setForm] = useState({ email: '', role: 'client' })
  const [saving, setSaving] = useState(false)

  const errorMessage = (err) => err.response?.data?.error?.message || t('common.error')

  useEffect(() => {
    let cancelled = false
    workspaceApi.getMembers(workspace.id)
      .then(({ data }) => { if (!cancelled) setMembers(data.data.members) })
      .catch((err) => { if (!cancelled) setError(errorMessage(err)) })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [workspace.id])

  const run = async (request) => {
    setError('')
    setSaving(true)
    try {
      const { data } = await request()
      setMembers(data.data.members)
      return true
    } catch (err) {
      setError(errorMessage(err))
      return false
    } finally {
      setSaving(false)
    }
  }

  const handleAdd = async (event) => {
    event.preventDefault()
    if (await run(() => workspaceApi.addMember(workspace.id, form))) setForm({ email: '', role: form.role })
  }

  return (
    <div className="mt-2 rounded-md border border-gray-200 bg-gray-50 p-3">
      <p className="mb-2 text-sm font-medium text-gray-700">{t('workspaces.members', { defaultValue: 'Usuários com acesso' })}</p>
      {loading ? (
        <p className="text-sm text-gray-500">{t('common.loading', { defaultValue: 'Carregando...' })}</p>
      ) : (
        <ul className="mb-3 space-y-2">
          {members.map((member) => (
            <li key={member.userId} className="flex flex-wrap items-center gap-2 text-sm">
              <span className="min-w-0 flex-1 truncate" title={member.email}>{member.name || member.email}</span>
              <label className="sr-only" htmlFor={`member-role-${workspace.id}-${member.userId}`}>{t('workspaces.memberRole', { defaultValue: 'Papel' })}</label>
              <select
                id={`member-role-${workspace.id}-${member.userId}`}
                value={member.role}
                disabled={saving}
                onChange={(event) => run(() => workspaceApi.updateMember(workspace.id, member.userId, event.target.value))}
                className="input h-8 w-36 py-0 text-sm"
              >
                {MEMBER_ROLES.map((role) => <option key={role} value={role}>{memberRoleLabel(t, role)}</option>)}
              </select>
              <button
                type="button"
                disabled={saving}
                onClick={() => run(() => workspaceApi.removeMember(workspace.id, member.userId))}
                className="rounded p-1 text-red-600 hover:bg-red-50"
                aria-label={t('workspaces.removeMember', { defaultValue: 'Remover acesso de {{email}}', email: member.email })}
              >
                <Trash2 className="h-4 w-4" />
              </button>
            </li>
          ))}
        </ul>
      )}
      <form onSubmit={handleAdd} className="flex flex-wrap items-center gap-2">
        <label className="sr-only" htmlFor={`member-email-${workspace.id}`}>{t('auth.email', { defaultValue: 'E-mail' })}</label>
        <input
          id={`member-email-${workspace.id}`}
          type="email"
          required
          value={form.email}
          onChange={(event) => setForm({ ...form, email: event.target.value })}
          placeholder={t('workspaces.memberEmail', { defaultValue: 'E-mail de um usuário cadastrado' })}
          className="input h-9 min-w-0 flex-1 text-sm"
        />
        <label className="sr-only" htmlFor={`member-new-role-${workspace.id}`}>{t('workspaces.memberRole', { defaultValue: 'Papel' })}</label>
        <select id={`member-new-role-${workspace.id}`} value={form.role} onChange={(event) => setForm({ ...form, role: event.target.value })} className="input h-9 w-36 py-0 text-sm">
          {MEMBER_ROLES.map((role) => <option key={role} value={role}>{memberRoleLabel(t, role)}</option>)}
        </select>
        <button type="submit" disabled={saving} className="btn btn-primary inline-flex h-9 items-center gap-1.5 text-sm disabled:opacity-60">
          <UserPlus className="h-4 w-4" />{t('workspaces.addMember', { defaultValue: 'Vincular' })}
        </button>
      </form>
      {error && <p role="alert" className="mt-2 text-sm text-red-600">{error}</p>}
    </div>
  )
}
