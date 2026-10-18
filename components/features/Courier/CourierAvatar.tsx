import { useState } from 'react';

export interface CourierAvatarData { name: string; src?: string }
/** Read-only avatar presentation; a broken image must not leave a broken icon. */
export function CourierAvatar({ name, src, small = false }: CourierAvatarData & { small?: boolean }) {
  const [failedSrc, setFailedSrc] = useState<string | null>(null);
  return <span role="img" aria-label={`${name}头像`} className={`phone-contact-avatar${small ? ' phone-contact-avatar-small' : ''}`}>
    {src && src !== failedSrc ? <img src={src} alt="" loading="lazy" decoding="async" onError={() => setFailedSrc(src)} /> : <span aria-hidden="true">{name.trim().slice(0, 1) || '友'}</span>}
  </span>;
}
export function CourierConversationAvatar({ avatars, name }: { avatars: readonly CourierAvatarData[]; name: string }) {
  if (avatars.length <= 1) return <CourierAvatar name={avatars[0]?.name || name} src={avatars[0]?.src} />;
  return <span className="phone-group-avatar" aria-label={`${name}群聊头像`}>{avatars.slice(0, 4).map((avatar, index) => <CourierAvatar key={index} {...avatar} small />)}</span>;
}
export function CourierUnreadBadge({ count }: { count: number }) {
  return count > 0 ? <span className="phone-unread-badge" aria-label={`${count} 条未读消息`} title={`${count} 条未读消息`}>{count > 99 ? '99+' : count}</span> : null;
}
