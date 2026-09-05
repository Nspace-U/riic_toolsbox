import 'ant-design-vue/dist/reset.css'
import { createApp } from 'vue'
import Antd from 'ant-design-vue'

import App from './App.vue'
import './assets/main.css'
import router from './router'

createApp(App).use(Antd).use(router).mount('#app')
