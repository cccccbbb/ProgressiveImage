import { createHash } from 'node:crypto'
import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import jpeg from 'jpeg-js'
import { rgbaToThumbHash } from 'thumbhash'
import { photos } from './server/photos.js'
const UPSTREAM = 'https://picsum.photos'

// 启动预热用的地址，直接从假数据表推出来，不再手写（换图就不会忘同步）。
const photoPath = (photo, width = photo.width, height = photo.height) =>
  `/id/${photo.id}/${width}/${height}`

const WARM_UP = photos.map((photo) => photoPath(photo))

/**
 * 演示用的“慢网”代理。
 *
 * 把 picsum 的图片经由本地 dev server 转发，按 `?delay=` 毫秒推迟响应。
 * 组件对这件事一无所知——它看到的只是一张正常的、慢一点的图片，
 * 所以「占位 → 淡入」的时序是真实请求的时序，不是前端假装的停顿。
 *
 * 上游字节只在内存里留一份，不落盘，并在启动时预热：
 * 页面有 9 个格子、同尺寸的图会被重复请求，picsum 一旦限流就会排到十几秒甚至半分钟。
 * 缓存只影响“取字节”这一步，延迟仍然逐请求生效，时序依旧真实。
 *
 * 不落盘的代价：每次重启 dev server 都要重新下载约 150 KB（3 张大图 + 3 张算 hash 的 64px 小图），
 * 冷启动撞上 picsum 限流的机会也更大。限流时 /api/photos 取不到小图 → 该图 thumbhash 置空 →
 * 前端退化成纯色底（组件会 warn「lowRes 为空」），这是本地唯一能观察到的功能退化。
 */
function slowPicsum() {
  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
  const memory = new Map()

  function cacheKey(pathname, blur) {
    const digest = createHash('sha1').update(`${pathname}|${blur || ''}`).digest('hex')
    return `${digest.slice(0, 16)}.jpg`
  }

  function imageFor(pathname, blur) {
    const key = cacheKey(pathname, blur)
    if (memory.has(key)) return memory.get(key)

    const task = (async () => {
      const upstreamUrl = `${UPSTREAM}${pathname}${blur ? `?blur=${encodeURIComponent(blur)}` : ''}`
      const response = await fetch(upstreamUrl, { redirect: 'follow' })
      if (!response.ok) {
        const error = new Error(`upstream ${response.status}`)
        error.status = response.status
        throw error
      }

      const body = Buffer.from(await response.arrayBuffer())

      return { contentType: response.headers.get('content-type') || 'image/jpeg', body }
    })()

    memory.set(key, task)
    task.catch(() => memory.delete(key))
    return task
  }

  // thumbhash 在这里算：向 picsum 要一张 64px 的小图，解码成 RGBA，再编码成哈希。
  // 也就是说占位信息是**从真实图片字节推出来的**，不是谁手写的数据。
  const hashCache = new Map()

  function thumbhashFor(photo) {
    const cacheKey = `id:${photo.id}`
    if (hashCache.has(cacheKey)) return hashCache.get(cacheKey)

    const task = (async () => {
      const width = 64
      const height = Math.max(1, Math.round((width * photo.height) / photo.width))
      const small = await imageFor(photoPath(photo, width, height), null)
      const raw = jpeg.decode(small.body, { useTArray: true })
      return Buffer.from(rgbaToThumbHash(raw.width, raw.height, raw.data)).toString('base64')
    })()

    hashCache.set(cacheKey, task)
    task.catch(() => hashCache.delete(cacheKey))
    return task
  }

  // 假接口：相当于后端返回图片清单（含它算好的 thumbhash）
  const photosMiddleware = async (req, res) => {
    try {
      const list = await Promise.all(
        photos.map(async (photo) => {
          const entry = {
            key: photo.key,
            title: photo.title,
            alt: photo.alt,
            width: photo.width,
            height: photo.height,
            ratio: photo.width / photo.height,
            radius: photo.radius,
            note: `${photo.width}×${photo.height}，radius ${photo.radius}`,
            url: `/picsum${photoPath(photo)}`,
          }

          // 单张图算不出占位不影响其它图：thumbhash 置 null，前端退化成纯色底
          try {
            return { ...entry, thumbhash: await thumbhashFor(photo) }
          } catch (error) {
            console.warn(
              `[api/photos] id=${photo.id} 取不到小图，跳过占位：${error.message}（这张图片很可能不存在）`,
            )
            return { ...entry, thumbhash: null }
          }
        }),
      )

      res.statusCode = 200
      res.setHeader('Content-Type', 'application/json; charset=utf-8')
      res.setHeader('Cache-Control', 'no-store')
      res.end(JSON.stringify(list))
    } catch (error) {
      res.statusCode = error.status >= 400 ? error.status : 500
      res.setHeader('Content-Type', 'application/json; charset=utf-8')
      res.end(JSON.stringify({ error: error.message }))
    }
  }

  // 串行预热，避免一启动就把 picsum 惹毛
  async function warmUp() {
    for (const pathname of WARM_UP) {
      try {
        await imageFor(pathname, null)
      } catch {
        // 预热失败无所谓，真请求时还会再试一次
      }
    }
  }

  const middleware = async (req, res) => {
    try {
      const url = new URL(req.url, 'http://demo.local')
      const rawDelay = Number(url.searchParams.get('delay'))
      const delay = Number.isFinite(rawDelay) ? Math.max(0, Math.min(rawDelay, 20000)) : 0
      const blur = url.searchParams.get('blur')

      const [image] = await Promise.all([
        imageFor(url.pathname, blur),
        delay > 0 ? sleep(delay) : Promise.resolve(),
      ])

      res.setHeader('Content-Type', image.contentType)
      res.setHeader('Content-Length', String(image.body.length))
      res.setHeader('Cache-Control', 'no-store')
      res.end(image.body)
    } catch (error) {
      res.statusCode = error.status || 502
      res.end(`proxy error: ${error.message}`)
    }
  }

  return {
    name: 'demo-slow-picsum',
    configureServer(server) {
      server.middlewares.use('/picsum', middleware)
      server.middlewares.use('/api/photos', photosMiddleware)
      warmUp()
    },
    configurePreviewServer(server) {
      server.middlewares.use('/picsum', middleware)
      server.middlewares.use('/api/photos', photosMiddleware)
      warmUp()
    },
  }
}

export default defineConfig(({ command }) => ({
  // 构建产物部署在 https://<user>.github.io/ProgressiveImage/ 这样的子路径下，
  // 所以 base 必须带上仓库名，否则 dist 里的 /assets/* 会 404。开发服务器仍用根路径。
  base: command === 'build' ? '/ProgressiveImage/' : '/',
  plugins: [vue(), slowPicsum()],
  server: {
    // 绑 0.0.0.0：同一局域网里的手机、另一台电脑都能打开。
    // 注意这是开发服务器，没有鉴权，别在不可信的网络上这么开。
    host: true,
    port: 5173,
  },
  preview: {
    host: true,
    port: 4173,
  },
}))
