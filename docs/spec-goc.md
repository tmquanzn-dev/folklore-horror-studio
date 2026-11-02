# Đặc tả gốc – Folklore Horror Studio

> Bản đặc tả chủ dự án gửi lúc bắt đầu (GĐ1). Các giai đoạn GĐ1–GĐ6 đã hoàn thành theo tài liệu này.

# VAI TRÒ
Bạn là Senior Full-Stack Developer (Electron/React/TypeScript/Node.js) kiêm AI Solutions Architect, có hiểu biết về sản xuất audio/video và nội dung kể chuyện trên YouTube/TikTok. Người dùng là sinh viên năm 3 người Việt, nền tảng Java, đang học JavaScript, tiếng Anh ở mức đọc hiểu, dự định khởi nghiệp bằng YouTube và TikTok. Hãy giải thích ngắn gọn các quyết định quan trọng, code rõ ràng, comment tiếng Việt ở chỗ khó.

# BỐI CẢNH & MỤC TIÊU SẢN PHẨM
Xây dựng ứng dụng desktop "Folklore Horror Studio" chạy trên Windows 10/11 để sản xuất video kể chuyện kinh dị dân gian Việt Nam và Đông Nam Á (ma da, ma lai, quỷ nhập tràng, ngải, bùa yêu...).

Mô hình cốt lõi: MỘT câu chuyện (Story) → NHIỀU bản phát hành (Release).
- Dùng chung trong Story: truyền thuyết, dàn ý theo các beat, nhân vật, ngân hàng cảnh (ảnh/video), thư viện âm thanh.
- Riêng từng Release: ngôn ngữ, nền tảng, kịch bản, giọng đọc, phụ đề, khung hình, độ dài, tỷ lệ video AI, gói đăng bài.

Release mặc định:
- YouTube – tiếng Anh: 16:9, 15–40 phút, khán giả quốc tế; cấu trúc cold open → bối cảnh văn hóa → câu chuyện → giải thích truyền thuyết → outro; có chapters; giọng kể chậm, u ám.
- TikTok – tiếng Việt: 9:16, chia thành nhiều phần khoảng 1 phút 30 (Phần 1/N...), móc trong 2–3 giây đầu, mỗi phần kết bằng câu treo; giọng kể gần gũi kiểu "chuyện kể đêm khuya"; không giải thích những điều khán giả Việt đã biết.
- Kiến trúc phải cho phép thêm Release khác (YouTube Shorts tiếng Anh, YouTube tiếng Việt...) mà không sửa thiết kế.

Quy trình kinh doanh cần hỗ trợ: thử truyện trên TikTok tiếng Việt trước → ghi lại hiệu quả → truyện tốt thì "chuyển thể" sang Release YouTube tiếng Anh, tái sử dụng ngân hàng cảnh.

Giao diện app: tiếng Việt. Mọi văn bản tiếng Anh người dùng cần duyệt đều có bản dịch tiếng Việt đặt cạnh.

# NGUYÊN TẮC SẢN PHẨM (BẮT BUỘC)
1. Human-in-the-loop: pipeline mặc định dừng ở các điểm duyệt. "Full Auto" chỉ để tạo bản nháp.
2. Chuyển thể, không dịch máy móc: mỗi Release được LLM viết lại từ dàn ý chung theo ngôn ngữ, văn hóa khán giả, nền tảng và độ dài.
3. Giọng đọc là trọng tâm: kiểm soát cảm xúc, nhịp, khoảng lặng tới từng câu; tạo lại từng câu độc lập.
4. Tái sử dụng tối đa tài sản dùng chung; chỉ tạo media mới khi thật sự thiếu.
5. Chính xác và tôn trọng văn hóa: phân biệt truyền thuyết dân gian có thật với phần hư cấu; không chế giễu tín ngưỡng; không gắn chuyện vào người thật, bi kịch có thật gần đây hay địa danh cụ thể theo cách gây hiểu lầm.
6. Thân thiện quảng cáo: kinh dị bằng không khí, bóng tối, âm thanh, gợi ý; không máu me, không bạo lực chi tiết.
7. Chống nội dung lặp lại: đa dạng cỡ cảnh, góc máy, chuyển động; không có tính năng đăng hàng loạt tự động.
8. Minh bạch và hợp pháp: lưu nguồn gốc mọi media; chỉ dùng nhạc/SFX có giấy phép; cảnh báo nếu provider giọng đọc chưa được đánh dấu có giấy phép thương mại.
9. Kiểm soát chi phí: ước tính trước, giới hạn ngân sách theo Story và theo tháng, ghi chi phí thực tế.

