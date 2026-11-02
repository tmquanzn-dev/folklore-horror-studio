# BỔ SUNG: NHÂN VẬT RỐI 2D (PUPPET) – CHỚP MẮT, KHỚP MÔI, BIỂU CẢM

> Đặc tả do chủ dự án cung cấp (02/11/2026). Kế hoạch: **GĐ7.1 → GĐ7.4**, làm sau GĐ6.
> Đây cũng là kết quả mục "nghiên cứu tùy chọn hoạt hình nhân vật" của GĐ6.
> Ghi chú kỹ thuật khi bắt đầu GĐ7 nằm ở cuối file.

## Mục tiêu
Cho phép một số nhân vật cử động liên tục trong video: chớp mắt, mấp máy môi theo lời thoại, thở/nhún nhẹ, đổi biểu cảm theo câu, (tùy chọn) quay đầu/vẫy tay. Mỗi nhân vật được "lắp rối" MỘT LẦN rồi dùng lại mãi; không để AI vẽ lại nhân vật ở mỗi cảnh.

Phạm vi dùng:
1. Người kể chuyện của kênh (nhân vật kênh): intro, outro, đoạn chuyển chương, đoạn giải thích truyền thuyết. Đây là ưu tiên số 1.
2. Chế độ hội thoại (cho series dạng skit trên TikTok): 2 nhân vật trên một bối cảnh, người nói khớp môi, người nghe phản ứng.
3. KHÔNG dùng cho thực thể ma (role 'entity'): ma không mấp máy môi (dễ thành hài); nếu có rối ma thì chỉ có idle + hiệu ứng chập chờn.
Các cảnh minh họa trong truyện vẫn là ảnh + 3 mức chuyển động như cũ. Bản phát hành dạng minh họa giới hạn cảnh rối ≤ 15% thời lượng (cấu hình được).

## Hai cấp độ rối
- Cấp A – Patch rig (mặc định, làm được bằng AI): 1 ảnh nhân vật đầy đủ + các "miếng vá" nhỏ cho vùng mắt và vùng miệng, đặt đúng vị trí trên ảnh gốc. Cử động: chớp mắt, khớp môi, biểu cảm (đổi bộ mắt/miệng), thở và lắc nhẹ cả thân. Ưu điểm: nhân vật luôn giống hệt vì chỉ thay vùng nhỏ.
- Cấp B – Full layered rig (người dùng tự tách lớp trong Krita/Photoshop/Figma rồi nhập): thân, đầu, tay, phụ kiện là các lớp riêng có điểm xoay (pivot) và quan hệ cha–con ⇒ thêm quay/nghiêng đầu, vẫy tay, nhìn trái/phải.

## DATA MODEL (thêm vào src/shared/types.ts, nâng cấp dữ liệu cũ qua migrate.ts)
- PuppetRig: id, characterId, name, level ('patch' | 'layered'), canvas { width, height }, basePath (ảnh gốc, nền trong suốt), regions { eyes: Rect, mouth: Rect, brows?: Rect }, layers[] (chỉ cấp B: { id, kind: 'body' | 'head' | 'eyes' | 'brows' | 'mouth' | 'armL' | 'armR' | 'accessory', path, parentId, pivot {x, y}, offset {x, y}, zIndex }), eyeSet { open, half, closed, lookLeft?, lookRight?, wide? } (đường dẫn patch/lớp), mouthSet: Record<MouthShape, string>, expressions: Record<string, { eyes: keyof eyeSet; brows?: string; mouthBias?: MouthShape; headTiltDeg?: number }>, idle { blinkMinSec, blinkMaxSec, breathAmp, swayDeg }, validated (boolean), version.
- MouthShape (bộ 9 hình kiểu hoạt hình chuẩn): 'X' (nghỉ, khép tự nhiên) | 'A' (môi khép: m, b, p) | 'B' (hé, răng cắn nhẹ: phần lớn phụ âm) | 'C' (mở vừa: e, ê) | 'D' (mở to: a) | 'E' (tròn hơi mở: ơ, ô) | 'F' (chu tròn: u, o, ư, w) | 'G' (răng chạm môi dưới: f, v, ph) | 'H' (lưỡi: l, n, th tiếng Anh).
- MouthCue: { start, end, shape }.
- Character: thêm puppetRigId?: string.
- Take (giọng từng câu): thêm alignment? { words: {word,start,end}[], chars?: {char,start,end}[] } và mouthCues? (cache theo hash take + phiên bản thuật toán).
- Release: thêm presentation ('illustrated' | 'puppetDialogue' | 'mixed') và puppetMaxRatio.
- ReleaseScene: thêm kind ('illustration' | 'puppet') và puppet? { stageId, actors: { rigId, position ('left' | 'center' | 'right'), scale, flipX, defaultExpression }[], camera ('static' | 'pushIn' | 'cutToSpeaker'), enter ('none' | 'fade' | 'slideUp') }.
- PuppetStage: id, name, backgroundPath (16:9 và 9:16), floorY, lighting ('lamp' | 'moon' | 'neutral'). Mỗi ChannelPreset có 1 stage mặc định cho người kể (ví dụ: góc nhà tối có đèn dầu).

