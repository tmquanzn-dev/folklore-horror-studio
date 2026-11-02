/**
 * DỮ LIỆU MẪU – Story "Ma da ở bến cây đa" (làng Cồn Mù là HƯ CẤU; ma da là tín ngưỡng dân gian có thật).
 * - Nhân vật kênh: Bà Tư kể chuyện (người kể, xuất hiện ở đoạn bối cảnh / giải thích / kết)
 * - Nhân vật truyện: Út Lan, Bà Sáu; thực thể: ma da (hồn Hạnh)
 * - 7 beat, 15 cảnh (có cast), 2 Release:
 *   + YouTube tiếng Anh 16:9 (~2 phút 30, 23 câu, có bản dịch + câu thoại nhân vật)
 *   + TikTok tiếng Việt 9:16 (1 phần ~1 phút 30, 15 câu, hook + cliffhanger + câu thoại)
 */
import { platformsConfig } from './config'
import type {
  Beat,
  CastMember,
  ChannelPreset,
  Character,
  CostLedger,
  Delivery,
  FolkloreEntry,
  Library,
  PronunciationEntry,
  Release,
  SceneBankItem,
  ScriptLine,
  ScriptSection,
  ShotType,
  Story,
  VoiceProcessChain,
  VoiceProfile
} from './types'

const NOW = '2026-11-01T20:00:00.000Z'

export const SAMPLE_STORY_ID = 'story-ma-da-ben-cay-da'
export const SAMPLE_YT_RELEASE_ID = 'rel-yt-en'
export const SAMPLE_TT_RELEASE_ID = 'rel-tt-vi'
export const CHANNEL_NARRATOR_ID = 'char-narrator'

// ---------------------------------------------------------------------------
// Kênh & tri thức
// ---------------------------------------------------------------------------

export const sampleChannel: ChannelPreset = {
  id: 'channel-dem-khuya',
  name: 'Chuyện Ma Đêm Khuya / Midnight Folklore',
  artStyle:
    'cinematic dark painterly illustration, muted teal and amber palette, volumetric river fog, soft film grain, low-key lighting, 35mm photography feel',
  negativePrompt:
    'text, letters, watermark, logo, torii gate, kimono, japanese architecture, chinese architecture, pagoda roof, blood, gore, wounds, corpse, explicit violence',
  palette: ['#0b0f14', '#1b2a2f', '#3d2b1f', '#8a6a3a', '#a61b29'],
  culturalVisualBible: [
    'làng quê đồng bằng sông Cửu Long',
    'sông nước, kênh rạch, lục bình trôi',
    'nhà sàn / nhà lá ven sông',
    'xuồng ba lá, đò gỗ, mái chèo',
    'bàn thờ gia tiên, bát nhang, nhang khói',
    'áo bà ba, khăn rằn, nón lá',
    'cây đa cổ thụ ở khúc quanh',
    'đèn dầu, đèn măng sông, ánh trăng mờ'
  ],
  motionProfile: {
    defaultLevel: 'kenBurns',
    baseIntensity: 0.3,
    intensityGain: 0.6,
    tenseThreshold: 0.7,
    climaxThreshold: 0.95,
    transitionWithinBeat: 'fade',
    transitionBetweenBeats: 'dipToBlack',
    transitionDurationSec: 0.5,
    flashAtClimax: true,
    parallaxRatio: 0.3
  },
  soundPalette: {
    ambienceTags: ['river', 'night', 'insects', 'wind'],
    sfxTags: ['water-splash', 'wood-creak', 'whisper'],
    stingerTags: ['low-hit', 'reverse-swell'],
    musicTags: ['dark-ambient', 'dan-bau-drone'],
    targetLufs: -14
  },
  defaultVoiceByLanguage: { en: 'voice-en-narrator', vi: 'voice-vi-narrator' },
  subtitleStyleByPlatform: {
    youtube: platformsConfig.subtitleStyles.youtube,
    tiktok: platformsConfig.subtitleStyles.tiktok,
    youtubeShorts: platformsConfig.subtitleStyles.tiktok
  },
  platformDefaults: platformsConfig.platforms
}

export const sampleFolklore: FolkloreEntry[] = [
  {
    id: 'folk-ma-da',
    nameVi: 'Ma da',
    nameEn: 'Ma da (water ghost)',
    region: 'Đồng bằng sông Cửu Long và Bắc Bộ',
    summaryVi:
      'Theo tín ngưỡng dân gian, ma da là hồn người chết đuối không siêu thoát, bị giữ dưới nước và phải "bắt thế" – kéo một người khác chết đuối thay mình – thì mới được đầu thai.',
    summaryEn:
      'In Vietnamese folk belief, a ma da is the restless spirit of a drowned person, bound to the water until it pulls someone else under to take its place.',
    visualDesign:
      'Không bao giờ lộ toàn thân: bàn tay tái nhợt, móng đen bùn; tóc dài rối lẫn lục bình; bóng người mờ dưới mặt nước đục; mắt phản chiếu ánh đèn dầu.',
    referenceImages: [],
    sources: ['(Người dùng bổ sung nguồn tư liệu dân gian ở đây)'],
    isDocumentedFolklore: true
  }
]

