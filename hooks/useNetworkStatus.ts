import { useEffect, useState } from 'react';
import { toUserFacingError } from '@/utils/userFacingError';

/**
 * 断网检测。
 *
 * 背景：全仓此前 `navigator.onLine` 0 处引用、`online`/`offline` 事件 0 处订阅，
 * 于是断网时玩家只能白等首字节看门狗（45 秒）才看到失败提示，而首字节看门狗
 * 在「连接被黑洞吞掉」时才会超时，断网这种一眼可判的情况根本不该等。
 *
 * 文案统一走 `toUserFacingError` 的共享映射，避免这里再抄一份
 * 「Failed to fetch → 中文」的规则（两份文案漂移会让玩家看到两套说法）。
 */
export const OFFLINE_HINT = toUserFacingError(new TypeError('Failed to fetch'));

export interface NetworkStatus {
  /** 浏览器报告的联网状态。断网时应当直接提示玩家检查连接，而不是等看门狗超时。 */
  online: boolean;
}

/** 读取当前联网状态。非浏览器环境（构建期 / 测试 node 环境）按在线处理，避免误报断网。 */
export function readNetworkOnline(): boolean {
  if (typeof navigator === 'undefined') return true;
  return navigator.onLine !== false;
}

export function useNetworkStatus(): NetworkStatus {
  const [online, setOnline] = useState<boolean>(readNetworkOnline);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const sync = () => setOnline(readNetworkOnline());
    // 订阅之前状态就可能已经变了（首屏加载期间掉线），先对齐一次。
    sync();
    window.addEventListener('online', sync);
    window.addEventListener('offline', sync);
    return () => {
      window.removeEventListener('online', sync);
      window.removeEventListener('offline', sync);
    };
  }, []);

  return { online };
}
