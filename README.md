# 渐进加载图片组件 · Vue 3

一张 20–32 像素的低清图先把位置占住（放大 + 模糊），高清图的像素到手后再交叉淡入替换。宽高比写在容器上，所以换图前后没有任何布局跳动。

工程里只有一个页面 `src/pages/UsagePage.vue`，它就是这个组件的典型用法：**没有组件内部逻辑，只放图和文案**。

## 跑起来

```bash
npm install
npm run dev
```

- 本机 `http://127.0.0.1:5173/`
- 局域网 `http://<本机内网 IP>:5173/`（同一网络下的手机、平板都能开）

`server.host` 是 `true`，即监听所有网卡。这是**开发服务器、没有鉴权**，别在不可信的网络长期开着。

页面上有「重新加载一遍」按钮，点一次就能重看「模糊 → 清晰」。

---

## 一、项目由四层组成

```
浏览器
 │
 ├─ ① 页面层  src/pages/UsagePage.vue
 │     · fetch('/api/photos') 取清单，渲染三张 <ProgressiveImage>
 │     · 对每项做：thumbhash → thumbHashToDataURL() → 交给 lowRes
 │     · 源码里没有任何图片 id / 哈希 / 尺寸
 │
 ├─ ② 组件层  src/progressive-image/
 │     · ProgressiveImage.vue  两层 <img> + 状态机驱动 + 交叉淡入
 │     · useImageLoad.js       loading → ready → loaded / error
 │     · index.js              app.use 全局注册入口
 │
 ├─ ③ 假接口    GET /api/photos（vite.config.js 里的中间件）
 │     · 从 server/photos.js 读图片清单
 │     · 向 picsum 要 64px 小图 → jpeg-js 解码 → rgbaToThumbHash() 算哈希
 │     · 返回 { url, width, height, ratio, radius, alt, thumbhash }
 │     · 哈希是算出来的，不是写死的
 │
 └─ ④ 图片层  GET /picsum/*（vite.config.js 里的中间件）
       · ?delay=N   把响应推迟 N 毫秒 → 制造真实的慢网
       · 内存缓存（不落盘）：同一次运行内同一张图只下载一次
       · 启动预热三张图（WARM_UP）
       · 只有内存缓存未命中才真的访问 picsum.photos
```

两处关键解耦：

- **组件层不知道 ③④ 存在**，它只看到「一个图片地址 + 一个占位图地址」，所以这套代码拿到生产也成立。
- **页面层不知道图片从哪来**，它只消费接口字段。把 ③ 换成你的真后端，页面和组件都不用改。

## 二、一次加载的完整时序

按代码执行顺序：

1. `main.js` 里 `app.use(ProgressiveImage)` 注册组件，挂载 `UsagePage`
2. `UsagePage` 挂载后 `fetch('/api/photos')`，接口对每张图算 thumbhash 并返回清单
3. 页面把每个 `thumbhash` 解码成 32px PNG，拼出高清图地址（`?delay=2500&v=…`）
4. `ProgressiveImage` 初始化：
   - `begin()` 记录起跑时间（`performance.now()`），状态 = `loading`
   - 模板同时渲染两个 `<img>`：占位层（thumbhash 解码出的 32px 图，立刻可绘制）和高清图（`src` 一设就开始请求）
5. 请求打到 dev server 的 `/picsum` 中间件：
   - `sleep(delay)` 与「取字节」并行执行，取字节 = 内存缓存命中 / 上游 picsum
   - 返回后 `Cache-Control: no-store`，避免浏览器缓存导致「重播」看不出过程
6. 高清图触发 `load` → `handleLoad()` → **先 `decode()`**
7. `decode()` 完成 → 状态 = `ready` → 主图层 `opacity 0→1`、模糊层 `1→0`（`fade` 毫秒）
8. `fade + 80ms` 后 → 状态 = `loaded` → 模糊层从 DOM 移除（释放那张低清图）
9. 出错时：`error` → 自动重试一次（URL 加 `?r=1`）→ 仍失败 → 错误态 + 重试按钮

## 三、组件内部

### DOM 结构

```
figure.pimg                       aria-busy 反映是否在 loading
└─ div.pimg__stage                aspect-ratio 撑高度、overflow:hidden、container 查询容器
   ├─ img.pimg__img               主图层：透明 → 淡入
   ├─ div.pimg__ghost             模糊层：低清图 + blur(16px) + scale(1.08)（只在 loading/ready 存在）
   └─ div.pimg__error             只在 error 时存在，<slot name="error">
```