# CHUYỂN ĐỘNG – 3 MỨC
Video không bao giờ là ảnh đứng yên. Mỗi cảnh có một mức chuyển động:
- Mức 1 – Ken Burns (mặc định mọi cảnh, chạy local, miễn phí): zoomIn, zoomOut, panLeft, panRight, panUp, panDown với intensity, easing, focusPoint.
- Mức 2 – Parallax 2.5D (cảnh được chọn, chạy local): depth map → tách 2–3 lớp (tiền cảnh/chủ thể/hậu cảnh) → các lớp dịch chuyển khác tốc độ tạo cảm giác máy quay 3D.
- Mức 3 – Video AI (cảnh hero, tốn phí): image-to-video từ ảnh cảnh, vài giây chuyển động thật (nước gợn, tóc bay, bóng ma trồi lên). Tỷ lệ cảnh hero cấu hình theo Release (mặc định YouTube 5%, TikTok 15–20%), luôn báo giá và chờ xác nhận; lỗi thì tự quay về Mức 1/2.
Bổ sung: chuyển cảnh (cut, fade, dip-to-black, flash ngắn ở cao trào); cường độ chuyển động theo cường độ cảm xúc của beat (beat căng thẳng → zoom vào chậm, áp sát); phụ đề động; luật đa dạng: không 2 cảnh liền nhau cùng shotType và cùng kiểu chuyển động.

# QUYẾT ĐỊNH CÔNG NGHỆ (ĐÃ CHỐT – KHÔNG ĐỀ XUẤT LẠI)
- Desktop: Electron + electron-vite + React 18 + TypeScript (strict) + TailwindCSS + Zustand.
- Tiến trình: logic nặng (API, queue, ffmpeg, render) chạy ở Main process / utility process. Renderer chỉ làm UI, giao tiếp qua preload + IPC có kiểu (contextIsolation: true, nodeIntegration: false).
- Hàng đợi: p-queue (concurrency 1–20); không dùng worker thread cho gọi API.
- Lưu trữ: mỗi Story là một thư mục (story.json, bank/, releases/<releaseId>/{voice,sfx,exports}/, cache/). Settings dùng electron-store. API key mã hóa bằng Electron safeStorage, không gửi sang renderer.
- TTS (cốt lõi, đa ngôn ngữ): interface TtsProvider với adapter:
  - ElevenLabs (model eleven_v3, hỗ trợ tiếng Anh và tiếng Việt, audio tag dạng [whispers], [sighs], [nervous]...; endpoint dialogue cho nhiều nhân vật).
  - OpenAI (gpt-4o-mini-tts, điều khiển giọng bằng trường instructions).
  - Mock: sinh audio im lặng/tone bằng ffmpeg, thời lượng ước tính theo số từ, để chạy toàn app không cần API key.
  - Adapter tự chuyển delivery chung (tags/instructions) sang định dạng từng provider.
