// 库构建配置：把 src/progressive-image 打成可分发的 npm 包产物。
// 和 vite.config.js（demo 站点）互不干扰，两边产物分别落在 lib/ 和 dist/。
import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import { fileURLToPath, URL } from 'node:url'

export default defineConfig({
  plugins: [vue()],
  // 库构建不需要 demo 的静态资源：默认 public/ 会被原样复制进 lib/，
  // 结果包里的 api/photos.json 是站点用的假数据，对使用者毫无意义。
  publicDir: false,
  build: {
    outDir: 'lib',
    emptyOutDir: true,
    lib: {
      entry: fileURLToPath(new URL('./src/progressive-image/index.js', import.meta.url)),
      name: 'ProgressiveImage',
      fileName: 'index',
      formats: ['es', 'umd'],
    },
    rollupOptions: {
      // vue 由使用方提供（见 package.json 的 peerDependencies），不打进包里，
      // 否则使用者项目里会出现两份 Vue 实例。
      external: ['vue'],
      output: {
        globals: { vue: 'Vue' },
        // 入口同时有默认导出（插件对象）和具名导出（组件、useImageLoad），
        // 显式声明 named，避免 rollup 报 MIXED_EXPORTS 警告
        exports: 'named',
        // 组件的 scoped 样式会被提取成一个 CSS 文件，固定名字方便使用者引用。
        assetFileNames: (assetInfo) =>
          assetInfo.name === 'style.css' ? 'style.css' : assetInfo.name,
      },
    },
  },
})