两层都是 `position: absolute; inset: 0`，容器高度由 `aspect-ratio` 决定 —— 所以图片到达时**不可能挤动任何东西**（实测 CLS ≈ 0.00001）。

### 状态机

```
        begin()                decode() 完成              fade + 80ms
  ┌──────────────┐        ┌──────────────────┐      ┌──────────────┐
  │   loading    │───────▶│      ready       │─────▶│    loaded    │
  └──────────────┘        └──────────────────┘      └──────────────┘
        │  ▲                       (淡入中)            (模糊层已移除)
        │  │ restart() / 重试：版本号 +1 回到 loading
        │  │
        ▼  │
  ┌──────────────┐
  │    error     │  重试用尽时进入，渲染 #error 插槽
  └──────────────┘
```

### 三个不显然的设计

| 设计 | 为什么 |
|---|---|
| **`ready` 与 `loaded` 分开** | `ready` 要驱动淡入，`loaded` 才能摘掉模糊层。合成一个状态就没法在淡入结束后释放低清图的内存 |
| **用定时器兜底而不是听 `transitionend`** | `prefers-reduced-motion` 下过渡被关掉、元素被隐藏时，`transitionend` **永远不触发**，只靠它会永久卡在 `ready` |
| **`handleLoad()` 返回 Promise** | 像素到手是异步的（`decode`），`duration` / `naturalSize` 只能在 Promise 里拿到。早期版本在这里踩过坑：`emit('load')` 发太早，载荷里 `duration` 还是 `null`，父组件读数永远显示「加载中」 |

另外 `watch(() => props.src)` 会在地址变化时重走状态机；`resetForNewSource()` 不加版本号（地址本身已经不同），`restart()` 才加，因为手动重来的地址可能和上次一模一样，不加版本浏览器会直接读缓存。

## 四、demo 层（产线不需要）

| 东西 | 作用 | 注意 |
|---|---|---|
| `?delay=` | 推迟响应，模拟慢网 | 值被夹在 0–20000ms |
| 内存缓存 | 同一次 dev server 运行内按地址去重，同一张图只下载一次 | **不落盘**，重启即失效；每次启动重新下载约 150 KB |
| `WARM_UP` | 启动时串行预热三张图 | **硬编码**，和 `server/photos.js` 里的图对应，换图时要同步 |
| `/api/photos` | 假接口：返回图片清单，并以**真实图片字节**算出 thumbhash 一起下发 | 相当于你的后端；`server/photos.js` 是它背后的假数据表 |
| `DELAY = 2500` | 页面里写死的慢网参数 | 真实项目把 `?delay=…` 去掉即可 |

## 五、接进你自己的项目（Vue 3）

> 本工程的 `/api/photos` 只是假后端。真项目里把它换成你的接口即可——只要返回 `{ url, ratio, thumbhash }` 这类字段，页面和组件都不用改。占位哈希在生产里应该在**上传/构建时**算好存库（Node 侧用 `sharp` 缩到 100px 内 + `rgbaToThumbHash`），而不是每次请求现算。

组件被收拢在 `src/progressive-image/`，**整个文件夹拷走**即可。

```js
// main.js —— 注册一次
import { createApp } from 'vue'
import App from './App.vue'
import ProgressiveImage from '@/components/progressive-image/index.js'

createApp(App).use(ProgressiveImage).mount('#app')
```

```html
<!-- 任何模板里直接用，不用再 import -->
<ProgressiveImage src="/photo.jpg" :low-res="lowRes" :ratio="16 / 9" :radius="6" alt="峡谷间的河" />
```

也可以局部引入：`import { ProgressiveImage } from '@/components/progressive-image/index.js'`。本工程不需要 vue-router，组件与路由无关。

### Props

| 名字 | 类型 | 默认 | 说明 |
| --- | --- | --- | --- |
| `src` | `String` | 必填 | 高清图地址，挂载即请求 |
| `lowRes` | `String` | 必填 | 20–32px 低清图；少量固定图片用 data URI，列表场景用随数据下发的 blurhash/主色 |
| `alt` | `String` | `''` | 语义描述，挂在主图 `<img>` 上 |
| `ratio` | `Number \| String` | `16 / 9` | 宽高比，占位靠它撑住 |
| `fit` | `String` | `'cover'` | `object-fit` |
| `radius` | `Number \| String` | `0` | 圆角，数字按 px |
| `fade` | `Number` | `450` | 交叉淡入时长（ms），reduced-motion 下归零 |
| `retryLimit` | `Number` | `1` | 自动重试次数，`0` 为关闭 |