- Speech-to-text: OpenAI Whisper API (word + segment timestamps), dùng khi người dùng tự thu âm hoặc để kiểm tra TTS đọc đúng.
- LLM: interface LlmProvider; adapter mặc định OpenAI. Output luôn là JSON, validate bằng zod, retry khi sai schema.
- Ảnh: interface ImageProvider; adapter Google Gemini image (Nano Banana) qua @google/genai; adapter Mock dùng sharp.
- Video AI: interface VideoProvider (image-to-video); adapter cụ thể chọn ở GĐ4, có adapter Mock (tạo clip ngắn từ ảnh bằng ffmpeg).
- Audio: FFmpeg/ffprobe qua ffmpeg-static, ffprobe-static (ghép câu, xử lý giọng, mix đa lớp, sidechain ducking, chuẩn loudness).
- Render: Remotion (@remotion/player để preview; @remotion/bundler + @remotion/renderer chạy trong utility process riêng). Cùng một composition render được 16:9 và 9:16.
- Parallax: depth map local bằng onnxruntime-node (model cấu hình được).
- Model id, đơn giá, rate limit, danh sách audio tag hợp lệ của từng provider, preset theo nền tảng: để trong file config, không hardcode.

# DATA MODEL – NGUỒN SỰ THẬT DUY NHẤT
Định nghĩa trong src/shared/types.ts. Thời gian lưu bằng giây (number).

Kênh & tri thức (dùng xuyên các Story):
- ChannelPreset: id, name, artStyle, negativePrompt (không chữ trong ảnh, không torii, không kimono, không kiến trúc Nhật/Trung, không máu me), palette, culturalVisualBible (làng quê đồng bằng, sông nước, nhà sàn, bàn thờ, nhang khói, áo bà ba, cây đa, đèn dầu...), motionProfile, soundPalette, defaultVoiceByLanguage { en, vi }, subtitleStyleByPlatform, platformDefaults (thời lượng, heroRatio, cấu trúc kịch bản).
- FolkloreEntry: id, nameVi, nameEn, region, summaryVi, summaryEn, visualDesign (ngoại hình cố định), referenceImages[], sources[] (người dùng nhập), isDocumentedFolklore.
- PronunciationEntry: id, language, term (hiển thị), ttsRespelling (chỉ dùng cho văn bản gửi TTS), notes.
- Character: id, name, role ('narrator' | 'character' | 'entity'), description, referenceImages[], expressionSheet, voiceProfileIdByLanguage.
- VoiceProfile: id, name, language, providerId, providerVoiceId, baseInstructions, defaultTags[], speed, providerSettings, postProcessChain (lọc tần thấp, nén, EQ ấm, reverb nhẹ), commercialLicenseConfirmed.
- SoundAsset: id, path, tags[], license, source.

Story (dùng chung):
- Story: id, name, channelPresetId, folkloreIds[], premiseVi (ý tưởng gốc), outline, characterIds[], sceneBank[], releaseIds[], status ('draft' | 'testing' | 'adapted' | 'archived'), budget, createdAt, updatedAt.
- Outline: beats[] { id, order, summaryVi, summaryEn, emotionalIntensity (0–1), mustShow[] }.
- SceneBankItem: id, beatId, description, shotType ('wide' | 'medium' | 'closeUp' | 'overShoulder' | 'topDown' | 'insert'), cameraAngle, characterIds[], folkloreIds[], expression, imagePrompt, media { '16:9': MediaRef | null, '9:16': MediaRef | null }, focusPoint {x, y}, depthMapPath, heroClip { '16:9': MediaRef | null, '9:16': MediaRef | null }, variants[], approval.
- MediaRef: path, mediaType ('image' | 'video'), source ('ai' | 'stock' | 'own'), provider, model, cost, createdAt.

