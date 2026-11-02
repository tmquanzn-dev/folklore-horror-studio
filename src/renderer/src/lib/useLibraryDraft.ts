import { useEffect, useState } from 'react'
import type { Library } from '../../../shared/types'
import { useApp } from '../store/appStore'

/** Bản nháp thư viện cho màn chỉnh sửa: sửa thoải mái, bấm Lưu mới ghi xuống đĩa */
export function useLibraryDraft(): {
  draft: Library | null
  dirty: boolean
  setDraft: (fn: (lib: Library) => Library) => void
  reset: () => void
  save: (keys: (keyof Library)[]) => Promise<void>
} {
  const library = useApp((s) => s.library)
  const reloadAll = useApp((s) => s.reloadAll)
  const [draft, setDraftState] = useState<Library | null>(library)
  const [dirty, setDirty] = useState(false)

  useEffect(() => {
    if (!dirty) setDraftState(library)
  }, [library, dirty])

  return {
    draft,
    dirty,
    setDraft: (fn) => {
      setDraftState((d) => (d ? fn(structuredClone(d)) : d))
      setDirty(true)
    },
    reset: () => {
      setDraftState(library)
      setDirty(false)
    },
    save: async (keys) => {
      if (!draft) return
      const patch: Partial<Library> = {}
      for (const k of keys) (patch as Record<string, unknown>)[k] = draft[k]
      await window.api.invoke('library:update', patch)
      setDirty(false)
      await reloadAll()
    }
  }
}