## LOGIC KHỚP MÔI (src/shared/logic/lipsync.ts – hàm thuần, có unit test)
Đầu vào: text câu thoại, language, alignment (nếu có), envelope âm lượng của take (RMS theo từng frame, main process tính bằng ffmpeg/wav.ts), fps.
Chế độ (tự chọn theo dữ liệu có sẵn):
1. 'alignment' – có mốc từng ký tự/từ:
   - Tiếng Việt: chữ viết gần với phát âm ⇒ bảng ánh xạ theo nguyên âm và phụ âm đầu/cuối: a/ă/â → D; e/ê/i/y → C; o/ô/ơ → E; u/ư → F; m/b/p → A; ph/v → G; l/n/đ/t/d → H hoặc B; phụ âm khác → B. Thanh điệu bỏ qua. Mỗi âm tiết: phụ âm đầu ngắn (~30%), nguyên âm giữ phần còn lại; âm cuối m/p ⇒ khép A ở cuối.
   - Tiếng Anh: luật theo cụm chữ cái (oo/ou/w → F, ee/ea/i → C, a → D, o → E, m/b/p → A, f/v → G, th/l → H, còn lại B), bảng luật để trong config, không hardcode.
   - Chỉ có mốc từ ⇒ chia đều thời lượng từ cho các âm tiết/ký tự.
2. 'amplitude' – không có alignment (ví dụ OpenAI TTS, giọng tự thu): ngưỡng RMS có trễ (hysteresis) ⇒ X / B / C / D, xen A ngắn khi biên độ tụt đột ngột giữa câu.
3. 'hybrid' (mặc định khi có cả hai): hình miệng lấy từ alignment, envelope dùng để ép về X khi im lặng và thu nhỏ độ mở khi nói nhỏ (thì thầm ⇒ ưu tiên B/C thay D).
Hậu xử lý: lượng tử hóa theo frame; gộp cue < 2 frame vào cue kề; giữ A tối thiểu 2 frame; X trong mọi khoảng lặng > 120ms; đầu ra deterministic.
Adapter tùy chọn: nếu người dùng cài Rhubarb Lip Sync (CLI) và chỉ định đường dẫn trong Cài đặt, dùng nó cho giọng tự thu; lỗi thì quay về chế độ trên.

Alignment từ TTS:
- ElevenLabs: dùng endpoint trả kèm mốc thời gian ký tự nếu model đang dùng hỗ trợ; không thì để trống alignment.
- Mốc từng câu trong voice track đã biết từ bước ghép giọng ⇒ cộng offset câu vào cue.
- Không gọi Whisper chỉ để lấy alignment trừ khi người dùng bật (tốn phí, báo giá trước).

## BIỂU CẢM & HÀNH VI
- Map delivery → biểu cảm trong config: [whispers] → mắt half, miệng bias B; [nervous]/[scared] → mắt wide, nhịp chớp nhanh hơn; [sighs] → mắt half rồi closed ngắn; [laughs] → mắt cười nếu rig có.
- Người kể dùng biểu cảm 'calm' mặc định; đoạn cao trào dùng 'grave'.
- Chớp mắt: khoảng ngẫu nhiên trong [blinkMinSec, blinkMaxSec] nhưng DETERMINISTIC (PRNG seed = rigId + sceneId); chuỗi open → half → closed → half → open trong ~5 frame; không chớp giữa âm D dài.
- Người nghe (chế độ hội thoại): idle + thỉnh thoảng gật nhẹ/đổi biểu cảm theo nội dung câu của người nói (LLM gắn reaction tag ở bước chuyển thể).
- Rối thực thể: không mouthCue; idle + nhiễu nhẹ vị trí, opacity chập chờn, thỉnh thoảng "biến mất" 2–4 frame.

