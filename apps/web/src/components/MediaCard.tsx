import { useState } from 'react';
import type { MediaItem } from '@limited-library/contracts';
import { categoryNames, statusLabel } from '@limited-library/contracts';
import { Icon } from './Icons';
export function Cover({
  item,
  className = '',
}: {
  item: Pick<MediaItem, 'cover' | 'title' | 'category'>;
  className?: string;
}) {
  const [broken, setBroken] = useState(false);
  return (
    <div className={`cover cover-${item.category} ${className}`}>
      {item.cover && !broken ? (
        <img
          src={`/api/assets/${item.cover}`}
          alt={`${item.title}封面`}
          loading="lazy"
          onError={() => setBroken(true)}
        />
      ) : (
        <div className="cover-placeholder">
          <span className="cover-rule" />
          <Icon name={item.category === 'comic' ? 'book' : 'film'} size={30} />
          <span className="cover-title">{item.title || '留给下一部好作品'}</span>
          <span className="cover-caption">LIMITED LIBRARY</span>
          <span className="cover-rule" />
        </div>
      )}
    </div>
  );
}
export function MediaCard({
  item,
  onOpen,
  onFavorite,
  busy,
}: {
  item: MediaItem;
  onOpen: () => void;
  onFavorite: () => void;
  busy: boolean;
}) {
  return (
    <article className="media-card">
      <button className="card-cover-button" onClick={onOpen} aria-label={`查看 ${item.title}`}>
        <Cover item={item} />
        <span className="location-tag">{item.status === 'archived' ? '历史' : '柜内'}</span>
        {item.rating !== null && <span className="rating-tag">{item.rating.toFixed(1)}</span>}
      </button>
      <div className="card-heading">
        <button className="text-button card-title" onClick={onOpen}>
          {item.title}
        </button>
        <button
          className={`favorite-button ${item.favorite ? 'selected' : ''}`}
          aria-label={`${item.favorite ? '取消收藏' : '收藏'} ${item.title}`}
          aria-pressed={item.favorite}
          onClick={onFavorite}
          disabled={busy}
        >
          <Icon name="star" size={18} />
        </button>
      </div>
      <p className="card-meta">
        {categoryNames[item.category]}
        <span>·</span>
        {item.status === 'archived' && item.hasCompleted
          ? item.category === 'comic'
            ? '已读'
            : '已看'
          : statusLabel(item.status, item.category)}
      </p>
    </article>
  );
}
