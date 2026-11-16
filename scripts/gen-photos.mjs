/**
 * 构建期预生成静态图片清单 —— 把 dev server 里的假后端「固化」成文件。
 *
 * 开发时 `vite.config.js` 的中间件在每次请求 /api/photos 时才去向 picsum 要
 * 64px 小图、解码、算 thumbhash。静态托管（GitHub Pages）上没有 Node 进程，
 * 这一步必须在构建时做完，结果落到 public/api/photos.json。
 *
 * 产物里图片地址直接指向 picsum.photos：<img> 跨域加载不需要 CORS，
 * 所以静态站点也能正常显示。picsum 会忽略不认识的查询参数（?delay= 不会 404），
 * 因此页面层拼 URL 的逻辑可以原样保留。
 *
 * 容错：某张图取不到时 thumbhash 置 null（前端会退化成纯色底，和 dev 行为一致）；
 * 若全部失败且已有旧文件，则保留旧文件不覆盖，避免一次网络抖动把构建搞坏。
 */
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import jpeg from 'jpeg-js'
import { rgbaToThumbHash } from 'thumbhash'
import { photos } from '../server/photos.js'

const UPSTREAM = 'https://picsum.photos'
const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const outFile = join(root, 'public', 'api', 'photos.json')

/** 向 picsum 要一张 64px 宽的小图，解码成 RGBA 后编码成 thumbhash（base64）。 */
async function thumbhashFor(photo) {
  const width = 64
  const height = Math.max(1, Math.round((width * photo.height) / photo.width))

  const response = await fetch(`${UPSTREAM}/id/${photo.id}/${width}/${height}`, {
    redirect: 'follow',
    signal: AbortSignal.timeout(20_000),
  })
  if (!response.ok) throw new Error(`上游返回 ${response.status}`)

  const raw = jpeg.decode(Buffer.from(await response.arrayBuffer()), { useTArray: true })
  return Buffer.from(rgbaToThumbHash(raw.width, raw.height, raw.data)).toString('base64')
}

async function main() {
  const list = []

  for (const photo of photos) {
    const entry = {
      key: photo.key,
      title: photo.title,
      alt: photo.alt,
      width: photo.width,
      height: photo.height,
      ratio: photo.width / photo.height,
      radius: photo.radius,
      note: `${photo.width}×${photo.height}，radius ${photo.radius}`,
      // 注意这里是完整 URL，不再是 dev server 的 /picsum 虚拟路径
      url: `${UPSTREAM}/id/${photo.id}/${photo.width}/${photo.height}`,
    }

    try {
      entry.thumbhash = await thumbhashFor(photo)
      console.log(`  ✓ ${photo.key} (id=${photo.id}) ${entry.thumbhash.slice(0, 16)}…`)
    } catch (error) {
      console.warn(`  ✗ ${photo.key} (id=${photo.id}) 取不到小图：${error.message}`)
      entry.thumbhash = null
    }

    list.push(entry)
  }

  const hashCount = list.filter((entry) => entry.thumbhash).length

  if (hashCount === 0) {
    try {
      await readFile(outFile, 'utf8')
      console.warn('[gen-photos] 一张都没算出来，保留已有的 photos.json，不覆盖')
      return
    } catch {
      console.warn('[gen-photos] 一张都没算出来且没有旧文件，写入无占位版本')
    }
  }

  await mkdir(dirname(outFile), { recursive: true })
  await writeFile(outFile, `${JSON.stringify(list, null, 2)}\n`, 'utf8')
  console.log(`[gen-photos] 已写入 ${list.length} 条（${hashCount} 条带占位）→ public/api/photos.json`)
}

main().catch((error) => {
  console.error('[gen-photos] 失败：', error.message)
  process.exit(1)
})