## REMOTION (src/remotion/PuppetLayer.tsx, PuppetScene.tsx)
- PuppetLayer nhận rig + mouthCues + expressionTimeline + idle params, vẽ bằng <Img> theo frame; cấp A: ảnh gốc + patch mắt/miệng tại regions; cấp B: cây lớp với transform quanh pivot.
- Mọi chuyển động tính từ useCurrentFrame() + PRNG có seed; tuyệt đối không Math.random/Date.now (render phải khớp preview).
- PuppetScene: nền stage, đặt actor theo position và tỷ lệ khung (bố cục riêng cho 16:9 và 9:16: 9:16 xếp dọc/cận người nói), camera pushIn chậm hoặc cutToSpeaker theo người đang nói, ánh sáng theo stage (vignette, ánh đèn dầu nhấp nháy nhẹ).
- buildCompositionProps() nhận thêm scene kind 'puppet' để Player và render dùng chung.
- Preload toàn bộ ảnh của rig trước khi phát để không nhấp nháy khi đổi hình miệng.

## TẠO RỐI (main/services/puppetService.ts + hàng đợi ảnh sẵn có)
Đường 1 – AI hỗ trợ (cấp A):
1. Tạo ảnh gốc qua ImageService: artStyle của kênh + mô tả nhân vật + "front-facing, neutral expression, mouth closed, eyes open, full upper body, plain flat background, no text", dùng character sheet làm tham chiếu.
2. Tách nền: mô hình segmentation chạy local qua onnxruntime-node (model cấu hình trong providers.json, tải ở Cài đặt) hoặc khóa màu nền phẳng nếu chưa có model.
3. Người dùng kéo khung vùng mắt và vùng miệng trên ảnh gốc (có gợi ý tự động nếu làm được, không bắt buộc).
4. Tạo biến thể bằng chỉnh sửa ảnh có tham chiếu (cùng ảnh gốc, chỉ yêu cầu đổi mắt/miệng), rồi CẮT ĐÚNG vùng regions làm patch. Patch được hòa mép (feather 2–4px) để không lộ đường ghép.
5. Patch lệch màu/lệch nét ⇒ người dùng tạo lại riêng patch đó; patch không dùng được ⇒ thay bằng hình miệng vẽ vector đơn giản theo bảng màu nhân vật (fallback, sinh bằng SVG → PNG).
Đường 2 – Nhập thủ công (cấp A hoặc B): chọn thư mục PNG theo quy ước tên (base.png, eyes_open.png, eyes_half.png, eyes_closed.png, mouth_X.png … mouth_H.png, hoặc body.png, head.png, armL.png… kèm rig.json tùy chọn), hoặc kéo thả từng file.
Kiểm tra rig (validateRig): đủ 3 trạng thái mắt, đủ tối thiểu X/A/B/D/F (hình thiếu ⇒ ánh xạ sang hình gần nhất và cảnh báo), kích thước patch khớp region, pivot nằm trong lớp.
Chi phí: mọi bước tạo ảnh đi qua hàng đợi, báo giá trước, ghi CostLedger.

## TÍCH HỢP PIPELINE
- Bước 8 (chuyển thể): với presentation 'mixed', LLM đánh dấu các đoạn người kể "lên hình"; với 'puppetDialogue', LLM gắn người nói + reaction tag cho người nghe.
- Bước 11–12 (giọng): lưu alignment nếu provider trả về; tính envelope và mouthCues cho từng take (cache theo hash).
- Bước 14 (khớp cảnh): câu của nhân vật có rig và thuộc đoạn được đánh dấu ⇒ tạo ReleaseScene kind 'puppet'; tôn trọng puppetMaxRatio; không 2 cảnh rối của cùng một actor kéo dài quá 12 giây liên tục (chèn cảnh minh họa xen giữa nếu có).
- Bước 17: cảnh rối không áp Ken Burns lên nhân vật (camera do PuppetScene quản lý).
- Bước 20 (xem trước): chỉnh biểu cảm từng câu, đổi vị trí actor, nghe–xem khớp môi.
- sources.json: ghi rig nào, ảnh gốc tạo bằng AI hay tự vẽ.