export const samplePronunciations: PronunciationEntry[] = [
  {
    id: 'pr-en-ma-da',
    language: 'en',
    term: 'ma da',
    ttsRespelling: 'mah yah',
    notes: 'Giọng miền Nam đọc "da" gần như "ya".',
    glossEn: 'Water ghost – the restless spirit of a drowned person'
  },
  {
    id: 'pr-en-cay-da',
    language: 'en',
    term: 'cây đa',
    ttsRespelling: 'kay dah',
    notes: 'Cây đa – thường gắn với tín ngưỡng thần linh, ma quỷ.',
    glossEn: 'Banyan tree, often believed to shelter spirits'
  },
  {
    id: 'pr-en-do',
    language: 'en',
    term: 'đò',
    ttsRespelling: 'daw',
    notes: 'Đò chở khách qua sông.',
    glossEn: 'A small wooden ferry boat'
  },
  { id: 'pr-en-con-mu', language: 'en', term: 'Cồn Mù', ttsRespelling: 'kohn moo', notes: 'Tên làng hư cấu.' },
  { id: 'pr-en-hanh', language: 'en', term: 'Hạnh', ttsRespelling: 'hahn', notes: 'Tên nhân vật.' },
  {
    id: 'pr-en-ba-sau',
    language: 'en',
    term: 'Bà Sáu',
    ttsRespelling: 'bah sow',
    notes: '"Bà" = bà nội/ngoại; "Sáu" = thứ sáu trong nhà.',
    glossEn: 'Grandma Sáu ("Bà" means grandmother)'
  },
  {
    id: 'pr-vi-tiktok',
    language: 'vi',
    term: 'TikTok',
    ttsRespelling: 'tíc tóc',
    notes: 'Ví dụ từ mượn tiếng Anh trong bản tiếng Việt.'
  }
]

const noSheet = { front: null, threeQuarter: null, profile: null, fullBody: null }

export const sampleCharacters: Character[] = [
  {
    id: CHANNEL_NARRATOR_ID,
    name: 'Bà Tư kể chuyện',
    role: 'narrator',
    scope: 'channel',
    storyId: null,
    age: 78,
    gender: 'female',
    appearance: 'Bà cụ gầy nhỏ, tóc bạc búi củ hành, khuôn mặt hiền nhiều nếp nhăn, đôi mắt sáng tinh anh, tay gầy guộc.',
    defaultOutfit: 'Áo bà ba đen, khăn rằn đỏ đen quàng vai, ngồi bên ngọn đèn dầu trên hiên nhà sàn.',
    description: 'Người kể chuyện – nhận diện thương hiệu của kênh. Xuất hiện ở đoạn bối cảnh, chuyển chương, giải thích truyền thuyết và kết.',
    referenceImages: [],
    characterSheet: { ...noSheet },
    expressionSheet: [
      { expression: 'ấm áp', prompt: 'warm gentle smile', imagePath: null },
      { expression: 'bí ẩn', prompt: 'mysterious half smile, eyes lit by lamp', imagePath: null },
      { expression: 'nghiêm', prompt: 'serious, solemn', imagePath: null }
    ],
    states: [],
    voiceProfileIdByLanguage: { en: 'voice-en-narrator', vi: 'voice-vi-narrator' },
    locked: true,
    approval: { status: 'approved', at: NOW }
  },
  {
    id: 'char-lan',
    name: 'Út Lan',
    role: 'character',
    scope: 'story',
    storyId: SAMPLE_STORY_ID,
    age: 17,
    gender: 'female',
    appearance: 'Thiếu nữ gầy, da rám nắng, mặt thon, mắt to, tóc đen dài tết một bên.',
    defaultOutfit: 'Áo bà ba xanh bạc màu, quần đen, nón lá.',
    description: 'Cô gái chèo đò của làng, bạn thân của Hạnh. Gan dạ nhưng đang mang nỗi đau mất bạn.',
    referenceImages: [],
    characterSheet: { ...noSheet },
    expressionSheet: [
      { expression: 'bình thường', prompt: 'calm, tired eyes', imagePath: null },
      { expression: 'sợ hãi', prompt: 'terrified, biting lip, wide eyes', imagePath: null }
    ],
    states: [{ id: 'st-lan-uot', name: 'ướt sũng', description: 'Tóc và áo ướt đẫm nước sông, bết vào người.', referenceImage: null }],
    voiceProfileIdByLanguage: { en: 'voice-en-lan', vi: 'voice-vi-lan' },
    locked: false,
    approval: { status: 'pending' }
  },
  {
    id: 'char-ba-sau',
    name: 'Bà Sáu',
    role: 'character',
    scope: 'story',
    storyId: SAMPLE_STORY_ID,
    age: 74,
    gender: 'female',
    appearance: 'Bà cụ ngoài 70, tóc bạc búi sau gáy, miệng nhai trầu, bàn tay nhăn nheo.',
    defaultOutfit: 'Áo bà ba nâu, khăn rằn.',
    description: 'Bà nội của Lan, người hiểu chuyện tâm linh trong xóm.',
    referenceImages: [],
    characterSheet: { ...noSheet },
    expressionSheet: [{ expression: 'lo âu', prompt: 'worried, solemn', imagePath: null }],
    states: [],
    voiceProfileIdByLanguage: { en: 'voice-en-ba-sau', vi: 'voice-vi-ba-sau' },
    locked: false,
    approval: { status: 'pending' }
  },
  {
    id: 'char-ma-da',
    name: 'Ma da bến cây đa (Hạnh)',
    role: 'entity',
    scope: 'story',
    storyId: SAMPLE_STORY_ID,
    age: 17,
    gender: 'female',
    appearance:
      'Theo thiết kế ma da: không lộ toàn thân; bàn tay tái nhợt, móng đen bùn, tóc dài rối lẫn lục bình, bóng người mờ dưới mặt nước. Tuỳ biến: cổ tay còn sợi dây thun đỏ Hạnh hay đeo.',
    defaultOutfit: 'Vạt áo bà ba trắng mờ dưới nước.',
    description: 'Hồn của Hạnh, chết đuối năm ngoái ở khúc quanh cây đa, đang tìm người thế mạng.',
    referenceImages: [],
    characterSheet: { ...noSheet },
    expressionSheet: [],
    states: [
      { id: 'st-mada-bong', name: 'bóng dưới nước', description: 'Chỉ thấy bóng người mờ dưới mặt nước đục.', referenceImage: null },
      { id: 'st-mada-tay', name: 'bàn tay trồi lên', description: 'Chỉ thấy bàn tay và cổ tay trồi khỏi mặt nước.', referenceImage: null }
    ],
    voiceProfileIdByLanguage: { en: 'voice-en-ma-da', vi: 'voice-vi-ma-da' },
    locked: false,
    approval: { status: 'pending' }
  }
]

