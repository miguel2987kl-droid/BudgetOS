/**
 * @fileoverview Unit tests for Layout component - version display
 * Verifies that the app version badge is rendered in the sidebar
 * and matches the version from the root package.json
 */

import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { readFileSync } from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const rootPkg = JSON.parse(readFileSync(path.resolve(__dirname, '../../../package.json'), 'utf-8'))

// Set global __APP_VERSION__ as Vite would at build time
globalThis.__APP_VERSION__ = rootPkg.version

// Mock react-router-dom
vi.mock('react-router-dom', () => ({
  Outlet: () => <div data-testid="outlet" />,
  NavLink: ({ children, to }) => <a href={to}>{children}</a>,
  useNavigate: () => vi.fn(),
}))

// Mock react-i18next
// react-i18next is mocked globally in tests/setup.js (t returns the key)

// Mock AuthContext
vi.mock('../../src/contexts/AuthContext', () => ({
  useAuth: () => ({
    user: { id: '1', email: 'admin@test.com', fullName: 'Admin Test', role: 'super_admin' },
    isGroupAdmin: false,
    logout: vi.fn(),
  }),
}))

// Mock ThemeContext
vi.mock('../../src/contexts/ThemeContext', () => ({
  useTheme: () => ({ theme: 'dark', toggleTheme: vi.fn() }),
}))

// Mock lucide-react icons
vi.mock('lucide-react', async (importOriginal) => {
  const actual = await importOriginal()
  const icon = (props) => <svg {...props} />
  // Stub every real icon export so new icons don't break the mock.
  const stubs = {}
  for (const key of Object.keys(actual)) stubs[key] = icon
  return stubs
})

import Layout from '../../src/components/Layout'

describe('Layout - version display', () => {
  it('renders the version badge in the sidebar', () => {
    render(<Layout />)

    const versionText = screen.getByText(`BudgetOS v${rootPkg.version}`)
    expect(versionText).toBeInTheDocument()
  })

  it('displays the correct version from package.json', () => {
    render(<Layout />)

    // Verify the version matches the root package.json dynamically
    expect(rootPkg.version).toMatch(/^\d+\.\d+\.\d+$/)
    expect(screen.getByText(`BudgetOS v${rootPkg.version}`)).toBeInTheDocument()
  })

  it('version badge is visible (not hidden)', () => {
    render(<Layout />)

    const versionText = screen.getByText(`BudgetOS v${rootPkg.version}`)
    expect(versionText).toBeVisible()
  })
})
