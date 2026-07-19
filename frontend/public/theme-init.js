// Apply the default theme before React renders without requiring inline script permission.
try {
  const root = document.documentElement
  root.classList.remove('light')
  root.classList.add('dark')
  root.style.colorScheme = 'dark'
} catch {
  // Rendering can continue with the stylesheet default if the document is unavailable.
}