const defaultChain: VoiceProcessChain = { highpassHz: 80, compressor: { thresholdDb: -18, ratio: 3 }, warmthDb: 2, reverbAmount: 0.12 }
const ghostChain: VoiceProcessChain = { highpassHz: 180, compressor: { thresholdDb: -22, ratio: 4 }, warmthDb: -2, reverbAmount: 0.4 }

function voice(
  id: string,
  name: string,
  language: 'en' | 'vi',
  providerVoiceId: string,
  baseInstructions: string,
  toneHz: number,
  chain: VoiceProcessChain = defaultChain,
  defaultTags: string[] = []
): VoiceProfile {
  return {
    id,
    name,
    language,
    providerId: 'mock',
    providerVoiceId,
    baseInstructions,
    defaultTags,
    speed: 1,
    // toneHz chỉ dùng cho Mock để nghe phân biệt giọng các nhân vật
    providerSettings: { toneHz },
    postProcessChain: chain,
    commercialLicenseConfirmed: false
  }
}

export const sampleVoiceProfiles: VoiceProfile[] = [
  voice('voice-en-narrator', 'Narrator EN – Grandma Tư (Mock)', 'en', 'mock-en-deep',
    'Elderly Vietnamese grandmother telling a ghost story at night. Slow, low, intimate, never theatrical. Let silences breathe.', 165, defaultChain, ['softly']),
  voice('voice-vi-narrator', 'Người kể VI – Bà Tư (Mock)', 'vi', 'mock-vi-warm',
    'Giọng bà cụ miền Nam kể chuyện đêm khuya, gần gũi như đang ngồi bên hiên nhà, chậm rãi, trầm.', 185, defaultChain, ['softly']),
  voice('voice-en-lan', 'Lan EN – young woman (Mock)', 'en', 'mock-en-young-f', 'Young woman, 17, scared but brave.', 250),
  voice('voice-vi-lan', 'Út Lan VI (Mock)', 'vi', 'mock-vi-young-f', 'Thiếu nữ 17 tuổi miền Tây, giọng trong, run khi sợ.', 262),
  voice('voice-en-ba-sau', 'Grandma Sáu EN (Mock)', 'en', 'mock-en-old-f', 'Old grandmother, firm and worried, slow.', 150),
  voice('voice-vi-ba-sau', 'Bà Sáu VI (Mock)', 'vi', 'mock-vi-old-f', 'Bà cụ miền Tây, giọng khàn, nghiêm và lo lắng.', 158),
  voice('voice-en-ma-da', 'Ma da EN – drowned whisper (Mock)', 'en', 'mock-en-ghost', 'Whispered, wet, distant voice of a drowned girl. Patient, pleading.', 300, ghostChain, ['whispers']),
  voice('voice-vi-ma-da', 'Ma da VI – tiếng thì thầm (Mock)', 'vi', 'mock-vi-ghost', 'Giọng thì thầm của cô gái chết đuối, xa xăm, ướt át, van nài.', 310, ghostChain, ['whispers'])
]

export function createSampleLibrary(): Library {
  return {
    channelPresets: [structuredClone(sampleChannel)],
    folklore: structuredClone(sampleFolklore),
    pronunciations: structuredClone(samplePronunciations),
    characters: structuredClone(sampleCharacters),
    voiceProfiles: structuredClone(sampleVoiceProfiles),
    soundAssets: []
  }
}

// ---------------------------------------------------------------------------
// Story: dàn ý + ngân hàng cảnh
// ---------------------------------------------------------------------------

