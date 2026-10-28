import Papa from 'papaparse'
export async function readTable(file: File): Promise<Record<string, any>[]> {
  if (file.size > 5 * 1024 * 1024) throw new Error('目录文件不能超过5MB')
  if (file.name.toLowerCase().endsWith('.csv')) {
    const parsed = Papa.parse<Record<string, string>>(await file.text(), {
      header: true,
      skipEmptyLines: true,
    })
    if (parsed.errors.length) throw new Error('CSV格式错误：' + parsed.errors[0]!.message)
    if (parsed.data.length > 5000) throw new Error('每次最多导入5000行')
    return parsed.data
  }
  if (!file.name.toLowerCase().endsWith('.xlsx')) throw new Error('请选择XLSX或CSV文件')
  const { Workbook } = await import('exceljs')
  const workbook = new Workbook()
  await workbook.xlsx.load(await file.arrayBuffer())
  const sheet = workbook.worksheets[0]
  if (!sheet) return []
  if (sheet.rowCount > 5001) throw new Error('每次最多导入5000行')
  const headers: string[] = []
  sheet.getRow(1).eachCell((cell, col) => (headers[col] = cell.text.trim()))
  const records: Record<string, any>[] = []
  sheet.eachRow((row, index) => {
    if (index === 1) return
    const record: Record<string, any> = Object.create(null)
    row.eachCell((cell, col) => {
      const header = headers[col]
      if (header && !['__proto__', 'constructor', 'prototype'].includes(header))
        record[header] = cell.text
    })
    records.push(record)
  })
  return records
}
export async function writeTable(
  records: Record<string, unknown>[],
  filename: string,
  format: 'csv' | 'xlsx',
) {
  const safe = records.map((row) =>
    Object.fromEntries(
      Object.entries(row).map(([key, v]) => {
        const text = String(v ?? '')
        return [key, /^[=+\-@\t\r]/.test(text) ? "'" + text : text]
      }),
    ),
  )
  let blob: Blob
  if (format === 'csv')
    blob = new Blob(['\ufeff' + Papa.unparse(safe)], { type: 'text/csv;charset=utf-8' })
  else {
    const { Workbook } = await import('exceljs')
    const wb = new Workbook()
    const ws = wb.addWorksheet('名单')
    const keys = Object.keys(safe[0] || { 提示: '暂无记录' })
    ws.columns = keys.map((key) => ({ header: key, key, width: 22 }))
    safe.forEach((row) => ws.addRow(row))
    blob = new Blob([await wb.xlsx.writeBuffer()], {
      type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    })
  }
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = filename + '.' + format
  link.click()
  setTimeout(() => URL.revokeObjectURL(url), 10000)
}
