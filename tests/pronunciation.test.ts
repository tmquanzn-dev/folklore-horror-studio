import { describe, expect, it } from 'vitest'
import { applyPronunciation, findTermIds } from '../src/shared/logic/pronunciation'
import type { PronunciationEntry } from '../src/shared/types'

const entries: PronunciationEntry[] = [
  { id: 'a', language: 'en', term: 'ma da', ttsRespelling: 'mah yah', notes: '' },
  { id: 'b', language: 'en', term: 'đò', ttsRespelling: 'daw', notes: '' },
  { id: 'c', language: 'en', term: 'cây đa', ttsRespelling: 'kay dah', notes: '' },
  { id: 'd', language: 'en', term: 'đa', ttsRespelling: 'DAH', notes: '' },
  { id: 'e', language: 'vi', term: 'TikTok', ttsRespelling: 'tíc tóc', notes: '' }
]

describe('applyPronunciation', () => {
  it('thay thuật ngữ, không phân biệt hoa thường', () => {
    expect(applyPronunciation('The Ma Da waits.', entries, 'en').text).toBe('The mah yah waits.')
  })

  it('chỉ khớp nguyên từ (ranh giới Unicode)', () => {
    // "đò" không được khớp bên trong "đòn"
    expect(applyPronunciation('a đòn and a đò.', entries, 'en').text).toBe('a đòn and a daw.')
  })

  it('cụm dài ưu tiên trước, không thay chồng lên nhau', () => {
    const r = applyPronunciation('the old cây đa and đa', entries, 'en')
    expect(r.text).toBe('the old kay dah and DAH')
    expect(r.appliedIds.sort()).toEqual(['c', 'd'])
  })

  it('lọc theo ngôn ngữ', () => {
    expect(applyPronunciation('Xem trên TikTok', entries, 'vi').text).toBe('Xem trên tíc tóc')
    expect(applyPronunciation('Xem trên TikTok', entries, 'en').text).toBe('Xem trên TikTok')
  })

  it('chuẩn hoá NFC (chữ có dấu tổ hợp vẫn khớp)', () => {
    const decomposed = 'đò'.normalize('NFD')
    expect(applyPronunciation(`a ${decomposed}`, entries, 'en').text).toBe('a daw')
  })

  it('findTermIds trả về id thuật ngữ xuất hiện', () => {
    expect(findTermIds('nothing here', entries, 'en')).toEqual([])
    expect(findTermIds('ma da', entries, 'en')).toEqual(['a'])
  })
})