const beats: Beat[] = [
  {
    id: 'b1',
    order: 1,
    summaryVi: 'Mở đầu: đêm trăng mờ, mặt sông phẳng lặng; từ dưới nước có tiếng ai gọi đúng tên mình.',
    summaryEn: 'Opening: a still river under a hazy moon; a voice beneath the water calls your name.',
    emotionalIntensity: 0.7,
    mustShow: ['mặt sông đêm', 'đèn dầu trên đò']
  },
  {
    id: 'b2',
    order: 2,
    summaryVi: 'Làng Cồn Mù (hư cấu) ven sông; lời dặn của người già: không tắm sông lúc chạng vạng, nhất là khúc quanh dưới gốc cây đa.',
    summaryEn: 'The (fictional) river village of Cồn Mù and its rule: never swim at dusk near the old banyan bend.',
    emotionalIntensity: 0.3,
    mustShow: ['cây đa ở khúc quanh', 'bàn thờ, nhang khói']
  },
  {
    id: 'b3',
    order: 3,
    summaryVi: 'Năm ngoái, Hạnh – bạn thân của Lan – chết đuối ở khúc quanh ấy; người ta tìm thấy cô giữa đám lục bình.',
    summaryEn: 'Last year Hạnh, Lan’s best friend, drowned at the bend and was found among the water hyacinth.',
    emotionalIntensity: 0.5,
    mustShow: ['ảnh thờ', 'lục bình']
  },
  {
    id: 'b4',
    order: 4,
    summaryVi: 'Lan chèo đò về muộn, nghe giọng Hạnh gọi từ dưới nước, thấy bàn tay trắng bệch bám mạn đò.',
    summaryEn: 'Rowing home late, Lan hears Hạnh calling from under the boat; a pale hand grips the hull.',
    emotionalIntensity: 0.75,
    mustShow: ['bàn tay bám mạn đò']
  },
  {
    id: 'b5',
    order: 5,
    summaryVi: 'Bà Sáu kể: ma da phải bắt người thế mạng mới được đầu thai; dặn Lan đừng bao giờ trả lời.',
    summaryEn: 'Grandma Sáu explains the ma da must take a replacement; she warns Lan never to answer.',
    emotionalIntensity: 0.45,
    mustShow: ['bà Sáu bên đèn dầu']
  },
  {
    id: 'b6',
    order: 6,
    summaryVi: 'Cao trào: mái chèo bị giữ chặt, bàn tay lạnh nắm cổ chân Lan; cô không trả lời, thả mâm cúng, thắp nhang – bàn tay buông ra.',
    summaryEn: 'Climax: the oar is held fast, a cold hand grabs Lan’s ankle; she stays silent, offers incense – the hand lets go.',
    emotionalIntensity: 1,
    mustShow: ['mái chèo', 'nhang cháy đỏ']
  },
  {
    id: 'b7',
    order: 7,
    summaryVi: 'Sáng hôm sau: dấu chân ướt nhỏ trên bến dẫn thẳng tới cửa nhà Lan…',
    summaryEn: 'Next morning: small wet footprints on the dock lead straight to Lan’s door…',
    emotionalIntensity: 0.85,
    mustShow: ['dấu chân ướt']
  }
]

function cast(
  characterId: string,
  expression = '',
  position: CastMember['position'] = 'center',
  action = '',
  stateId: string | null = null
): CastMember {
  return { characterId, stateId, expression, position, action }
}

function scene(
  n: number,
  beatId: string,
  shotType: ShotType,
  cameraAngle: string,
  description: string,
  imagePrompt: string,
  focus: [number, number],
  castList: CastMember[] = [],
  needsVerticalVersion = false
): SceneBankItem {
  return {
    id: `s${String(n).padStart(2, '0')}`,
    beatId,
    description,
    shotType,
    cameraAngle,
    cast: castList,
    folkloreIds: castList.some((c) => c.characterId === 'char-ma-da') ? ['folk-ma-da'] : [],
    expression: castList[0]?.expression ?? '',
    imagePrompt,
    needsVerticalVersion,
    media: { '16:9': null, '9:16': null },
    focusPoint: { x: focus[0], y: focus[1] },
    depthMapPath: null,
    heroClip: { '16:9': null, '9:16': null },
    variants: [],
    approval: { status: 'pending' }
  }
}

