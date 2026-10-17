// Apply the saved theme before first paint to avoid a light flash (dark is the default).
// Kept as an external file so it runs under the server's CSP (script-src 'self').
try {
  if (localStorage.getItem('theme') !== 'light') document.documentElement.classList.add('dark')
} catch {
  document.documentElement.classList.add('dark')
}
