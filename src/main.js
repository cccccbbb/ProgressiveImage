import { createApp } from 'vue'
import UsagePage from './pages/UsagePage.vue'
import ProgressiveImage from './progressive-image/index.js'
import './styles/app.css'

// 和把组件拷进你自己项目后的写法一致：注册一次，页面里直接用 <ProgressiveImage>
createApp(UsagePage).use(ProgressiveImage).mount('#app')