### 事件与扩展点

| 名字 | 时机 | 载荷 |
| --- | --- | --- |
| `load` | 像素就绪 | `{ src, cached, duration, naturalWidth, naturalHeight }` |
| `retry` | 自动重试发起 | `{ src, attempt }` |
| `error` | 重试用尽 | `{ src, attempts }` |
| `#error` 插槽 | 错误态替换 | `{ retry, src }` |
| `reload()` | 实例方法 | 重置计数并重新请求 |

**占位信息要小，而且要跟着数据一起到。**

| 方案 | 体积 | 何时到达 | 适合 |
| --- | --- | --- | --- |
| base64 内联进 JS | ~1.1 KB/张 | 跟代码一起到 | **只适合少量固定图片**（logo 墙、首页 banner） |
| `blurhash` / `thumbhash` 字符串 | 20–40 **字符** | 跟接口数据一起到 | 列表、无限滚动（**本工程用这个**） |
| 主色 | 7 字节 | 跟接口数据一起到 | 商品卡这类图片差异大的场景 |
| 低清图 URL | 一次小请求（~800 B） | 要发请求，慢网下可能迟到 | 后端已生成缩略图时 |

关键区别是**跟着数据到**还是**跟着代码到**：接口把 `thumbhash` 随列表一起返回时，它和列表数据同时到达，天然早于图片下载，换图也不用改代码。

**本工程走的是完整链路**：`/api/photos` 这个假接口在响应时，向 picsum 要一张 64px 小图、用 `jpeg-js` 解码成 RGBA、再用 `rgbaToThumbHash()` 算出哈希。所以哈希是**从图片字节推出来的**，不是谁手写的数据；前端源码里既没有哈希，也没有图片 id。

前端拿到响应后，用 `thumbHashToDataURL()` 把 20–40 个字符解码成一张 32px 的 PNG，作为 `lowRes` 交给组件。真实项目里换掉这个假接口即可，组件和页面都不用动。

## 六、怎么调试

| 想看什么 | 怎么看 |
|---|---|
| 当前阶段 | `<figure class="pimg">` 的 `aria-busy`：`true` = loading |
| 是否已淡入 | 主图层有没有 `.pimg__img--in` |
| 模糊层是否已移除 | 还有没有 `.pimg__ghost` |
| 真实耗时 | 监听 `@load` 的 `duration`（毫秒）；`cached: true` 表示命中内存缓存 |
| 慢网是否生效 | 浏览器 Network 里 `/picsum/...` 请求的耗时 ≈ `delay` + 上游耗时 |
| 图片缓存状态 | 没有磁盘缓存；同一次运行里第二次请求同一张图不应再有上游流量，重启 dev server 即失效 |

## 七、已知限制

- 组件不做视口懒加载：挂载即请求，页面里图片多时要自己套 `IntersectionObserver`。
- 每个实例独立记状态，多个实例之间不共享请求或缓存；同一个 URL 由浏览器缓存兜底。
- 低清图必须预先准备好（服务端或构建期），组件不会从高清图缩出来（需要 canvas + CORS）。
- 错误态按容器宽度自适应（< 168px 只显示重试按钮），但没有做占位骨架。
- 预热列表与页面里的图片是手动同步的两处，不是从数据源推导的。

## 目录

```
src/
  progressive-image/                # ← 整体拷走就能用，不依赖本工程任何东西
    ProgressiveImage.vue            #   组件本体（渲染 + 状态驱动）
    useImageLoad.js                 #   加载状态机（与样式无关，可单独测试）
    index.js                        #   注册入口（app.use / 具名导出）
  pages/UsagePage.vue               # 唯一的页面：组件用法示例
server/photos.js                    # 假数据表（图片清单，不含占位信息）
  styles/app.css                    # 全局样式：配色变量 + 基础重置
  main.js                           # 注册组件 → 挂载页面

vite.config.js                      # 慢网代理 + 内存缓存 + 启动预热
index.html                          # 唯一的 HTML 壳
使用文档.md                          # 按「介绍 / 使用 / 参数」格式写的提交用文档
```
