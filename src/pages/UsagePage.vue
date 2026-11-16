<template>
  <div class="page">
    <header class="head">
      <h1 class="head__title">这就只是一个普通页面</h1>
      <button class="button" type="button" @click="reload">重新加载一遍</button>
    </header>

    <p v-if="status === 'loading'" class="state">正在取图片清单…</p>
    <p v-else-if="status === 'error'" class="state state--error">清单没取到：{{ errorMessage }}</p>

    <section v-else class="grid">
      <figure v-for="item in items" :key="item.key" class="cell">
        <ProgressiveImage
          :src="photo(item)"
          :low-res="item.lowRes"
          :ratio="item.ratio"
          :radius="item.radius"
          :alt="item.alt"
        />
        <figcaption class="cell__meta">
          <span class="cell__note">{{ item.note }}</span>
        </figcaption>
      </figure>
    </section>
  </div>
</template>

<script setup>
import { onMounted, ref } from 'vue'
import { thumbHashToDataURL } from 'thumbhash'

// 这一页没有任何图片元数据：清单和占位用的 thumbhash 都来自接口，不是写死的。
//   开发时      → /api/photos，vite 中间件实时向 picsum 求小图算哈希（见 vite.config.js）
//   静态托管时  → public/api/photos.json，构建期由 scripts/gen-photos.mjs 预生成
// 两者字段完全一致，所以这一页不需要知道自己跑在哪种环境里。
const API_URL = import.meta.env.DEV
  ? '/api/photos'
  : `${import.meta.env.BASE_URL}api/photos.json`

const DELAY = 2500
const version = ref(0)
const status = ref('loading')
const errorMessage = ref('')
const items = ref([])

// thumbhash（20–40 字符）解码成一张 32px 的 PNG，作为 lowRes 交给组件
function placeholderFor(thumbhash) {
  return thumbHashToDataURL(Uint8Array.from(atob(thumbhash), (char) => char.charCodeAt(0)))
}

function photo(item) {
  return `${item.url}?delay=${DELAY}&v=${version.value}`
}

async function loadPhotos() {
  status.value = 'loading'
  errorMessage.value = ''
  try {
    const response = await fetch(API_URL)
    if (!response.ok) {
      const detail = await response.text()
      throw new Error(`HTTP ${response.status}${detail ? ` · ${detail.slice(0, 120)}` : ''}`)
    }
    const list = await response.json()
    items.value = list.map((entry) => ({
      ...entry,
      // 接口没算出占位（比如这张图不存在）时给空字符串：组件会退化成纯色底
      lowRes: entry.thumbhash ? placeholderFor(entry.thumbhash) : '',
    }))
    status.value = 'ready'
  } catch (error) {
    errorMessage.value = error.message
    status.value = 'error'
  }
}

function reload() {
  version.value += 1
  loadPhotos()
}

onMounted(loadPhotos)
</script>

<style scoped>
.page {
  max-width: 1080px;
  margin: 0 auto;
  padding: 48px 32px 80px;
}

.head__title {
  max-width: 20ch;
  font-size: clamp(28px, 3.4vw, 42px);
  font-weight: 600;
  line-height: 1.12;
  letter-spacing: -0.02em;
}

.button {
  margin-top: 22px;
  padding: 5px 14px;
  border: 1px solid var(--ink);
  border-radius: 3px;
  background: transparent;
  color: var(--ink);
  font: inherit;
  font-size: 13px;
  cursor: pointer;
  transition:
    background-color 120ms ease,
    color 120ms ease;
}

.button:hover {
  background: var(--ink);
  color: var(--paper);
}

.state {
  margin-top: 40px;
  color: var(--ink-3);
  font-size: 13px;
}

.state--error {
  color: #9a3f36;
}

.grid {
  display: grid;
  grid-template-columns: minmax(0, 2fr) minmax(0, 1.4fr) minmax(0, 1fr);
  gap: 24px;
  align-items: start;
  margin-top: 40px;
  padding-top: 32px;
  border-top: 1px solid var(--line);
}

.cell {
  display: grid;
  gap: 10px;
}

.cell__meta {
  display: flex;
  flex-wrap: wrap;
  align-items: baseline;
  justify-content: space-between;
  gap: 2px 8px;
  font-size: 12px;
  color: var(--ink-3);
}

.cell__title {
  color: var(--ink);
  font-size: 13px;
  font-weight: 500;
}

@media (max-width: 820px) {
  .page {
    padding: 32px 20px 56px;
  }

  .grid {
    grid-template-columns: minmax(0, 1.6fr) minmax(0, 1fr) 80px;
    gap: 14px;
  }

  .cell__meta {
    flex-direction: column;
    gap: 2px;
  }
}
</style>
