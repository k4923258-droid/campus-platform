export function redactSensitive(value: unknown): unknown {
  if (typeof value === 'string')
    return value
      .replace(/\b(1[3-9]\d)(\d{4})(\d{4})\b/g, '$1****$3')
      .replace(/\b([A-Za-z0-9._%+-])[A-Za-z0-9._%+-]*(@[A-Za-z0-9.-]+\.[A-Za-z]{2,})\b/g, '$1***$2')
      .replace(/\b\d{17}[\dXx]\b/g, '[证件号已隐藏]')
  if (Array.isArray(value)) return value.map(redactSensitive)
  if (value && typeof value === 'object')
    return Object.fromEntries(
      Object.entries(value).map(([k, v]) => [
        k,
        /password|token/i.test(k) ? '[已隐藏]' : redactSensitive(v),
      ]),
    )
  return value
}
export function downloadRedacted(value: unknown) {
  const url = URL.createObjectURL(
    new Blob([JSON.stringify(redactSensitive(value), null, 2)], { type: 'application/json' }),
  )
  const a = document.createElement('a')
  a.href = url
  a.download = '脱敏排查日志.json'
  a.click()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}