const sceneBank: SceneBankItem[] = [
  scene(1, 'b1', 'wide', 'eye level', 'Dòng sông đêm phẳng lặng dưới trăng mờ, sương mỏng, một ngọn đèn dầu leo lét trên chiếc đò neo',
    'a still black river at night under a hazy moon, thin fog, a single oil lamp glowing on a moored wooden ferry boat', [0.62, 0.55], [], true),
  scene(2, 'b1', 'insert', 'low angle near water', 'Mặt nước đen gợn nhẹ, phản chiếu ánh đèn dầu, bên dưới thấp thoáng hình người',
    'dark rippling water surface reflecting amber lamplight, a faint human silhouette barely visible beneath', [0.45, 0.6],
    [cast('char-ma-da', '', 'background', 'bóng người lặng lờ dưới nước', 'st-mada-bong')]),
  scene(3, 'b2', 'wide', 'high angle', 'Làng ven sông với nhà sàn, cây đa cổ thụ nghiêng ở khúc quanh, khói nhang chiều',
    'riverside Mekong delta village with stilt houses, an ancient banyan tree leaning over a river bend, incense smoke at dusk', [0.7, 0.45]),
  scene(4, 'b2', 'medium', 'eye level', 'Bà Sáu ngồi bên bàn thờ, nhang khói, ánh đèn dầu, áo bà ba nâu',
    'elderly Vietnamese grandmother in brown ao ba ba sitting beside a family altar, incense smoke, oil lamp light', [0.4, 0.42],
    [cast('char-ba-sau', 'trầm ngâm', 'left', 'ngồi thắp nhang')]),
  scene(5, 'b3', 'closeUp', 'eye level', 'Tấm ảnh thờ cô gái trẻ bên bát nhang, hoa cúc trắng đã héo',
    'a framed memorial photo of a young woman on an altar beside an incense bowl, wilted white chrysanthemums', [0.5, 0.4]),
  scene(6, 'b3', 'topDown', 'top-down', 'Đám lục bình dày trôi trên mặt nước đục ở khúc quanh, nhìn từ trên xuống',
    'top-down view of dense water hyacinth drifting on murky water at a river bend', [0.55, 0.5]),
  scene(7, 'b4', 'overShoulder', 'over the shoulder', 'Qua vai Lan đang chèo đò trong đêm, phía trước là gốc cây đa đen thẫm',
    'over the shoulder of a young woman in a conical hat rowing a small wooden boat at night toward a dark banyan tree', [0.66, 0.5],
    [cast('char-lan', 'căng thẳng', 'left', 'chèo đò')], true),
  scene(8, 'b4', 'insert', 'close, low', 'Bàn tay tái nhợt, móng đen bùn bám vào mạn đò gỗ',
    'a pale wet hand with mud-dark nails gripping the edge of a wooden boat, water dripping, dim lamplight', [0.35, 0.62],
    [cast('char-ma-da', '', 'center', 'bàn tay bám mạn đò', 'st-mada-tay')]),
  scene(9, 'b5', 'closeUp', 'eye level', 'Gương mặt nhăn nheo của bà Sáu trong ánh đèn dầu, ánh mắt lo âu',
    'close-up of a wrinkled elderly Vietnamese woman’s face lit by an oil lamp, worried eyes', [0.48, 0.38],
    [cast('char-ba-sau', 'lo âu', 'center', 'dặn dò Lan')]),
  scene(10, 'b6', 'closeUp', 'low angle', 'Gương mặt Lan sợ hãi, cắn môi, nước bắn trên má, nền tối',
    'close-up of a frightened young Vietnamese woman biting her lip, river spray on her cheek, darkness behind', [0.52, 0.45],
    [cast('char-lan', 'sợ hãi', 'center', 'cắn môi, im lặng', 'st-lan-uot')], true),
  scene(11, 'b6', 'insert', 'low angle', 'Mái chèo bị giữ chặt dưới nước, xoáy nước đen, nén nhang cháy đỏ trên mũi đò',
    'a wooden oar held fast in a dark swirling current, a glowing red incense stick on the bow of the boat', [0.4, 0.55],
    [cast('char-ma-da', '', 'background', 'níu mái chèo dưới nước', 'st-mada-bong')]),
  scene(12, 'b7', 'wide', 'eye level', 'Bến sông buổi sáng sương mù, dấu chân ướt nhỏ trên ván gỗ dẫn về phía ngôi nhà',
    'a foggy river dock at dawn, small wet footprints on wooden planks leading toward a thatched house', [0.5, 0.65]),
  scene(13, 'b7', 'insert', 'high angle', 'Dấu chân ướt dừng ngay trước ngưỡng cửa nhà Lan',
    'small wet footprints stopping right at the threshold of a wooden door, morning light', [0.5, 0.7], [], true),
  // Cảnh nhân vật kênh – dùng ở đoạn bối cảnh / giải thích / kết
  scene(14, 'b2', 'medium', 'eye level', 'Bà Tư kể chuyện ngồi bên đèn dầu trên hiên nhà sàn, sau lưng là dòng sông đêm',
    'an elderly Vietnamese storyteller woman in black ao ba ba and checkered scarf sitting by an oil lamp on a stilt-house porch, night river behind', [0.45, 0.42],
    [cast(CHANNEL_NARRATOR_ID, 'ấm áp', 'center', 'kể chuyện bên đèn dầu')]),
  scene(15, 'b7', 'closeUp', 'eye level', 'Cận mặt bà Tư trong ánh đèn dầu, nụ cười bí ẩn, đưa tay sắp thổi tắt đèn',
    'close-up of an elderly Vietnamese storyteller’s face lit by a flickering oil lamp, mysterious half smile, about to blow out the flame', [0.5, 0.4],
    [cast(CHANNEL_NARRATOR_ID, 'bí ẩn', 'center', 'thổi tắt đèn dầu')])
]

// ---------------------------------------------------------------------------
// Kịch bản
// ---------------------------------------------------------------------------

function delivery(tags: string[], instructions: string, pace = 1, pauseBeforeMs = 250, pauseAfterMs = 450): Delivery {
  return { tags, instructions, pace, pauseBeforeMs, pauseAfterMs }
}

interface RawLine {
  section: string
  beat: string
  text: string
  d: Delivery
  vi?: string
  speaker?: string
}

function buildLines(prefix: string, raw: RawLine[]): ScriptLine[] {
  return raw.map((r, i) => {
    const l: ScriptLine = {
      id: `${prefix}-l${String(i + 1).padStart(2, '0')}`,
      sectionId: r.section,
      beatId: r.beat,
      speakerId: r.speaker ?? CHANNEL_NARRATOR_ID,
      text: r.text,
      delivery: r.d,
      takes: [],
      selectedTakeId: null,
      start: null,
      end: null,
      glossaryTermIds: [],
      approval: { status: 'pending' }
    }
    if (r.vi !== undefined) l.translationVi = r.vi
    return l
  })
}

