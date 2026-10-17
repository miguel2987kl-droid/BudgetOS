import { createContext, useContext, useState, useEffect } from 'react'
import { authApi, workspaceApi, setWorkspaceRequestContext } from '../lib/api'
import i18n from '../i18n'

const AuthContext = createContext(null)

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null)
  const [userSettings, setUserSettings] = useState(null)
  const [userGroups, setUserGroups] = useState([])
  const [workspaces, setWorkspaces] = useState([])
  const [activeWorkspace, setActiveWorkspace] = useState(null)
  const [needsSetup, setNeedsSetup] = useState(false)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    checkAuth()
  }, [])

  const checkAuth = async () => {
    try {
      const { data } = await authApi.getMe()
      setUser(data.data.user)
      setUserGroups(data.data.groups || [])
      try {
        const workspaceResponse = await workspaceApi.getAll()
        setWorkspaces(workspaceResponse.data.data.workspaces || [])
        setActiveWorkspace(workspaceResponse.data.data.activeWorkspace || null)
        setWorkspaceRequestContext(workspaceResponse.data.data.activeWorkspace?.id)
      } catch {
        setWorkspaces([])
        setActiveWorkspace(null)
        setWorkspaceRequestContext(null)
      }
      setNeedsSetup(false)
      if (data.data.user?.locale) i18n.changeLanguage(data.data.user.locale)
      // Load user settings
      try {
        const settingsRes = await authApi.getSettings()
        setUserSettings(settingsRes.data.data.settings)
      } catch {
        setUserSettings(null)
      }
    } catch {
      setUser(null)
      setUserSettings(null)
      setUserGroups([])
      setWorkspaces([])
      setActiveWorkspace(null)
      // Check if application needs initial setup
      try {
        const { data } = await authApi.getSetupStatus()
        setNeedsSetup(data.data.needsSetup)
      } catch {
        setNeedsSetup(false)
      }
    } finally {
      setLoading(false)
    }
  }

  const updateSettings = async (newSettings) => {
    const { data } = await authApi.updateSettings(newSettings)
    setUserSettings(data.data.settings)
    if (newSettings.locale) i18n.changeLanguage(newSettings.locale)
    return data
  }

  const login = async (email, password) => {
    setWorkspaceRequestContext(null)
    const { data } = await authApi.login({ email, password })
    // Reload full user data (user, settings, groups) via checkAuth
    await checkAuth()
    return data
  }

  const register = async (userData) => {
    setWorkspaceRequestContext(null)
    const { data } = await authApi.register(userData)
    // Reload full user data (user, settings, groups) via checkAuth
    await checkAuth()
    return data
  }

  const logout = async () => {
    await authApi.logout()
    setUser(null)
    setUserSettings(null)
    setUserGroups([])
    setWorkspaces([])
    setActiveWorkspace(null)
    setWorkspaceRequestContext(null)
  }

  const switchWorkspace = async (workspaceId) => {
    const { data } = await workspaceApi.activate(workspaceId)
    const selected = data.data.workspace
    setWorkspaceRequestContext(selected.id)
    setActiveWorkspace(selected)
    setWorkspaces((current) => current.map((workspace) => ({
      ...workspace,
      active: workspace.id === selected.id,
    })))
    return selected
  }

  const createWorkspace = async (workspaceData) => {
    const { data } = await workspaceApi.create(workspaceData)
    setWorkspaceRequestContext(data.data.workspace.id)
    const { data: workspaceList } = await workspaceApi.getAll()
    setWorkspaces(workspaceList.data.workspaces || [])
    setActiveWorkspace(workspaceList.data.activeWorkspace || data.data.workspace)
    return data.data.workspace
  }

  const refreshWorkspaces = async () => {
    const { data } = await workspaceApi.getAll()
    const nextWorkspaces = data.data.workspaces || []
    const nextActiveWorkspace = data.data.activeWorkspace || null
    setWorkspaces(nextWorkspaces)
    setActiveWorkspace(nextActiveWorkspace)
    setWorkspaceRequestContext(nextActiveWorkspace?.id)
  }

  const deactivateWorkspace = async (workspaceId) => {
    await workspaceApi.deactivate(workspaceId)
    await refreshWorkspaces()
  }

  const reactivateWorkspace = async (workspaceId) => {
    await workspaceApi.reactivate(workspaceId)
    await refreshWorkspaces()
  }

  const updateWorkspaceNotes = async (workspaceId, notes) => {
    const { data } = await workspaceApi.updateNotes(workspaceId, { notes })
    await refreshWorkspaces()
    return data.data.workspace
  }

  const deleteWorkspace = async (workspaceId) => {
    await workspaceApi.delete(workspaceId)
    await refreshWorkspaces()
  }

  const restoreWorkspace = async (workspaceId) => {
    await workspaceApi.restore(workspaceId)
    await refreshWorkspaces()
  }

  const isGroupAdmin = userGroups.some(g => g.memberRole === 'admin')

  // Finance module permissions of the active workspace. Without that
  // information (older API), nothing is hidden.
  const financePermissions = activeWorkspace?.finance?.permissions
  const can = (resource, action = 'ver') => !financePermissions || Boolean(financePermissions[resource]?.includes(action))

  return (
    <AuthContext.Provider value={{ user, userSettings, userGroups, workspaces, activeWorkspace, isGroupAdmin, needsSetup, loading, login, register, logout, checkAuth, updateSettings, switchWorkspace, createWorkspace, deactivateWorkspace, reactivateWorkspace, updateWorkspaceNotes, deleteWorkspace, restoreWorkspace, can }}>
      {children}
    </AuthContext.Provider>
  )
}

export function useAuth() {
  const context = useContext(AuthContext)
  if (!context) {
    throw new Error('useAuth must be used within an AuthProvider')
  }
  return context
}
