import { useEffect, useRef, useState } from 'react';
import type {
  CategoryId,
  Incoming,
  ItemPage,
  MediaItem,
  ReplacementRequest,
} from '@limited-library/contracts';
import { categoryNames } from '@limited-library/contracts';
import * as api from '../api';
import { Dialog } from './Dialog';
import { Icon } from './Icons';
export interface ReplacementDraft {
  category: CategoryId;
  title: string;
  incoming: Incoming;
}
export function ReplaceDialog({
  draft,
  onClose,
  onSuccess,
}: {
  draft: ReplacementDraft;
  onClose: () => void;
  onSuccess: (item: MediaItem) => void;
}) {
  const [page, setPage] = useState(1),
    [q, setQ] = useState(''),
    [list, setList] = useState<ItemPage | null>(null);
  const [candidate, setCandidate] = useState<MediaItem | null>(null),
    [disposition, setDisposition] = useState<'archive' | 'delete'>('archive');
  const [busy, setBusy] = useState(false),
    [error, setError] = useState(''),
    [confirmed, setConfirmed] = useState(false);
  const [reload, setReload] = useState(0);
  const requestRef = useRef<{ signature: string; id: string } | null>(null);
  useEffect(() => {
    let current = true;
    setList(null);
    api
      .get<ItemPage>(
        `/api/items?scope=retained&category=${draft.category}&pageSize=8&page=${page}&q=${encodeURIComponent(q)}`,
      )
      .then((result) => {
        if (current) setList(result);
      })
      .catch((error) => {
        if (current) setError(api.message(error));
      });
    return () => {
      current = false;
    };
  }, [draft.category, page, q, reload]);
  async function submit() {
    if (!candidate) return;
    const payload = {
      targetCategory: draft.category,
      candidate: { id: candidate.id, expectedVersion: candidate.version },
      disposition,
      incoming: draft.incoming,
    };
    const signature = JSON.stringify(payload);
    if (requestRef.current?.signature !== signature)
      requestRef.current = { signature, id: crypto.randomUUID() };
    setBusy(true);
    setError('');
    try {
      const body: ReplacementRequest = { ...payload, requestId: requestRef.current!.id };
      const result = await api.write<MediaItem>('/api/replacements', 'POST', body);
      onSuccess(result);
    } catch (error) {
      setError(api.message(error));
      if (
        error instanceof api.ApiError &&
        ['VERSION_CONFLICT', 'INVALID_REPLACEMENT', 'ITEM_NOT_FOUND'].includes(error.code)
      ) {
        setCandidate(null);
        setConfirmed(false);
        setReload((value) => value + 1);
      }
    } finally {
      setBusy(false);
    }
  }
  return (
    <Dialog title="为新作品，腾一个位置" eyebrow="REPLACE MODE" onClose={onClose} busy={busy} wide>
      <div className="dialog-body">
        <p className="muted">
          {categoryNames[draft.category]}收藏柜已满。选择一部柜内作品，和「{draft.title}」完成替换。
        </p>
        <div className="callout">
          <Icon name="archive" />
          <span>推荐归档：释放位置，资料、收藏和已看记录都会保留。</span>
        </div>
        <label className="search-field">
          <Icon name="search" />
          <input
            value={q}
            onChange={(event) => {
              setQ(event.target.value);
              setPage(1);
            }}
            placeholder="搜索可替换作品"
            aria-label="搜索可替换作品"
          />
        </label>
        <div className="candidate-list" aria-label="替换候选">
          {!list ? (
            <p className="muted">正在读取候选…</p>
          ) : (
            list.items
              .filter((item) => draft.incoming.kind === 'create' || item.id !== draft.incoming.id)
              .map((item) => (
                <label
                  key={item.id}
                  className={`candidate ${candidate?.id === item.id ? 'chosen' : ''}`}
                >
                  <input
                    type="radio"
                    name="candidate"
                    checked={candidate?.id === item.id}
                    onChange={() => {
                      setCandidate(item);
                      setConfirmed(false);
                    }}
                  />
                  <span>
                    <strong>{item.title}</strong>
                    <small>{item.hasCompleted ? '曾经看完／读完' : '柜内保留作品'}</small>
                  </span>
                  <span className="candidate-rating">
                    {item.rating === null ? '未评分' : item.rating.toFixed(1)}
                  </span>
                </label>
              ))
          )}
        </div>
        {list && list.total > 8 && (
          <div className="pagination">
            <button onClick={() => setPage(page - 1)} disabled={page === 1 || busy}>
              上一页
            </button>
            <span>
              {page} / {Math.ceil(list.total / 8)}
            </span>
            <button onClick={() => setPage(page + 1)} disabled={page * 8 >= list.total || busy}>
              下一页
            </button>
          </div>
        )}
        <fieldset className="disposition">
          <legend>旧作品如何处理</legend>
          <label>
            <input
              type="radio"
              name="disposition"
              checked={disposition === 'archive'}
              onChange={() => {
                setDisposition('archive');
                setConfirmed(false);
              }}
            />
            归档，保留历史
          </label>
          <label>
            <input
              type="radio"
              name="disposition"
              checked={disposition === 'delete'}
              onChange={() => {
                setDisposition('delete');
                setConfirmed(false);
              }}
            />
            永久删除
          </label>
        </fieldset>
        {candidate && (
          <div
            className={disposition === 'delete' ? 'callout danger-callout' : 'replacement-summary'}
          >
            <p>
              将「{candidate.title}」
              {disposition === 'delete' ? '永久删除（也从已看清单移除）' : '归档'}，把「
              {draft.title}」放入收藏柜。
            </p>
            <label className="checkbox-line">
              <input
                type="checkbox"
                checked={confirmed}
                onChange={(event) => setConfirmed(event.target.checked)}
              />
              我确认这次替换
            </label>
          </div>
        )}
        {error && (
          <p role="alert" className="form-error">
            {error}
          </p>
        )}
      </div>
      <footer className="dialog-footer">
        <button type="button" className="button secondary" onClick={onClose} disabled={busy}>
          取消，保留草稿
        </button>
        <button
          type="button"
          className="button primary"
          onClick={submit}
          disabled={!candidate || !confirmed || busy}
        >
          {busy ? '正在替换…' : '确认替换'}
          <Icon name="arrow" size={17} />
        </button>
      </footer>
    </Dialog>
  );
}
