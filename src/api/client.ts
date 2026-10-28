import axios from 'axios'
export const mockMode = import.meta.env.VITE_API_MODE !== 'server'
export const http = axios.create({
  baseURL: import.meta.env.VITE_API_BASE || '/api/v1',
  withCredentials: true,
  withXSRFToken: true,
  xsrfCookieName: 'XSRF-TOKEN',
  xsrfHeaderName: 'X-XSRF-TOKEN',
})
http.interceptors.request.use((config) => {
  if (mockMode) {
    const token = sessionStorage.getItem('demo-session')
    if (token) config.headers['X-Demo-Session'] = token
  }
  return config
})
http.interceptors.response.use(
  (response) => response,
  (error) => {
    throw new Error(error.response?.data?.message || '请求失败，请检查服务是否启动')
  },
)
export const command = async (action: string, p: unknown = {}) =>
  (await http.post('/commands/' + action, p)).data
export async function upload(file: File) {
  if (file.size > 20 * 1024 * 1024) throw new Error('单文件不能超过20MB')
  const data = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result))
    reader.onerror = reject
    reader.readAsDataURL(file)
  })
  return (await http.post('/files', { name: file.name, size: file.size, mime: file.type, data }))
    .data.id as string
}
export async function fileUrl(id: string) {
  const response = await http.get('/files/' + id, { responseType: 'blob' })
  return URL.createObjectURL(response.data)
}
