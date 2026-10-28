import { describe, it, expect } from 'vitest'
import { readTable } from '@/api/spreadsheet'
describe('目录导入解析', () => {
  it('CSV保留中文列名及逐行值', async () => {
    const file = {
      name: '目录.csv',
      size: 60,
      text: async () => 'name,kind,campus,stars\n示例社团,club,南湖,3',
    } as File
    expect(await readTable(file)).toEqual([
      { name: '示例社团', kind: 'club', campus: '南湖', stars: '3' },
    ])
  })
  it('拒绝超出大小限制的文件', async () => {
    await expect(readTable({ size: 6 * 1024 * 1024 } as File)).rejects.toThrow('5MB')
  })
  it('XLSX读取工作表标题和中文数据', async () => {
    const ExcelJS = (await import('exceljs')).default
    const wb = new ExcelJS.Workbook()
    const ws = wb.addWorksheet('目录')
    ws.addRow(['name', 'kind', 'campus', 'stars'])
    ws.addRow(['测试社团', 'club', '南湖', 4])
    const buffer = await wb.xlsx.writeBuffer()
    const file = {
      name: '目录.xlsx',
      size: buffer.byteLength,
      arrayBuffer: async () => buffer,
    } as File
    expect(await readTable(file)).toEqual([
      { name: '测试社团', kind: 'club', campus: '南湖', stars: '4' },
    ])
  })
})
