<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref, watch } from 'vue'

const MAX_LOADS_PER_FRAME = 3
const imageLoadQueue: Array<() => void> = []
let imageLoadFrameId: number | undefined

function flushImageLoadQueue(): void {
  imageLoadFrameId = undefined
  for (let index = 0; index < MAX_LOADS_PER_FRAME; index += 1) {
    imageLoadQueue.shift()?.()
  }

  if (imageLoadQueue.length > 0) {
    imageLoadFrameId = requestAnimationFrame(flushImageLoadQueue)
  }
}

function queueImageLoad(loadImage: () => void): void {
  imageLoadQueue.push(loadImage)
  if (imageLoadFrameId === undefined) {
    imageLoadFrameId = requestAnimationFrame(flushImageLoadQueue)
  }
}

const props = withDefaults(defineProps<{
  src: string
  alt?: string
  rootMargin?: string
}>(), {
  alt: '',
  rootMargin: '240px',
})

const imageElement = ref<HTMLImageElement | null>(null)
const loadedSrc = ref<string>()
let observer: IntersectionObserver | undefined
let loadVersion = 0

function stopObserving(): void {
  observer?.disconnect()
  observer = undefined
}

function observeImage(): void {
  stopObserving()
  if (!imageElement.value || !props.src) {
    return
  }

  if (!('IntersectionObserver' in window)) {
    queueImageLoad(() => {
      loadedSrc.value = props.src
    })
    return
  }

  observer = new IntersectionObserver((entries) => {
    if (!entries.some((entry) => entry.isIntersecting)) {
      return
    }

    stopObserving()
    const currentVersion = loadVersion
    queueImageLoad(() => {
      if (currentVersion === loadVersion) {
        loadedSrc.value = props.src
      }
    })
  }, { rootMargin: props.rootMargin })
  observer.observe(imageElement.value)
}

watch(() => props.src, () => {
  loadVersion += 1
  loadedSrc.value = undefined
  if (imageElement.value) {
    observeImage()
  }
})

onMounted(observeImage)
onBeforeUnmount(() => {
  loadVersion += 1
  stopObserving()
})
</script>

<template>
  <img
    ref="imageElement"
    :alt="alt"
    :src="loadedSrc"
    decoding="async"
    loading="lazy"
  >
</template>
