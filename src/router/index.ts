import { createRouter, createWebHashHistory } from 'vue-router'
import Explore from '@/pages/Explore.vue'
export default createRouter({
  history: createWebHashHistory(),
  routes: [
    { path: '/', component: Explore },
    { path: '/activities/:id', component: () => import('@/pages/ActivityDetail.vue') },
    { path: '/my', component: () => import('@/pages/MyCenter.vue') },
    { path: '/manage', component: () => import('@/pages/Manage.vue') },
    { path: '/admin', component: () => import('@/pages/Admin.vue') },
    { path: '/:pathMatch(.*)*', redirect: '/' },
  ],
})
