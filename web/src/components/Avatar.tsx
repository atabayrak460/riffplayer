import { avatarUrl } from '../api/subsonic';

/** A member's picture, or their initial on a colour tile when they have none. */
export function Avatar({
  userId, name, hasAvatar, version, size = 48, className = '',
}: { userId: number; name: string; hasAvatar: boolean; version: number | null; size?: number; className?: string }) {
  const style = { width: size, height: size };
  if (hasAvatar) {
    return <img src={avatarUrl(userId, version)} alt="" style={style} className={`rounded-full object-cover flex-shrink-0 ${className}`} />;
  }
  let hue = 0;
  for (const ch of name) hue = (hue * 31 + ch.codePointAt(0)!) % 360;
  return (
    <div
      aria-hidden="true"
      style={{ ...style, background: `linear-gradient(135deg, hsl(${hue} 55% 38%), hsl(${(hue + 50) % 360} 60% 22%))`, fontSize: size * 0.42 }}
      className={`rounded-full flex-shrink-0 flex items-center justify-center text-white font-bold ${className}`}
    >
      {([...name][0] ?? '?').toUpperCase()}
    </div>
  );
}
