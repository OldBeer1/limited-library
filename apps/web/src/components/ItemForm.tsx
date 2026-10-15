import { useRef, useState } from 'react';
import type {
  ActiveStatus,
  CategoryId,
  CreateRequest,
  MediaInput,
  MediaItem,
  Status,
  UpdateRequest,
} from '@limited-library/contracts';
import { categoryIds, categoryNames, statuses, statusLabel } from '@limited-library/contracts';
import * as api from '../api';
import { Dialog } from './Dialog';
import { Cover } from './MediaCard';
import { Icon } from './Icons';
import type { ReplacementDraft } from './ReplaceDialog';
function localDate() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
}
export function ItemForm({
  existing,
  placement: initialPlacement,
  category: initialCategory,
  onClose,
  onSave,
  onReplace,
  onDelete,
}: {
  existing?: MediaItem;
  placement: 'cabinet' | 'history';
  category?: CategoryId;
  onClose: () => void;
  onSave: () => void;
  onReplace: (draft: ReplacementDraft) => void;
  onDelete: (item: MediaItem) => void;
}) {
  const [title, setTitle] = useState(existing?.title ?? ''),
    [originalTitle, setOriginal] = useState(existing?.originalTitle ?? '');
  const [category, setCategory] = useState<CategoryId>(
    existing?.category ?? initialCategory ?? 'movie',
  );
  const [placement, setPlacement] = useState(initialPlacement),
    [status, setStatus] = useState<Status>(
      existing?.status ?? (initialPlacement === 'history' ? 'completed' : 'planned'),
    );
  const [archivedFrom, setArchivedFrom] = useState<ActiveStatus>(
    existing?.archivedFromStatus ?? 'completed',
  );
  const [rating, setRating] = useState(existing?.rating?.toString() ?? ''),
    [dateAdded, setAdded] = useState(existing?.dateAdded ?? localDate());
  const [dateCompleted, setDateCompleted] = useState(existing?.dateCompleted ?? ''),
    [notes, setNotes] = useState(existing?.notes ?? '');
  const [favorite, setFavorite] = useState(existing?.favorite ?? false),
    [completed, setCompleted] = useState(existing?.hasCompleted ?? initialPlacement === 'history');
  const [cover, setCover] = useState(existing?.cover ?? null),
    [busy, setBusy] = useState(false),
    [uploading, setUploading] = useState(false);
  const [error, setError] = useState(''),
    [duplicates, setDuplicates] = useState(''),
    [latest, setLatest] = useState<MediaItem | null>(null);
  const [baseVersion, setVersion] = useState(existing?.version ?? 1);
  const requestRef = useRef<{ signature: string; id: string } | null>(null);
  const isHistoryNew = !existing && placement === 'history';
  async function checkDuplicates() {
    if (!title.trim()) {
      setDuplicates('');
      return;
    }
    try {
      const query = encodeURIComponent(title.trim());
      const pages = await Promise.all(
        ['retained', 'archive'].map((scope) =>
          api.get<{ items: MediaItem[] }>(`/api/items?scope=${scope}&q=${query}&pageSize=50`),
        ),
      );
      const matches = pages
        .flatMap((page) => page.items)
        .filter(
          (item) =>
            item.id !== existing?.id &&
            item.title.trim().toLocaleLowerCase() === title.trim().toLocaleLowerCase(),
        );
      setDuplicates(
        matches.length ? `已有 ${matches.length} 条同名记录。不同版本可以继续添加。` : '',
      );
    } catch {
      setDuplicates('暂时无法检查同名记录，仍可继续填写。');
    }
  }
  async function save(statusOverride?: Status) {
    const nextStatus = statusOverride ?? status;
    const item: MediaInput = {
      title,
      originalTitle: originalTitle || null,
      category,
      cover,
      status: nextStatus,
      rating: rating === '' ? null : Number(rating),
      dateAdded,
      dateCompleted: dateCompleted || null,
      notes,
      favorite,
      hasCompleted: completed || nextStatus === 'completed' || isHistoryNew || !!dateCompleted,
      archivedFromStatus:
        nextStatus === 'archived'
          ? existing?.status === 'archived'
            ? archivedFrom
            : status === 'archived'
              ? archivedFrom
              : (status as ActiveStatus)
          : null,
    };
    const payload = existing
      ? { expectedVersion: baseVersion, changes: item }
      : { placement, item };
    const signature = JSON.stringify(payload);
    if (requestRef.current?.signature !== signature)
      requestRef.current = { signature, id: crypto.randomUUID() };
    setBusy(true);
    setError('');
    setLatest(null);
    try {
      if (existing)
        await api.write<MediaItem>(`/api/items/${existing.id}`, 'PATCH', {
          ...payload,
          requestId: requestRef.current!.id,
        } as UpdateRequest);
      else
        await api.write<MediaItem>('/api/items', 'POST', {
          ...payload,
          requestId: requestRef.current!.id,
        } as CreateRequest);
      onSave();
    } catch (error) {
      if (error instanceof api.ApiError && error.code === 'CATEGORY_FULL') {
        onReplace({
          category,
          title,
          incoming: existing
            ? {
                kind: existing.status === 'archived' ? 'restore' : 'move',
                id: existing.id,
                expectedVersion: baseVersion,
                changes: item,
              }
            : { kind: 'create', item },
        });
      } else {
        setError(api.message(error));
        if (error instanceof api.ApiError && error.code === 'VERSION_CONFLICT' && existing) {
          try {
            setLatest(await api.get<MediaItem>(`/api/items/${existing.id}`));
          } catch {
            /* Keep original conflict and draft visible. */
          }
        }
      }
    } finally {
      setBusy(false);
    }
  }
  async function chooseCover(file?: File) {
    if (!file) return;
    setUploading(true);
    setError('');
    try {
      setCover(await api.upload(file));
    } catch (error) {
      setError(api.message(error));
    } finally {
      setUploading(false);
    }
  }
  return (
    <Dialog
      title={existing ? '作品与记忆' : isHistoryNew ? '记下已经看过的' : '留一个位置给它'}
      eyebrow={existing ? 'YOUR COLLECTION' : isHistoryNew ? 'WATCHED & READ' : 'A NEW CHAPTER'}
      onClose={onClose}
      wide
      busy={busy || uploading}
    >
      <form
        onSubmit={(event) => {
          event.preventDefault();
          void save();
        }}
      >
        <div className="dialog-body item-form">
          <aside className="form-cover">
            <Cover key={cover ?? 'none'} item={{ title, category, cover }} />
            <label className="button secondary upload-label">
              {uploading ? '正在验证封面…' : '上传封面'}
              <input
                type="file"
                accept="image/png,image/jpeg,image/webp"
                disabled={busy || uploading}
                onChange={(event) => void chooseCover(event.target.files?.[0])}
              />
            </label>
            {cover && (
              <button
                type="button"
                className="text-button muted"
                onClick={() => setCover(null)}
                disabled={busy}
              >
                移除封面引用
              </button>
            )}
            <p className="field-hint">
              PNG / JPEG / WebP · 最大 5 MiB
              <br />
              也可以让封面留白。
            </p>
          </aside>
          <div className="form-fields">
            {!existing && (
              <fieldset className="placement-choice">
                <legend>记录放在哪里</legend>
                <label className={placement === 'cabinet' ? 'selected' : ''}>
                  <input
                    type="radio"
                    name="placement"
                    checked={placement === 'cabinet'}
                    onChange={() => setPlacement('cabinet')}
                  />
                  限量收藏柜
                </label>
                <label className={placement === 'history' ? 'selected' : ''}>
                  <input
                    type="radio"
                    name="placement"
                    checked={placement === 'history'}
                    onChange={() => {
                      setPlacement('history');
                      setCompleted(true);
                      setStatus('completed');
                    }}
                  />
                  已看／已读历史
                </label>
              </fieldset>
            )}
            {isHistoryNew && (
              <p className="field-hint">完整保存观看记录，不占收藏柜位置。忘记日期也没关系。</p>
            )}
            <label className="field full">
              作品标题
              <input
                value={title}
                maxLength={300}
                required
                autoFocus
                onChange={(event) => setTitle(event.target.value)}
                onBlur={() => void checkDuplicates()}
                placeholder="一部值得记住的作品"
              />
            </label>
            {duplicates && <p className="field-hint duplicate-hint">{duplicates}</p>}
            <label className="field full">
              原标题 <span className="optional">可选</span>
              <input
                value={originalTitle}
                maxLength={300}
                onChange={(event) => setOriginal(event.target.value)}
                placeholder="Original title"
              />
            </label>
            <div className="field-row">
              <label className="field">
                分类
                <select
                  value={category}
                  onChange={(event) => setCategory(event.target.value as CategoryId)}
                >
                  {categoryIds.map((id) => (
                    <option key={id} value={id}>
                      {categoryNames[id]}
                    </option>
                  ))}
                </select>
              </label>
              <label className="field">
                {status === 'archived' ? '归档前状态' : '当前状态'}
                <select
                  value={status === 'archived' ? archivedFrom : status}
                  disabled={isHistoryNew}
                  onChange={(event) => {
                    const value = event.target.value as ActiveStatus;
                    if (status === 'archived') setArchivedFrom(value);
                    else setStatus(value);
                    if (value === 'completed') setCompleted(true);
                  }}
                >
                  {statuses
                    .filter((s) => s !== 'archived')
                    .map((s) => (
                      <option key={s} value={s}>
                        {statusLabel(s, category)}
                      </option>
                    ))}
                </select>
              </label>
            </div>
            <div className="field-row">
              <label className="field">
                评分 <span className="optional">可选</span>
                <input
                  type="number"
                  min="0"
                  max="10"
                  step="0.5"
                  inputMode="decimal"
                  value={rating}
                  onChange={(event) => setRating(event.target.value)}
                  placeholder="0–10，半分步长"
                />
              </label>
              <label className="field">
                添加日期
                <input
                  type="date"
                  value={dateAdded}
                  required
                  onChange={(event) => setAdded(event.target.value)}
                />
              </label>
            </div>
            <div className="field-row">
              <label className="field">
                完成日期 <span className="optional">可选</span>
                <input
                  type="date"
                  value={dateCompleted}
                  onChange={(event) => {
                    setDateCompleted(event.target.value);
                    if (event.target.value) setCompleted(true);
                  }}
                />
              </label>
              <div className="field check-field">
                <label className="checkbox-line">
                  <input
                    type="checkbox"
                    checked={completed || isHistoryNew}
                    disabled={isHistoryNew}
                    onChange={(event) => setCompleted(event.target.checked)}
                  />
                  曾经{category === 'comic' ? '读完' : '看完'}
                </label>
                <label className="checkbox-line">
                  <input
                    type="checkbox"
                    checked={favorite}
                    onChange={(event) => setFavorite(event.target.checked)}
                  />
                  <Icon name="star" size={15} />
                  标记收藏
                </label>
              </div>
            </div>
            <label className="field full">
              留一点感想 <span className="optional">可选</span>
              <textarea
                rows={4}
                value={notes}
                maxLength={10000}
                onChange={(event) => setNotes(event.target.value)}
                placeholder="记住它打动你的原因。"
              />
            </label>
            {existing && (
              <p className="field-hint">
                {existing.status === 'archived' ? '当前位置：历史／归档' : '当前位置：收藏柜'} ·
                资料版本 {baseVersion}
              </p>
            )}
            {error && (
              <p className="form-error" role="alert">
                {error}
              </p>
            )}
            {latest && (
              <div className="conflict-box">
                <p>当前草稿保留。请先比较服务器最新内容：</p>
                <pre>
                  {JSON.stringify(
                    {
                      title: latest.title,
                      category: latest.category,
                      status: latest.status,
                      rating: latest.rating,
                      notes: latest.notes,
                      favorite: latest.favorite,
                      hasCompleted: latest.hasCompleted,
                      dateCompleted: latest.dateCompleted,
                    },
                    null,
                    2,
                  )}
                </pre>
                <button
                  type="button"
                  className="button secondary"
                  onClick={() => {
                    setVersion(latest.version);
                    setLatest(null);
                    setError('已采用最新版本号，当前草稿未改动；请确认后保存。');
                  }}
                >
                  使用最新版本继续，保留草稿
                </button>
              </div>
            )}
          </div>
        </div>
        <footer className="dialog-footer">
          <div className="record-actions">
            {existing && (
              <>
                <button
                  type="button"
                  className="text-button danger-text"
                  onClick={() => onDelete({ ...existing, version: baseVersion })}
                  disabled={busy || uploading}
                >
                  永久删除
                </button>
                <button
                  type="button"
                  className="text-button"
                  disabled={busy || uploading}
                  onClick={() =>
                    void save(existing.status === 'archived' ? archivedFrom : 'archived')
                  }
                >
                  {existing.status === 'archived' ? '放入收藏柜' : '归档并保存'}
                </button>
              </>
            )}
          </div>
          <div className="footer-buttons">
            <button
              type="button"
              className="button secondary"
              onClick={onClose}
              disabled={busy || uploading}
            >
              取消
            </button>
            <button
              type="submit"
              className="button primary"
              disabled={busy || uploading || !!latest}
            >
              {busy ? '正在保存…' : '保存记录'}
              <Icon name="check" size={17} />
            </button>
          </div>
        </footer>
      </form>
    </Dialog>
  );
}