const ytSections: ScriptSection[] = [
  { id: 'yt-sec-cold', kind: 'coldOpen', title: 'Cold open', titleVi: 'Mở đầu lạnh' },
  { id: 'yt-sec-context', kind: 'context', title: 'The river village', titleVi: 'Ngôi làng ven sông' },
  { id: 'yt-sec-story', kind: 'story', title: 'The voice beneath the boat', titleVi: 'Giọng nói dưới đáy đò' },
  { id: 'yt-sec-folk', kind: 'folkloreExplainer', title: 'What is a ma da?', titleVi: 'Ma da là gì?' },
  { id: 'yt-sec-outro', kind: 'outro', title: 'Outro', titleVi: 'Kết' }
]

const C = 'yt-sec-cold'
const X = 'yt-sec-context'
const S = 'yt-sec-story'
const ytRaw: RawLine[] = [
  { section: C, beat: 'b1', text: 'There is a bend in the river where the water never seems to move.',
    d: delivery(['softly'], 'Low and slow, as if sharing a secret.', 0.9, 600, 500),
    vi: 'Có một khúc quanh trên sông nơi mặt nước dường như chẳng bao giờ chuyển động.' },
  { section: C, beat: 'b1', text: 'On some nights, if you sit still in a small boat, you will hear someone call your name.',
    d: delivery(['whispers'], 'Draw the listener in.', 0.9),
    vi: 'Có những đêm, nếu bạn ngồi yên trên một chiếc thuyền nhỏ, bạn sẽ nghe ai đó gọi tên mình.' },
  { section: C, beat: 'b1', text: 'From under the water.', d: delivery(['whispers'], 'Almost inaudible. Let it hang.', 0.85, 300, 900),
    vi: 'Từ dưới mặt nước.' },
  { section: C, beat: 'b1', text: 'Whatever you do… do not answer.', d: delivery(['tense'], 'Firm warning, quiet.', 0.85, 200, 1200),
    vi: 'Dù thế nào đi nữa… cũng đừng trả lời.' },
  { section: X, beat: 'b2', text: 'This story comes from the Mekong Delta, a world of rivers and small wooden ferries called đò.',
    d: delivery(['calm'], 'Warm documentary tone.', 1),
    vi: 'Câu chuyện này đến từ miền Tây sông nước – thế giới của sông ngòi và những chiếc đò gỗ nhỏ.' },
  { section: X, beat: 'b2', text: 'In a fictional village we will call Cồn Mù, the elders teach every child one rule.',
    d: delivery(['calm'], 'Clear, steady.', 1),
    vi: 'Ở một ngôi làng hư cấu mà ta gọi là Cồn Mù, người già dạy mọi đứa trẻ một điều.' },
  { section: X, beat: 'b2', text: 'Never swim at dusk. And never swim near the old cây đa, the banyan tree that leans over the bend.',
    d: delivery(['softly'], 'Like repeating an old warning.', 0.95),
    vi: 'Đừng bao giờ tắm sông lúc chạng vạng. Và đừng bao giờ bơi gần cây đa già nghiêng mình bên khúc quanh.' },
  { section: X, beat: 'b2', text: 'Because something lives in that water. Something the old people call the ma da.',
    d: delivery(['tense'], 'Slower on the last words.', 0.9, 250, 800),
    vi: 'Bởi vì có thứ gì đó sống dưới làn nước ấy. Thứ mà người già gọi là ma da.' },
  { section: S, beat: 'b3', text: 'Last year, a girl named Hạnh went down to that bend to wash clothes. She never came back.',
    d: delivery(['softly'], 'Sad, restrained.', 0.95),
    vi: 'Năm ngoái, một cô gái tên Hạnh xuống khúc quanh ấy giặt đồ. Cô không bao giờ trở về.' },
  { section: S, beat: 'b3', text: 'They found her two days later among the water hyacinth, as if the river had tucked her in.',
    d: delivery(['sighs'], 'Gentle, melancholic.', 0.9, 250, 700),
    vi: 'Hai ngày sau người ta tìm thấy cô giữa đám lục bình, như thể dòng sông chỉ đắp chăn cho cô ngủ.' },
  { section: S, beat: 'b4', text: 'Her best friend Lan rowed the village đò. One night, coming home late, Lan heard it.',
    d: delivery(['nervous'], 'Build tension.', 0.95),
    vi: 'Bạn thân của cô là Lan, người chèo đò của làng. Một đêm về muộn, Lan đã nghe thấy.' },
  { section: S, beat: 'b4', speaker: 'char-ma-da', text: 'Lan… Lan…',
    d: delivery(['whispers'], 'Distant, from under the water, drawn out.', 0.8, 400, 500), vi: 'Lan ơi… Lan ơi…' },
  { section: S, beat: 'b4', text: 'It was Hạnh’s voice. Soft. Patient. Coming from beneath the boat.',
    d: delivery(['whispers'], 'Eerie, slow.', 0.85, 200, 700),
    vi: 'Đó là giọng của Hạnh. Nhỏ nhẹ. Kiên nhẫn. Vọng lên từ dưới đáy đò.' },
  { section: S, beat: 'b4', text: 'Then a pale hand rose out of the black water and curled its fingers around the edge of the boat.',
    d: delivery(['tense'], 'Slow, deliberate.', 0.9),
    vi: 'Rồi một bàn tay trắng bệch trồi lên khỏi làn nước đen, các ngón tay quặp lấy mạn đò.' },
  { section: S, beat: 'b5', text: 'The next morning, her grandmother, Bà Sáu, lit incense and told her the truth.',
    d: delivery(['calm'], 'Grave, respectful.', 0.95),
    vi: 'Sáng hôm sau, bà nội của cô – bà Sáu – thắp nhang và kể cho cô nghe sự thật.' },
  { section: S, beat: 'b5', text: 'A ma da cannot rest. To be reborn, it must take someone in its place. Someone who answers.',
    d: delivery(['softly'], 'Ominous, quiet.', 0.9, 250, 600),
    vi: 'Ma da không thể yên nghỉ. Muốn được đầu thai, nó phải bắt một người thế chỗ. Một người chịu trả lời nó.' },
  { section: S, beat: 'b5', speaker: 'char-ba-sau', text: 'If you hear her again, child… do not answer. Not even once.',
    d: delivery(['nervous'], 'Old woman, firm but frightened.', 0.9, 200, 700),
    vi: 'Nếu con còn nghe nó gọi… đừng trả lời. Một lần cũng không.' },
  { section: S, beat: 'b6', text: 'Three nights later, the oar stopped moving. Something below was holding it.',
    d: delivery(['nervous'], 'Breath held.', 0.9),
    vi: 'Ba đêm sau, mái chèo bỗng đứng yên. Có thứ gì đó bên dưới đang giữ nó lại.' },
  { section: S, beat: 'b6', text: 'A cold hand closed around Lan’s ankle. Hạnh’s voice was at her ear.',
    d: delivery(['whispers', 'fearful'], 'Very close to the mic.', 0.88),
    vi: 'Một bàn tay lạnh ngắt siết lấy cổ chân Lan. Giọng Hạnh vang sát bên tai.' },
  { section: S, beat: 'b6', speaker: 'char-ma-da', text: 'Come home with me, Lan…',
    d: delivery(['whispers'], 'Pleading, wet, intimate.', 0.8, 200, 600), vi: 'Về với tao đi Lan…' },
  { section: S, beat: 'b6', text: 'Lan said nothing. She lowered the offering tray, lit the incense, and slowly… the hand let go.',
    d: delivery(['trembling'], 'Release of tension at the end.', 0.88, 300, 900),
    vi: 'Lan không nói một lời. Cô thả mâm cúng, thắp nhang, và từ từ… bàn tay buông ra.' },
  { section: 'yt-sec-folk', beat: 'b7', text: 'The ma da is a real belief in Vietnamese folklore. Cồn Mù, Lan and Hạnh are fictional.',
    d: delivery(['calm'], 'Informative, respectful.', 1, 500, 400),
    vi: 'Ma da là một tín ngưỡng có thật trong văn hoá dân gian Việt Nam. Cồn Mù, Lan và Hạnh là hư cấu.' },
  { section: 'yt-sec-outro', beat: 'b7', text: 'The next morning, small wet footprints led from the dock to Lan’s door. Stay away from the water.',
    d: delivery(['whispers'], 'Final chill, slow fade.', 0.85, 600, 600),
    vi: 'Sáng hôm sau, những dấu chân ướt nhỏ dẫn từ bến sông tới cửa nhà Lan. Hãy tránh xa mặt nước.' }
]

