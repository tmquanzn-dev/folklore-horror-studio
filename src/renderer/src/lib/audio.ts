/** Một trình phát dùng chung cho cả app: bấm nghe câu khác sẽ dừng câu đang phát */
let player: HTMLAudioElement | null = null

export function playAudio(src: string): void {
  if (!player) player = new Audio()
  player.pause()
  player.src = src
  void player.play().catch(() => undefined)
}

export function stopAudio(): void {
  player?.pause()
}