Release (riêng từng bản):
- Release: id, storyId, platform ('youtube' | 'tiktok' | 'youtubeShorts'), language ('en' | 'vi'), aspectRatio, targetDuration, seriesGroupId, partIndex, partCount, heroRatio, script, voiceTrack, scenes[], chapters[], subtitles[], soundCues[], publishing, costs, pipelineState.
- Script: sections[] { id, kind ('hook' | 'coldOpen' | 'context' | 'story' | 'folkloreExplainer' | 'cliffhanger' | 'outro'), title }, lines[].
- ScriptLine: id, sectionId, beatId, speakerId, text, translationVi (chỉ khi language khác 'vi'), delivery { tags[], instructions, pace, pauseBeforeMs, pauseAfterMs }, takes[] { path, provider, duration, createdAt }, selectedTakeId, start, end, glossaryTermIds[], approval.
- VoiceTrack: mode ('tts' | 'recorded'), mixedPath, processedPath, duration.
- ReleaseScene: id, sceneBankId, start, end, lineIds[], mediaOverride, motion, transition, isHero.
- Motion: level ('kenBurns' | 'parallax' | 'aiVideo'), type, intensity, easing, focusPoint.
- SubtitleCue: id, start, end, text, words[], glossaryTermIds[], styleId ('youtube' | 'tiktok').
- SoundCue: id, kind ('ambience' | 'sfx' | 'stinger' | 'music' | 'silence'), assetId, start, end, volume, fadeIn, fadeOut.
- PublishingPackage: youtube { titleOptions[], description (chapters + glossary + ghi chú nguồn truyền thuyết), tags[], thumbnailConcepts[] } | tiktok { captionVi, hashtags[], coverConcepts[], partLabel }, aiDisclosureNeeded, checklist[].
- PerformanceNote: id, releaseId, date, views, avgWatchPercent, likes, comments, shares, notes (người dùng tự nhập sau khi đăng).
- CostLedger: estimated, actual, budgetLimit, entries[] { provider, kind, units, cost, timestamp }.
- Job: id, type, payload, status ('queued' | 'running' | 'done' | 'failed' | 'cancelled'), attempts, error, result, estimatedCost.

# PIPELINE SẢN XUẤT
Mỗi bước báo tiến độ (%, thời gian đã chạy, ước tính còn lại), lưu trạng thái, chạy lại riêng được bước lỗi. ★ = điểm duyệt (bỏ qua khi Full Auto).

A. CẤP STORY (làm một lần)
1. Tạo Story: chọn ChannelPreset, FolkloreEntry, nhập ý tưởng bằng tiếng Việt, đặt ngân sách.
2. LLM tạo dàn ý theo beat (song ngữ), gán cường độ cảm xúc.
3. ★ Duyệt dàn ý.
4. LLM đề xuất ngân hàng cảnh theo beat (shotType, góc máy, nhân vật, thực thể, biểu cảm, prompt), tuân luật đa dạng; đánh dấu cảnh cần bản 9:16 riêng.
5. Ước tính chi phí; vượt ngân sách thì dừng và hỏi.
6. Tạo ảnh song song: 16:9 cho mọi cảnh, 9:16 cho cảnh được đánh dấu (prompt = artStyle + culturalVisualBible + visualDesign thực thể + mô tả nhân vật + biểu cảm + shotType + hành động; thực thể đáng sợ được gợi qua bóng tối, bóng đổ, chi tiết nhỏ).
7. ★ Duyệt storyboard.

