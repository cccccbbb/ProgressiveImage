import { computed, onBeforeUnmount, ref } from 'vue'

const REDUCED_MOTION_QUERY = '(prefers-reduced-motion: reduce)'

function now() {
  return typeof performance !== 'undefined' ? performance.now() : Date.now()
}

function prefersReducedMotion() {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return false
  return window.matchMedia(REDUCED_MOTION_QUERY).matches
}

/**
 * 给 URL 挂一个版本号，用来绕开缓存。
 * 自动重试和手动“重来”都需要浏览器重新发一次请求，否则第二次读的还是缓存里那份结果。
 */
function withVersion(url, version) {
  if (version <= 0) return url
  const separator = url.includes('?') ? '&' : '?'
  return `${url}${separator}r=${version}`
}

/**
 * 图片加载状态机：loading → ready → loaded，任何一步可跳 error。
 *
 * ready 和 loaded 必须分开：
 *   ready  = 像素已经到手（decode 完成），交叉淡入从这一刻开始；
 *   loaded = 淡入结束，占位层可以从 DOM 摘掉，释放低清图占的内存。
 *
 * 像素到手是异步的（decode 的 promise），所以 handleLoad 返回 Promise、载荷在 promise 里。
 * 别在 handleLoad 返回后立刻读 duration / naturalSize —— 那一刻还没填。
 *
 * @param {() => string} getSrc 取当前图片地址（属性变化要能读到新值，所以传函数）
 */
export function useImageLoad(getSrc, { retryLimit = 1, fade = 450 } = {}) {
  const status = ref('loading')
  const retryCount = ref(0)
  const version = ref(0)
  const duration = ref(null)
  const naturalSize = ref({ width: 0, height: 0 })
  const fadeMs = ref(fade)

  let startedAt = 0
  let settleTimer = null

  const resolvedSrc = computed(() => withVersion(getSrc(), version.value))
  const isBusy = computed(() => status.value === 'loading')

  function clearSettleTimer() {
    if (settleTimer !== null) {
      clearTimeout(settleTimer)
      settleTimer = null
    }
  }

  // transitionend 在 prefers-reduced-motion 或元素被隐藏时不会触发，
  // 所以用「时长 + 一点余量」的定时器兜底，保证 loaded 一定会到。
  function armSettleTimer() {
    clearSettleTimer()
    settleTimer = setTimeout(() => {
      settleTimer = null
      if (status.value === 'ready') status.value = 'loaded'
    }, fadeMs.value + 80)
  }

  function begin() {
    clearSettleTimer()
    startedAt = now()
    duration.value = null
    fadeMs.value = prefersReducedMotion() ? 0 : fade
    status.value = 'loading'
  }

  /** 浏览器缓存命中：图已在内存里，没有下载过程可看，直接到位且不过渡。 */
  function markCached(element) {
    duration.value = 0
    fadeMs.value = 0
    status.value = 'ready'
    armSettleTimer()
    return {
      cached: true,
      duration: 0,
      naturalWidth: element?.naturalWidth ?? 0,
      naturalHeight: element?.naturalHeight ?? 0,
    }
  }

  /**
   * @returns {Promise<null | {cached: boolean, duration: number, naturalWidth: number, naturalHeight: number}>}
   *          状态机不在 loading 时解析为 null（例如这次 load 属于已作废的上一轮请求）
   */
  function handleLoad(element) {
    if (status.value !== 'loading') return Promise.resolve(null)

    const token = version.value

    const settle = () => {
      // decode 可能横跨一次 src 变更，旧请求的回调不许改新一轮的状态
      if (status.value !== 'loading' || token !== version.value) return null

      const payload = {
        cached: false,
        duration: Math.max(0, Math.round(now() - startedAt)),
        naturalWidth: element?.naturalWidth ?? 0,
        naturalHeight: element?.naturalHeight ?? 0,
      }

      duration.value = payload.duration
      naturalSize.value = { width: payload.naturalWidth, height: payload.naturalHeight }
      status.value = 'ready'
      armSettleTimer()
      return payload
    }

    // decode() 等到像素可绘制才回调，避免淡入后先闪一帧白
    if (typeof element?.decode === 'function') {
      return element.decode().then(settle, settle)
    }
    return Promise.resolve(settle())
  }

  function handleError() {
    if (status.value !== 'loading') return 'ignored'

    if (retryCount.value < retryLimit) {
      retryCount.value += 1
      version.value += 1
      begin()
      return 'retried'
    }

    clearSettleTimer()
    status.value = 'error'
    return 'failed'
  }

  /** 对外的手动重来：重试计数清零，并换一个 URL 版本确保真的重新请求。 */
  function restart() {
    retryCount.value = 0
    version.value += 1
    begin()
  }

  /** src 本身变了：不必加版本号，地址已经不同，重新走一遍状态机即可。 */
  function resetForNewSource() {
    retryCount.value = 0
    begin()
  }

  onBeforeUnmount(clearSettleTimer)

  return {
    status,
    resolvedSrc,
    retryCount,
    duration,
    naturalSize,
    fadeMs,
    isBusy,
    begin,
    markCached,
    handleLoad,
    handleError,
    restart,
    resetForNewSource,
  }
}
