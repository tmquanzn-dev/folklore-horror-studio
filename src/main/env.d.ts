// ffprobe-static không kèm khai báo kiểu
declare module 'ffprobe-static' {
  const ffprobe: { path: string }
  export default ffprobe
}