## GIAO DIỆN
- Màn mới "Rối nhân vật" (trong nhóm Nhân vật & Giọng), 3 tab:
  - Tạo: chọn nhân vật → Tạo ảnh gốc / Nhập thư mục → tách nền → kéo khung vùng mắt, miệng.
  - Lắp ráp: lưới các patch/lớp (mắt × 3, miệng × 9, biểu cảm), tạo lại từng ô, kéo pivot (cấp B), thanh trượt chỉnh offset; huy hiệu thiếu/đủ.
  - Thử: Remotion Player mini; chọn một câu có sẵn hoặc gõ câu thử (Mock TTS khi ở chế độ Mock) ⇒ xem khớp môi; nút phát lần lượt 9 hình miệng; thanh trượt tốc độ chớp mắt, biên độ thở.
- Inspector cảnh ở AutoEdit: với cảnh rối hiển thị actor, vị trí, biểu cảm mặc định, camera, kiểu vào cảnh; timeline có track phụ "Miệng" hiển thị dải MouthCue (chỉ xem).
- Kênh & Nhân vật: chọn PuppetStage mặc định cho người kể.

## YÊU CẦU PHI CHỨC NĂNG
- Chế độ Mock: có sẵn rig mẫu sinh bằng code (khuôn mặt đơn giản SVG → PNG bằng sharp, đủ 3 mắt + 9 miệng) để toàn bộ tính năng chạy offline, không tốn phí.
- Hiệu năng: rig cấp A ≤ 15 ảnh, mỗi patch ≤ 512px; render cảnh rối không chậm hơn cảnh Ken Burns quá 1,5 lần.
- Unit test: ánh xạ viseme tiếng Việt và tiếng Anh (có ca có dấu, âm cuối m/p, từ ghép), chia mốc khi chỉ có mốc từ, chế độ amplitude có hysteresis, gộp cue ngắn, X trong khoảng lặng, chớp mắt deterministic (2 lần gọi cùng seed ra cùng kết quả), validateRig, chọn cảnh rối theo puppetMaxRatio, migrate dữ liệu cũ (không có rig vẫn chạy như trước).

## GIAI ĐOẠN (đặt sau GĐ6, chia nhỏ để mỗi phần ra kết quả xem được)
- GĐ7.1: data model + migrate, lipsync.ts + test, PuppetLayer/PuppetScene, rig Mock, rig mẫu cho người kể chuyện trong sampleData; Story mẫu có intro người kể khớp môi render ra MP4.
- GĐ7.2: màn Rối nhân vật – nhập thủ công (cấp A và B), validateRig, tab Thử.
- GĐ7.3: tạo rối bằng AI (ảnh gốc, tách nền, patch qua chỉnh sửa ảnh), fallback miệng vector.
- GĐ7.4: tích hợp pipeline (mixed + puppetDialogue), biểu cảm theo delivery, phản ứng người nghe, bố cục 9:16.

Tiêu chí hoàn thành GĐ7.1: chạy Story mẫu ở chế độ Mock, video có đoạn intro người kể chớp mắt tự nhiên, miệng mở/khép khớp lời (kiểm tra bằng mắt: khép ở âm m/b/p, nghỉ khi im lặng), xem trước và bản render giống hệt nhau; npm test xanh.

---

## Ghi chú kỹ thuật cho GĐ7 (từ trạng thái code sau GĐ6)

- **Mốc từ đã có sẵn cho giọng tự thu:** `ScriptLine.wordTimings` (GĐ6, căn bằng Whisper qua `shared/logic/align.ts`) dùng thẳng làm alignment cấp từ cho chế độ 'alignment'/'hybrid' – không cần gọi Whisper thêm.
- **Giọng TTS:** chưa lưu alignment. ElevenLabs có endpoint `.../with-timestamps` trả mốc ký tự – thêm vào `providers/tts/elevenlabs.ts`, lưu vào `Take.alignment`.
- **Envelope:** `main/media/wav.ts` đã đọc PCM 16-bit ⇒ RMS theo frame tính trực tiếp, không cần ffmpeg.
- **Render khớp preview:** composition dùng chung `buildCompositionProps` cho Player và render – thêm `kind: 'puppet'` vào `CompositionScene` theo cùng cách `clip`/`layers` đang làm.
- **Fingerprint render** (`main/render/fingerprint.ts`) hash toàn bộ props ⇒ đổi rig/mouthCue tự làm checklist "bản render đã cũ" đúng, không cần sửa thêm.
- **Luật đa dạng:** cảnh rối có `motion.type` riêng (vd 'puppet') ⇒ `findDiversityViolations` sẽ coi 2 cảnh rối liền nhau là vi phạm – cần miễn trừ, hoặc dùng luật "≤ 12 giây liên tục" như đặc tả.
