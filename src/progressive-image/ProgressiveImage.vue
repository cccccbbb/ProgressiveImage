<script setup>
import { computed, onMounted, ref, watch } from 'vue'
import { useImageLoad } from './useImageLoad.js'

const props = defineProps({
  /** 高清图地址。必填，组件一挂载就开始请求。 */
  src: { type: String, required: true },
  /** 20–32px 宽的低清图，建议内联成 data URI，这样它一定比高清图先到。 */
  lowRes: { type: String, required: true },
  /** 语义描述，挂在真正的 <img> 上；低清图那一层一律 aria-hidden。 */
  alt: { type: String, default: '' },
  /** 宽高比，数字或 CSS 写法都行。占位靠它撑住，避免布局抖动。 */
  ratio: { type: [Number, String], default: 16 / 9 },
  /** object-fit */
  fit: { type: String, default: 'cover' },
  /** 圆角，数字（px）或 CSS 长度字符串。 */
  radius: { type: [Number, String], default: 0 },
  /** 交叉淡入时长，毫秒。reduced-motion 下自动归零。 */
  fade: { type: Number, default: 450 },
  /** 首次失败后自动重试几次，0 表示不自动重试。 */
  retryLimit: { type: Number, default: 1 },
})

const emit = defineEmits(['load', 'error', 'retry'])

const imgEl = ref(null)

const {
  status,
  resolvedSrc,
  retryCount,
  fadeMs,
  isBusy,
  begin,
  markCached,
  handleLoad,
  handleError,
  restart,
  resetForNewSource,
} = useImageLoad(() => props.src, { retryLimit: props.retryLimit, fade: props.fade })

// 挂载前先起跑计时，避免「图在挂载前就 load 完」这种时序把计时器弄乱
begin()

if (import.meta.env.DEV && !props.lowRes) {
  console.warn('[ProgressiveImage] lowRes 为空，占位层只会露出纯色底。')
}

const showPlaceholder = computed(() => status.value === 'loading' || status.value === 'ready')
const ghostFaded = computed(() => status.value === 'ready')
const isPainted = computed(() => status.value === 'ready' || status.value === 'loaded')

const rootStyle = computed(() => ({
  '--pimg-fade': `${fadeMs.value}ms`,
  '--pimg-ratio': typeof props.ratio === 'number' ? String(props.ratio) : props.ratio,
  '--pimg-fit': props.fit,
  '--pimg-radius': typeof props.radius === 'number' ? `${props.radius}px` : props.radius,
}))

function announce(payload) {
  if (!payload) return
  emit('load', { src: props.src, ...payload })
}

function onImageLoad(event) {
  // 载荷要等 decode 完成才有，所以只能在 promise 里发事件
  handleLoad(imgEl.value || event.target).then(announce)
}

function onImageError() {
  const outcome = handleError()
  if (outcome === 'retried') {
    emit('retry', { src: props.src, attempt: retryCount.value })
  } else if (outcome === 'failed') {
    emit('error', { src: resolvedSrc.value, attempts: retryCount.value + 1 })
  }
}

onMounted(() => {
  const element = imgEl.value
  if (!element?.complete) return
  if (element.naturalWidth > 0) {
    announce(markCached(element))
    return
  }
  // 挂载时就已经是坏的（例如 src 指向 404 且缓存了失败结果）
  onImageError()
})

watch(
  () => props.src,
  () => resetForNewSource(),
)

defineExpose({ reload: restart })
</script>

<template>
  <figure class="pimg" :style="rootStyle" :aria-busy="isBusy ? 'true' : 'false'">
    <div class="pimg__stage">
      <img
        ref="imgEl"
        class="pimg__img"
        :class="{ 'pimg__img--in': isPainted }"
        :src="resolvedSrc"
        :alt="alt"
        decoding="async"
        draggable="false"
        @load="onImageLoad"
        @error="onImageError"
      />

      <div
        v-if="showPlaceholder"
        class="pimg__ghost"
        :class="{ 'pimg__ghost--out': ghostFaded }"
        aria-hidden="true"
      >
        <img class="pimg__ghost-img" :src="lowRes" alt="" decoding="async" draggable="false" />
      </div>

      <div v-if="status === 'error'" class="pimg__error">
        <slot name="error" :retry="restart" :src="src">
          <p class="pimg__error-text">这张图没能加载出来</p>
          <button type="button" class="pimg__retry" @click="restart">重试</button>
        </slot>
      </div>
    </div>
  </figure>
</template>

<style scoped>
.pimg {
  --pimg-tint-base: #dfe4dd;
  position: relative;
  display: block;
}

.pimg__stage {
  position: relative;
  aspect-ratio: var(--pimg-ratio, 16 / 9);
  overflow: hidden;
  border-radius: var(--pimg-radius, 0);
  background: var(--pimg-tint-base);
  isolation: isolate;
  container: pimg-stage / inline-size;
}

.pimg__img {
  position: absolute;
  inset: 0;
  display: block;
  width: 100%;
  height: 100%;
  object-fit: var(--pimg-fit, cover);
  opacity: 0;
  transition: opacity var(--pimg-fade, 450ms) ease;
}

.pimg__img--in {
  opacity: 1;
}

.pimg__ghost {
  position: absolute;
  inset: 0;
  overflow: hidden;
  background: var(--pimg-tint-base);
  transition: opacity var(--pimg-fade, 450ms) ease;
}

.pimg__ghost--out {
  opacity: 0;
}

.pimg__ghost-img {
  display: block;
  width: 100%;
  height: 100%;
  object-fit: cover;
  /* 低清图放大后边缘会露出硬边，模糊 + 微放大一起盖住 */
  filter: blur(16px);
  transform: scale(1.08);
}

.pimg__error {
  position: absolute;
  inset: 0;
  display: grid;
  place-content: center;
  justify-items: center;
  gap: 10px;
  padding: 12px;
  text-align: center;
  background: #e9ebe5;
  color: #4d564e;
}

/* 头像那种小方框里塞不下整句话，就只留重试按钮 */
@container pimg-stage (max-width: 168px) {
  .pimg__error-text {
    display: none;
  }

  .pimg__error {
    gap: 6px;
    padding: 8px;
  }
}

.pimg__error-text {
  margin: 0;
  font-size: 12px;
  line-height: 1.5;
}

.pimg__retry {
  font: inherit;
  font-size: 12px;
  padding: 4px 12px;
  border: 1px solid currentColor;
  border-radius: 3px;
  background: transparent;
  color: inherit;
  cursor: pointer;
}

.pimg__retry:hover {
  background: #4d564e;
  color: #f2f4ef;
}

@media (prefers-reduced-motion: reduce) {
  .pimg__img,
  .pimg__ghost {
    transition: none;
  }
}
</style>
