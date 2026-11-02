// Entry cho @remotion/bundler (render MP4 trong utility process).
// LƯU Ý: thư mục src/remotion chỉ được import tương đối và chỉ import type/hàm thuần từ src/shared,
// vì webpack của Remotion không biết alias của Vite.
import { registerRoot } from 'remotion'
import { RemotionRoot } from './Root'

registerRoot(RemotionRoot)
