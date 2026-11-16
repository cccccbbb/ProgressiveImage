import ProgressiveImage from './ProgressiveImage.vue'

/**
 * 拷进你的项目之后，main.js 里两行就能全局用：
 *
 *   import ProgressiveImage from '@/progressive-image/index.js'
 *   createApp(App).use(ProgressiveImage).mount('#app')
 *
 * 然后在任何模板里写 <ProgressiveImage src="…" low-res="…" />，
 * 不需要再单独 import 组件。
 */
export default {
  install(app) {
    app.component('ProgressiveImage', ProgressiveImage)
  },
}

export { ProgressiveImage }
export { useImageLoad } from './useImageLoad.js'
