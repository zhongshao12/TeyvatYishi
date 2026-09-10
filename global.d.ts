export {};

declare global {
  interface Window {
    __ROOT_MOUNTED__?: boolean;
    __PREBOOT_ERROR__?: string | null;
  }

  /** 由 vite define 从 package.json 注入的当前版本号。 */
  const __APP_VERSION__: string;
}