B. CẤP RELEASE (lặp cho từng bản)
8. LLM chuyển thể kịch bản từ dàn ý theo ngôn ngữ, nền tảng, độ dài. TikTok: chia phần, mỗi phần có hook đầu và cliffhanger cuối. YouTube: cold open, context, story, folkloreExplainer, outro.
9. ★ Duyệt kịch bản (bản tiếng Anh có cột dịch tiếng Việt).
10. Áp từ điển phát âm theo ngôn ngữ.
11. Tạo giọng từng câu song song (hoặc nhập file tự thu → Whisper lấy mốc).
12. Xử lý giọng, ghép câu với pauseBefore/After → mốc start/end chính xác từng câu.
13. ★ Duyệt giọng: nghe, tạo lại câu lỗi, chọn take, chỉnh tag/nhịp.
14. Khớp cảnh: gán cảnh từ ngân hàng vào câu theo beat (3–8 giây/cảnh, không cắt giữa câu); thiếu cảnh thì đề xuất tạo thêm và đưa vào hàng đợi.
15. Khung hình: Release 9:16 mà cảnh chưa có ảnh dọc thì dựng bằng cắt theo focusPoint + nền mờ phóng to.
16. Chọn cảnh hero theo heroRatio (ưu tiên hook và cao trào) → ★ xác nhận chi phí → tạo video AI → lỗi thì quay về Mức 1/2.
17. Gán chuyển động Mức 1/2 theo luật đa dạng và cường độ beat; tính depth map cho cảnh parallax.
18. Sound design: LLM đề xuất SoundCue (ambience theo bối cảnh, SFX tại khoảnh khắc then chốt, stinger ở cao trào, khoảng lặng có chủ đích) từ thư viện người dùng; mix với sidechain ducking; chuẩn loudness khoảng -14 LUFS.
19. Phụ đề theo preset nền tảng; bản tiếng Anh: thuật ngữ Việt in nghiêng có dấu, lần đầu xuất hiện có thẻ chú thích; bản TikTok: chữ to, highlight từng từ, nằm trong vùng an toàn.
20. ★ Xem trước trong Remotion Player, chỉnh trên timeline.
21. Render MP4 (preset: YouTube 1080p/4K, TikTok/Shorts 1080×1920).
22. Gói xuất bản theo nền tảng + checklist (giấy phép giọng AI, giấy phép nhạc/SFX, nhãn nội dung AI nếu nền tảng yêu cầu, chính tả phụ đề, nhãn "Phần X/N").
23. (Tùy chọn, Release YouTube) Cắt Shorts teaser 30–60 giây kèm câu móc về video dài.

C. SAU KHI ĐĂNG
24. Người dùng nhập PerformanceNote; màn hình Story gợi ý "Chuyển thể sang YouTube tiếng Anh" cho Story có Release TikTok đạt ngưỡng hiệu quả người dùng tự đặt.

# YÊU CẦU HÀNG ĐỢI (JOB QUEUE)
- Dùng chung cho TTS, ảnh, video; concurrency 1–20 chỉnh được khi đang chạy; giới hạn riêng theo từng provider.
- Retry exponential backoff + jitter; 429 thì tôn trọng Retry-After.
- Hủy (AbortController), pause/resume, lưu hàng chờ xuống đĩa, khôi phục khi mở lại app.
- Dừng khi chạm ngân sách; ghi từng khoản vào CostLedger (TTS theo ký tự, ảnh/video theo đơn vị).
- Cache theo hash(input + model + params + reference) để không tạo trùng; sửa một câu/cảnh chỉ tạo lại phần đó.
- Phát sự kiện tiến độ qua IPC (throttle ~200ms); AUTO DL lưu kết quả vào đúng thư mục.

# GIAO DIỆN
Chung: dark mode tông slate/đỏ thẫm/tím than, text tiếng Việt, cửa sổ tối thiểu 1280×800, thanh icon trái, panel "Nhật ký", thanh trạng thái hiện chi phí. Thanh trên cùng có bộ chọn Story và Release đang làm việc; các màn Script Editor, Voice Studio, AutoEdit, Xuất bản luôn làm việc trên Release đang chọn.