const ttSections: ScriptSection[] = [
  { id: 'tt-sec-hook', kind: 'hook', title: 'Móc mở đầu' },
  { id: 'tt-sec-story', kind: 'story', title: 'Câu chuyện' },
  { id: 'tt-sec-cliff', kind: 'cliffhanger', title: 'Câu treo' }
]

const T = 'tt-sec-story'
const ttRaw: RawLine[] = [
  { section: 'tt-sec-hook', beat: 'b1', text: 'Nếu đêm nay có ai gọi tên bạn từ dưới sông… tuyệt đối đừng trả lời.',
    d: delivery(['whispers'], 'Thì thầm, chậm, câu móc trong 3 giây đầu.', 1, 100, 700) },
  { section: T, beat: 'b2', text: 'Ở xóm Cồn Mù, khúc quanh dưới gốc cây đa già chẳng ai dám tắm lúc chạng vạng.',
    d: delivery(['softly'], 'Kể như chuyện thật trong xóm.', 1) },
  { section: T, beat: 'b3', text: 'Năm ngoái, con Hạnh ra đó giặt đồ rồi không về nữa. Hai ngày sau người ta mới tìm thấy, nằm im giữa đám lục bình.',
    d: delivery(['sighs'], 'Buồn, nhỏ giọng.', 0.95, 250, 600) },
  { section: T, beat: 'b4', text: 'Út Lan, bạn thân nó, là đứa chèo đò đưa khách qua sông mỗi tối.', d: delivery([], 'Bình thường, dẫn chuyện.', 1) },
  { section: T, beat: 'b4', text: 'Bữa đó Lan về trễ. Giữa sông, có tiếng ai kêu nhỏ xíu.', d: delivery(['nervous'], 'Hạ giọng dần.', 0.95) },
  { section: T, beat: 'b4', speaker: 'char-ma-da', text: 'Lan ơi… Lan ơi…', d: delivery(['whispers'], 'Xa xăm, vọng từ dưới nước.', 0.8, 300, 500) },
  { section: T, beat: 'b4', text: 'Là giọng con Hạnh. Mà tiếng kêu phát ra từ… ngay dưới đáy ghe. Rồi một bàn tay trắng bệch trồi lên, bám chặt vào mạn đò.',
    d: delivery(['tense'], 'Ngập ngừng trước "ngay dưới đáy ghe".', 0.9) },
  { section: T, beat: 'b5', text: 'Bà Sáu nghe kể thì tái mặt.', d: delivery(['softly'], 'Chậm.', 0.95, 300, 300) },
  { section: T, beat: 'b5', speaker: 'char-ba-sau', text: 'Ma da nó kiếm người thế mạng đó con. Nó kêu thì đừng có trả lời.',
    d: delivery(['nervous'], 'Bà cụ dặn dò, nghiêm và sợ.', 0.9, 200, 600) },
  { section: T, beat: 'b6', text: 'Ba đêm sau, mái chèo của Lan bỗng nặng trịch, như có ai níu dưới nước.', d: delivery(['nervous'], 'Căng dần.', 0.95) },
  { section: T, beat: 'b6', text: 'Một bàn tay lạnh ngắt nắm lấy cổ chân cô, và giọng Hạnh thì thầm sát bên tai.',
    d: delivery(['whispers', 'fearful'], 'Sát micro.', 0.9) },
  { section: T, beat: 'b6', speaker: 'char-ma-da', text: 'Về với tao đi Lan…', d: delivery(['whispers'], 'Van nài, ướt át.', 0.8, 200, 600) },
  { section: T, beat: 'b6', text: 'Lan cắn môi, không nói một lời, run run thả mâm cúng xuống sông, thắp nén nhang.',
    d: delivery(['trembling'], 'Run, nín thở.', 0.9) },
  { section: T, beat: 'b6', text: 'Bàn tay từ từ buông ra… Tưởng vậy là xong.', d: delivery(['sighs'], 'Thở ra nhẹ nhõm rồi khựng lại.', 0.9, 300, 800) },
  { section: 'tt-sec-cliff', beat: 'b7', text: 'Nhưng sáng hôm sau, trên bến có một hàng dấu chân ướt nhỏ xíu… dẫn thẳng tới cửa nhà Lan.',
    d: delivery(['whispers'], 'Câu treo – dừng lửng ở cuối.', 0.88, 400, 500) }
]

