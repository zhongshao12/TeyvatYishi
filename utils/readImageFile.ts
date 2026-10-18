/** Bounded local file read; selecting a file alone never persists or calls an API. */
export function readImageFileBytes(file: File): Promise<Uint8Array> {
  if (file.size > 20 * 1024 * 1024) return Promise.reject(Error('图片不能超过20MiB。'));
  return new Promise((resolve, reject) => {
    const reader = new FileReader(); reader.onerror = () => reject(Error('图片文件读取失败，请重新选择。'));
    reader.onabort = () => reject(Error('图片文件读取已停止。'));
    reader.onload = () => typeof reader.result === 'string' || !reader.result ? reject(Error('图片内容无效。')) : resolve(new Uint8Array(reader.result));
    reader.readAsArrayBuffer(file);
  });
}