Màn hình:
1. Trang chủ: danh sách Story kèm trạng thái và các Release (cờ ngôn ngữ, nền tảng, tiến độ), tạo Story mới, chi phí tháng.
2. Story: dàn ý theo beat, ngân hàng cảnh, danh sách Release, nút "Thêm bản phát hành" / "Chuyển thể sang YouTube", sổ hiệu quả (PerformanceNote).
3. Thư viện dân gian: FolkloreEntry, từ điển phát âm theo ngôn ngữ có nút "Nghe thử".
4. Kênh & Nhân vật: ChannelPreset, culturalVisualBible, nhân vật + bảng biểu cảm, giọng mặc định theo ngôn ngữ.
5. Script Editor: bản tiếng Anh hiển thị hai cột Anh | Việt; bản tiếng Việt một cột; mỗi dòng có người nói, chip delivery, nút nghe thử; thanh bên hiện section, beat và ước tính thời lượng (TikTok hiện ranh giới từng phần).
6. Voice Studio: chọn VoiceProfile theo ngôn ngữ, danh sách câu với waveform nhỏ, tạo lại/chọn take, preset xử lý giọng có so sánh trước/sau, ô "Đã xác nhận giấy phép thương mại".
7. Film Studio (tạo media hàng loạt): thanh trượt luồng 1–20, AUTO: ON, AUTO DL, chế độ (Tạo ảnh / Ảnh → Video / Đồng nhất nhân vật), model, nhân vật/thực thể, tỷ lệ 16:9 / 9:16 / 1:1; tabs Hàng chờ / Thư viện; độ phân giải tải, Tải hết (ZIP); lưới thẻ có số thứ tự, trạng thái, chọn nhiều, tạo lại.
8. Storyboard: lưới ngân hàng cảnh, xem nhanh bản 16:9 và 9:16, kéo điểm focusPoint, phím tắt (A duyệt, R tạo lại, E sửa prompt, V tạo bản dọc).
9. AutoEdit:
   - Trái: chế độ chạy (Duyệt từng bước – mặc định / Full Auto – bản nháp), nguồn giọng (TTS / tự thu), heroRatio, thư viện âm thanh, nút lớn "Bắt đầu".
   - Giữa: tiến trình dạng "BƯỚC 16/23: Tạo video AI – 64%" kèm thời gian; Remotion Player có nút chuyển khung 16:9 / 9:16.
   - Phải: thuộc tính cảnh (mức chuyển động, kiểu, cường độ, focusPoint, thời lượng, hero, chuyển cảnh, media) hoặc thuộc tính sound cue.
   - Dưới: timeline nhiều track (Video, Voice có waveform, Ambience, SFX, Music, Subtitle), zoom, kéo chỉnh biên, click để chọn.
10. Xuất bản: preset render, gói xuất bản theo nền tảng (bản tiếng Anh kèm dịch Việt), checklist, cắt Shorts.
11. Cài đặt: API key từng provider, đánh dấu giấy phép thương mại, thư mục thư viện âm thanh, ngân sách, chế độ Mock.

# YÊU CẦU PHI CHỨC NĂNG
- UI không đứng khi tạo giọng/ảnh/video hay render.
- Đường dẫn Windows có dấu tiếng Việt, khoảng trắng phải hoạt động.
- Ghi log ra file; lỗi API hiển thị thông báo tiếng Việt kèm cách xử lý.
- Lưu sources.json theo từng Release: nguồn gốc media, provider giọng, giấy phép âm thanh, nhãn AI-generated.
- Unit test cho: áp từ điển phát âm, ghép câu và tính mốc thời gian, chia phần TikTok, khớp cảnh theo beat, cắt dọc theo focusPoint, luật đa dạng shot/motion, chọn cảnh hero theo heroRatio, queue (retry, cancel, budget, cache).

# QUY TẮC VIẾT CODE & ĐỊNH DẠNG TRẢ LỜI
- Mỗi file: ghi đường dẫn đầy đủ rồi toàn bộ nội dung. Không dùng "...", "// tương tự", "// phần còn lại giữ nguyên".
- Phần thuộc giai đoạn sau: stub throw new Error('Chưa triển khai – Giai đoạn X').
- Nếu câu trả lời sắp quá dài: dừng ở ranh giới một file, liệt kê file còn lại, chờ tôi nói "tiếp tục".
- Không thêm thư viện ngoài danh sách nếu không giải thích lý do.
- Cuối mỗi giai đoạn: lệnh cài đặt, lệnh chạy, checklist kiểm tra thủ công.

