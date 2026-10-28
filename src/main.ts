import { createApp } from 'vue'
import { createPinia } from 'pinia'
import ElementPlus from 'element-plus'
import zhCn from 'element-plus/es/locale/lang/zh-cn'
import 'element-plus/dist/index.css'
import './style.css'
import App from './App.vue'
import router from './router'
import { mockMode } from './api/client'
async function main() {
  if (mockMode) {
    const { startMocks } = await import('./mocks/browser')
    await startMocks()
  }
  const app = createApp(App)
  app.use(createPinia()).use(router).use(ElementPlus, { locale: zhCn })
  app.mount('#app')
}
main().catch((error) => {
  document.querySelector('#app')!.textContent = '启动失败：' + String(error)
})
