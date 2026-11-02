/**
 * GĐ7.1 – Rối 2D của nhân vật: xem thử (chớp mắt + lần lượt 9 hình miệng), tạo rối Mock, bỏ rối.
 * Màn "Rối nhân vật" đầy đủ (nhập thủ công, cấp B, tab Thử với Remotion Player) – GĐ7.2.
 */
import { useEffect, useState } from 'react'
import { MOUTH_SHAPES, type EyeState, type MouthShape } from '../../../../shared/types'
import { AsyncButton } from '../../components/forms'
import { buildMediaUrl } from '../../../../shared/media'
import { useApp } from '../../store/appStore'

const MOUTH_HINT: Record<MouthShape, string> = {
  X: 'nghỉ',
  A: 'm b p',
  B: 'hé',
  C: 'e i',
  D: 'a',
  E: 'ô ơ',
  F: 'u o',
  G: 'f v',
  H: 'l n th'
}

export function PuppetPanel({ characterId }: { characterId: string }): JSX.Element | null {
  const library = useApp((s) => s.library)
  const reloadAll = useApp((s) => s.reloadAll)
  const base = useApp((st) => st.appInfo?.mediaBaseUrl ?? '')
  const c = library?.characters.find((x) => x.id === characterId)
  const rig = library?.puppetRigs.find((r) => r.id === c?.puppetRigId) ?? null
  const [tick, setTick] = useState(0)
  useEffect(() => {
    if (!rig) return
    const id = window.setInterval(() => setTick((t) => t + 1), 140)
    return () => window.clearInterval(id)
  }, [rig])
  if (!c) return null

  const entity = c.role === 'entity'
  const mouth: MouthShape = MOUTH_SHAPES[Math.floor(tick / 3) % MOUTH_SHAPES.length]
  const phase = tick % 28
  const eye: EyeState = phase === 0 || phase === 3 ? 'half' : phase === 1 || phase === 2 ? 'closed' : 'open'
  const box = 150
  const s = rig ? box / rig.canvas.height : 1
  const at = (r: { x: number; y: number; w: number; h: number }): React.CSSProperties => ({ position: 'absolute', left: r.x * s, top: r.y * s, width: r.w * s, height: r.h * s })
  const v = rig?.createdAt
  const u = (rel: string): string => buildMediaUrl(base, '_characters', rel, v)

  return (
    <div className="mt-3 rounded-md border border-ink-600 bg-ink-900/40 p-3">
      <div className="mb-2 flex items-center gap-2">
        <span className="text-[11px] uppercase tracking-wide text-slate-500">Rối 2D (chớp mắt, khớp môi)</span>
        {rig ? <span className={`chip ${rig.validated ? 'text-emerald-300' : 'text-amber-300'}`}>{rig.validated ? 'đủ hình' : 'thiếu hình'} · {rig.source}</span> : null}
        <div className="flex-1" />
        {!entity ? (
          <AsyncButton
            className="btn-secondary px-2 py-1 text-xs"
            confirm={rig ? 'Tạo lại rối Mock sẽ thay ảnh rối hiện tại. Tiếp tục?' : undefined}
            onClick={async () => {
              await window.api.invoke('puppet:createMock', characterId)
              await reloadAll()
            }}
          >
            {rig ? 'Tạo lại rối Mock' : 'Tạo rối Mock (miễn phí)'}
          </AsyncButton>
        ) : null}
        {rig ? (
          <AsyncButton
            className="btn-ghost px-2 py-1 text-xs text-red-300"
            confirm="Bỏ rối của nhân vật này? Cảnh người kể sẽ quay về ảnh minh hoạ ở lần chạy sau (từ bước 14)."
            onClick={async () => {
              await window.api.invoke('puppet:remove', characterId)
              await reloadAll()
            }}
          >
            Bỏ rối
          </AsyncButton>
        ) : null}
      </div>
      {entity ? (
        <p className="text-xs text-slate-500">Thực thể ma không dùng rối khớp môi (ma mấp máy môi dễ thành hài) – ma xuất hiện qua ảnh, bóng tối, video AI.</p>
      ) : !rig ? (
        <p className="text-xs text-slate-500">
          Chưa có rối. Có rối ⇒ cảnh có nhân vật này (vd người kể ở intro, đoạn giải thích) được diễn bằng rối: chớp mắt tự nhiên, miệng khớp lời, thở nhẹ – tối đa 15% thời lượng
          video. Rối Mock vẽ bằng code để thử; rối từ ảnh thật/AI ở GĐ7.2–7.3.
        </p>
      ) : (
        <div className="flex gap-4">
          <div className="relative shrink-0 overflow-hidden rounded bg-gradient-to-b from-[#2b1d14] to-[#120c08]" style={{ width: rig.canvas.width * s, height: box }}>
            <img src={u(rig.basePath)} style={{ position: 'absolute', inset: 0, width: '100%', height: '100%' }} alt="" />
            <img src={u(rig.eyeSet[eye] ?? rig.eyeSet.open)} style={at(rig.regions.eyes)} alt="" />
            <img src={u(rig.mouthSet[mouth])} style={at(rig.regions.mouth)} alt="" />
          </div>
          <div className="min-w-0 flex-1">
            <div className="mb-1 text-[11px] text-slate-500">9 hình miệng (đang phát: <b className="text-slate-300">{mouth}</b> – {MOUTH_HINT[mouth]})</div>
            <div className="grid grid-cols-9 gap-1">
              {MOUTH_SHAPES.map((m) => (
                <div key={m} className={`rounded border p-0.5 text-center ${m === mouth ? 'border-blood-500' : 'border-ink-600'}`} title={MOUTH_HINT[m]}>
                  <img src={u(rig.mouthSet[m])} className="w-full" alt={m} />
                  <div className="text-[10px] text-slate-400">{m}</div>
                </div>
              ))}
            </div>
            <div className="mt-2 grid grid-cols-4 gap-1">
              {(['open', 'half', 'closed', 'wide'] as const).map((st) =>
                rig.eyeSet[st] ? (
                  <div key={st} className="rounded border border-ink-600 p-0.5 text-center">
                    <img src={u(rig.eyeSet[st] as string)} className="w-full" alt={st} />
                    <div className="text-[10px] text-slate-400">{st === 'open' ? 'mở' : st === 'half' ? 'lim dim' : st === 'closed' ? 'nhắm' : 'mở to'}</div>
                  </div>
                ) : null
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