export function emptyLedger(limit: number): CostLedger {
  return { estimated: 0, actual: 0, budgetLimit: limit, entries: [] }
}

export function createSampleStory(): Story {
  return {
    id: SAMPLE_STORY_ID,
    name: 'Ma da ở bến cây đa',
    channelPresetId: sampleChannel.id,
    folkloreIds: ['folk-ma-da'],
    premiseVi:
      'Một cô gái chèo đò ở miền Tây nghe giọng người bạn đã chết đuối gọi tên mình từ dưới sông. Bà nội dặn: ma da đang tìm người thế mạng, tuyệt đối đừng trả lời.',
    fictionNoteVi:
      'Ma da là tín ngưỡng dân gian có thật. Làng Cồn Mù, các nhân vật Lan, Hạnh, bà Sáu và mọi sự kiện là HƯ CẤU, không gắn với người thật hay vụ việc có thật.',
    outline: { beats: structuredClone(beats), approval: { status: 'approved', at: NOW } },
    characterIds: sampleCharacters.map((c) => c.id),
    sceneBank: structuredClone(sceneBank),
    releaseIds: [SAMPLE_YT_RELEASE_ID, SAMPLE_TT_RELEASE_ID],
    status: 'testing',
    budget: { limitUsd: 15 },
    performanceNotes: [],
    costs: emptyLedger(15),
    createdAt: NOW,
    updatedAt: NOW
  }
}

export function createSampleReleases(): Release[] {
  const yt: Release = {
    id: SAMPLE_YT_RELEASE_ID,
    storyId: SAMPLE_STORY_ID,
    title: 'YouTube · EN · The Ma Da of the Banyan Bend',
    platform: 'youtube',
    language: 'en',
    aspectRatio: '16:9',
    targetDuration: 150,
    seriesGroupId: null,
    partIndex: 1,
    partCount: 1,
    heroRatio: platformsConfig.platforms.youtube.heroRatio,
    script: { sections: structuredClone(ytSections), lines: buildLines('yt', ytRaw) },
    voiceTrack: null,
    scenes: [],
    chapters: [],
    subtitles: [],
    soundCues: [],
    publishing: null,
    costs: emptyLedger(10),
    pipelineState: null,
    createdAt: NOW,
    updatedAt: NOW
  }
  const tt: Release = {
    id: SAMPLE_TT_RELEASE_ID,
    storyId: SAMPLE_STORY_ID,
    title: 'TikTok · VI · Ma da bến cây đa – Phần 1',
    platform: 'tiktok',
    language: 'vi',
    aspectRatio: '9:16',
    targetDuration: 90,
    seriesGroupId: 'series-ma-da-ben-cay-da',
    partIndex: 1,
    partCount: 1,
    heroRatio: platformsConfig.platforms.tiktok.heroRatio,
    script: { sections: structuredClone(ttSections), lines: buildLines('tt', ttRaw) },
    voiceTrack: null,
    scenes: [],
    chapters: [],
    subtitles: [],
    soundCues: [],
    publishing: null,
    costs: emptyLedger(5),
    pipelineState: null,
    createdAt: NOW,
    updatedAt: NOW
  }
  return [yt, tt]
}
