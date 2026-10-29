const allowed: Record<string, string[]> = {
  png: ['image/png'],
  jpg: ['image/jpeg'],
  jpeg: ['image/jpeg'],
  gif: ['image/gif'],
  webp: ['image/webp'],
  pdf: ['application/pdf'],
  zip: ['application/zip', 'application/x-zip-compressed'],
}
export function validateUpload(file: Pick<File, 'name' | 'size' | 'type'>) {
  if (file.size <= 0 || file.size > 20 * 1024 * 1024) throw new Error('文件须大于0字节且不超过20MB')
  const ext = file.name.split('.').pop()?.toLowerCase() || ''
  if (!allowed[ext]?.includes(file.type))
    throw new Error('仅允许扩展名与类型一致的图片、PDF或ZIP文件')
}