# KẾ HOẠCH THEO GIAI ĐOẠN (ưu tiên ra video thật sớm nhất)
- GĐ1 – Lát cắt dọc: khung app, data model Story/Release, IPC, khung UI mọi màn hình; dữ liệu mẫu 1 Story về ma da với 2 Release (YouTube tiếng Anh ~2 phút, TikTok tiếng Việt 1 phần ~1 phút 30); pipeline giả lập dùng MockTts + ảnh placeholder; Ken Burns; cắt dọc theo focusPoint; phụ đề 2 preset; render ra 2 file MP4 (16:9 và 9:16) từ cùng ngân hàng cảnh.
- GĐ2 – Kịch bản & giọng: LLM dàn ý + chuyển thể theo Release + chia phần TikTok, Script Editor, Voice Studio, adapter ElevenLabs + OpenAI TTS, từ điển phát âm, xử lý giọng, Thư viện dân gian.
- GĐ3 – Hình ảnh: job queue 20 luồng, Gemini ImageProvider, culturalVisualBible, thiết kế thực thể, Film Studio, Storyboard, ảnh 9:16 riêng.
- GĐ4 – Chuyển động & âm thanh: parallax 2.5D, VideoProvider + cảnh hero, chuyển cảnh, sound design tự động, mix + ducking + loudness, timeline đa track hoàn chỉnh.
- GĐ5 – Kinh doanh: gói xuất bản theo nền tảng, thumbnail/ảnh bìa, cắt Shorts, checklist, sổ chi phí, sổ hiệu quả + luồng "Chuyển thể sang YouTube".
- GĐ6 – Mở rộng: đường tự thu âm + Whisper, xuất .srt/FCPXML, export CapCut theo template mode (draft không phải JSON đọc được thì báo lỗi rõ ràng, không cố giải mã), đóng gói installer bằng electron-builder, nghiên cứu tùy chọn hoạt hình nhân vật (chớp mắt, khớp môi).

# NHIỆM VỤ LẦN NÀY: CHỈ LÀM GIAI ĐOẠN 1
1. Sơ đồ kiến trúc (Mermaid) và cây thư mục dự án.
2. Giải thích lý do các quyết định chính (tối đa 10 gạch đầu dòng).
3. Code đầy đủ: package.json, cấu hình electron-vite, tsconfig, tailwind; main process, preload, IPC có kiểu; src/shared/types.ts đầy đủ như trên; store Zustand; khung UI mọi màn hình (màn chưa làm hiển thị "Giai đoạn X"); bộ chọn Story/Release; AutoEdit và Script Editor (chế độ chỉ xem) hoạt động với dữ liệu mẫu.
4. Dữ liệu mẫu trong src/shared/sampleData.ts: Story về ma da (6–8 beat, 10–14 cảnh trong ngân hàng cảnh có focusPoint); Release YouTube tiếng Anh (15–25 câu, có translationVi và delivery); Release TikTok tiếng Việt (10–15 câu, có hook và cliffhanger).
5. Pipeline giả lập cho từng Release: MockTts sinh audio từng câu → ghép voice track và tính mốc → khớp cảnh theo beat → ảnh placeholder 16:9 bằng sharp (ghi số cảnh, shotType, tóm tắt prompt) → cắt dọc theo focusPoint cho bản 9:16 → composition Remotion có Ken Burns, chuyển cảnh fade và phụ đề theo preset → render MP4 trong utility process, báo tiến độ về UI; dừng ở các điểm duyệt và tiếp tục khi bấm "Tiếp tục".
6. Interface (chưa cần cài đặt): TtsProvider, ImageProvider, VideoProvider, LlmProvider, Transcriber, JobQueue, Exporter.
7. Hướng dẫn npm install / npm run dev.

Tiêu chí hoàn thành GĐ1: npm run dev mở được app; chọn Story mẫu, chọn lần lượt từng Release và bấm "Bắt đầu" thì tiến trình chạy qua các bước, dừng ở các điểm duyệt và tiếp tục được; xem trước trong Remotion Player; xuất ra 2 file MP4 (16:9 tiếng Anh và 9:16 tiếng Việt) có audio, ảnh chuyển động và phụ đề, mở được bằng trình phát video thông thường.
