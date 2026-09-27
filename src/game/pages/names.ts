/** The name you play under, remembered between visits. */
const KEY = 'catan.name'

export function rememberedName(): string {
  try {
    return localStorage.getItem(KEY) ?? ''
  } catch {
    return ''
  }
}

export function rememberName(name: string) {
  try {
    if (name.trim()) localStorage.setItem(KEY, name.trim().slice(0, 24))
  } catch {
    // Private mode: forget it.
  }
}
