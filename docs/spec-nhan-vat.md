# BỔ SUNG: NHÂN VẬT

## Phân loại nhân vật
- Nhân vật kênh (scope 'channel'): xuất hiện xuyên suốt mọi Story, là nhận diện thương hiệu. Mặc định có 1 nhân vật người kể chuyện (ví dụ một bà cụ kể chuyện bên đèn dầu) xuất hiện ở intro/outro và các đoạn chuyển chương.
- Nhân vật truyện (scope 'story'): nhân vật chính, phụ của từng câu chuyện.
- Thực thể (role 'entity'): con ma/linh hồn; thiết kế lấy từ FolkloreEntry.visualDesign nhưng có thể tùy biến theo Story.

## Sửa DATA MODEL
- Character: thêm scope ('channel' | 'story'), storyId (khi scope 'story'), age, gender, appearance (khuôn mặt, dáng người, kiểu tóc), defaultOutfit, characterSheet { front, threeQuarter, profile, fullBody } (các ảnh tham chiếu), expressionSheet (map biểu cảm → ảnh), states[] (biến thể ngoại hình theo diễn biến: id, name, description, referenceImage — ví dụ "ướt sũng", "bị thương nhẹ", "bị nhập"), voiceProfileIdByLanguage.
- SceneBankItem: thay characterIds[] bằng cast[] { characterId, stateId, expression, position ('left' | 'center' | 'right' | 'background'), action }.
- ScriptLine: speakerId có thể là người kể hoặc nhân vật; câu thoại nhân vật dùng giọng của nhân vật đó.

## Bổ sung PIPELINE (chèn sau bước 3 "Duyệt dàn ý")
3a. LLM đề xuất dàn nhân vật từ dàn ý: tên, vai trò, tuổi, ngoại hình, trang phục phù hợp bối cảnh văn hóa và thời kỳ, các trạng thái ngoại hình cần có theo diễn biến.
3b. Tạo character sheet cho từng nhân vật mới (chính diện, 3/4, nghiêng, toàn thân) và bảng biểu cảm, dùng chung artStyle của kênh.
3c. ★ Duyệt nhân vật: tạo lại, sửa mô tả, khóa nhân vật đã duyệt (khóa rồi thì mọi ảnh sau đều dùng ảnh tham chiếu của nhân vật này).
- Bước tạo ảnh cảnh: gửi kèm ảnh tham chiếu của đúng nhân vật, đúng trạng thái và biểu cảm; tối đa 2–3 nhân vật rõ mặt trong một cảnh để giữ độ đồng nhất.
- Bước kiểm tra đồng nhất (tùy chọn, GĐ3): LLM có khả năng nhìn ảnh so sánh ảnh cảnh với character sheet, đánh dấu cảnh có nhân vật bị lệch (sai trang phục, sai kiểu tóc) để người dùng tạo lại.
- Bước chuyển thể kịch bản: LLM được phép tạo câu thoại ngắn cho nhân vật (giọng riêng), xen giữa lời kể.
- Intro/outro của mỗi Release dùng nhân vật kênh; lời dẫn của nhân vật kênh được chuyển thể theo ngôn ngữ.

## Bổ sung GIAO DIỆN
- Màn "Nhân vật": hai tab Nhân vật kênh / Nhân vật truyện; mỗi nhân vật hiển thị character sheet, bảng biểu cảm, các trạng thái, giọng theo ngôn ngữ (nút nghe thử), trạng thái khóa.
- Storyboard: mỗi thẻ cảnh hiện avatar các nhân vật trong cảnh; lọc cảnh theo nhân vật.
- Inspector cảnh: chỉnh cast (nhân vật, trạng thái, biểu cảm, vị trí, hành động).

## Sửa GIAI ĐOẠN
- GĐ1: dữ liệu mẫu có 1 nhân vật kênh (người kể) và 2 nhân vật truyện + 1 thực thể ma da; ảnh placeholder ghi tên nhân vật và biểu cảm trong cảnh.
- GĐ3: thêm tạo character sheet, bảng biểu cảm, trạng thái ngoại hình, màn Nhân vật, kiểm tra đồng nhất.
- GĐ2: thêm câu thoại nhân vật với giọng riêng.
