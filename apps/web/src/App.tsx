import { useCallback, useEffect, useState } from 'react';
import type {
  Category,
  CategoryId,
  ItemPage,
  MediaItem,
  Scope,
  Summary,
} from '@limited-library/contracts';
import { categoryIds, categoryNames, statuses, statusLabel } from '@limited-library/contracts';
import * as api from './api';
import { Icon } from './components/Icons';
import { MediaCard } from './components/MediaCard';
import { ItemForm } from './components/ItemForm';
import { ReplaceDialog } from './components/ReplaceDialog';
import type { ReplacementDraft } from './components/ReplaceDialog';
import { Dialog } from './components/Dialog';
interface Editor {
  item?: MediaItem;
  placement: 'cabinet' | 'history';
}
function CapacityForm({
  category,
  onSave,
  onError,
}: {
  category: Category;
  onSave: () => void;
  onError: (error: string) => void;
}) {
  const [capacity, setCapacity] = useState(String(category.capacity)),
    [busy, setBusy] = useState(false);
  async function submit() {
    setBusy(true);
    try {
      await api.write(`/api/categories/${category.id}`, 'PATCH', {
        requestId: crypto.randomUUID(),
        expectedVersion: category.version,
        capacity: Number(capacity),
      });
      onSave();
    } catch (error) {
      onError(api.message(error));
    } finally {
      setBusy(false);
    }
  }
  return (
    <form
      className="capacity-card"
      onSubmit={(event) => {
        event.preventDefault();
        void submit();
      }}
    >
      <div>
        <span className="eyebrow">{category.id.toUpperCase()}</span>
        <h3>{category.name}</h3>
        <p className="muted">
          目前保留 {category.retained} 部 · 余位 {category.remaining}
        </p>
      </div>
      <label className="field">
        容量上限
        <input
          aria-label={`${category.name}容量上限`}
          type="number"
          min={category.retained}
          max="100000"
          step="1"
          required
          value={capacity}
          onChange={(event) => setCapacity(event.target.value)}
        />
      </label>
      <button
        className="button secondary"
        disabled={busy || Number(capacity) === category.capacity}
      >
        {busy ? '保存中…' : '保存容量'}
      </button>
    </form>
  );
}
export default function App() {
  const [path, setPath] = useState(window.location.pathname),
    [summary, setSummary] = useState<Summary | null>(null),
    [list, setList] = useState<ItemPage | null>(null);
  const [q, setQ] = useState(''),
    [status, setStatus] = useState(''),
    [favorites, setFavorites] = useState(false),
    [sort, setSort] = useState(''),
    [placement, setPlacement] = useState('all'),
    [page, setPage] = useState(1);
  const [refresh, setRefresh] = useState(0),
    [error, setError] = useState(''),
    [notice, setNotice] = useState('');
  const [editor, setEditor] = useState<Editor | null>(null),
    [replacement, setReplacement] = useState<ReplacementDraft | null>(null),
    [pendingIds, setPendingIds] = useState<string[]>([]);
  const [deletion, setDeletion] = useState<{ item: MediaItem; requestId: string } | null>(null),
    [deleting, setDeleting] = useState(false);
  const settings = path === '/settings';
  const scope: Scope = path.startsWith('/history')
    ? 'history'
    : path.startsWith('/archive')
      ? 'archive'
      : 'retained';
  const part = path.split('/')[2];
  const category = categoryIds.includes(part as CategoryId) ? (part as CategoryId) : undefined;
  const navigate = useCallback((next: string) => {
    window.history.pushState(null, '', next);
    setPath(next);
    setPage(1);
    setQ('');
    setStatus('');
    setSort('');
    setPlacement('all');
    setError('');
  }, []);
  useEffect(() => {
    const onPop = () => {
      setPath(window.location.pathname);
      setPage(1);
    };
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, []);
  useEffect(() => {
    if (path === '/items/new')
      setEditor({
        placement:
          new URLSearchParams(window.location.search).get('placement') === 'history'
            ? 'history'
            : 'cabinet',
      });
    else if (/^\/items\/[0-9a-f-]{36}$/i.test(path))
      api
        .get<MediaItem>(`/api${path}`)
        .then((item) =>
          setEditor({ item, placement: item.status === 'archived' ? 'history' : 'cabinet' }),
        )
        .catch((error) => setError(api.message(error)));
  }, [path]);
  useEffect(() => {
    let current = true;
    setList(null);
    setError('');
    const params = new URLSearchParams({ scope, page: String(page), pageSize: '24' });
    if (category) params.set('category', category);
    if (q) params.set('q', q);
    if (status) params.set('status', status);
    if (favorites) params.set('favorite', 'true');
    if (sort) params.set('sort', sort);
    if (scope === 'history' && placement !== 'all') params.set('placement', placement);
    Promise.all([
      api.get<Summary>('/api/summary'),
      settings ? Promise.resolve(null) : api.get<ItemPage>(`/api/items?${params}`),
    ])
      .then(([summary, items]) => {
        if (current) {
          setSummary(summary);
          setList(items);
          if (items && page > Math.max(1, Math.ceil(items.total / items.pageSize)))
            setPage(Math.max(1, Math.ceil(items.total / items.pageSize)));
        }
      })
      .catch((error) => {
        if (current) setError(api.message(error));
      });
    return () => {
      current = false;
    };
  }, [scope, category, q, status, favorites, sort, placement, page, refresh, settings]);
  function saved(text = '记录已保存。') {
    setEditor(null);
    setReplacement(null);
    setDeletion(null);
    setNotice(text);
    setRefresh((n) => n + 1);
    if (path.startsWith('/items/')) navigate('/');
  }
  function closeEditor() {
    setEditor(null);
    if (path.startsWith('/items/')) navigate('/');
  }
  async function toggleFavorite(item: MediaItem) {
    setPendingIds((ids) => [...ids, item.id]);
    setError('');
    try {
      await api.write(`/api/items/${item.id}`, 'PATCH', {
        requestId: crypto.randomUUID(),
        expectedVersion: item.version,
        changes: { favorite: !item.favorite },
      });
      setRefresh((n) => n + 1);
    } catch (error) {
      setError(api.message(error));
    } finally {
      setPendingIds((ids) => ids.filter((id) => id !== item.id));
    }
  }
  async function deleteItem() {
    if (!deletion) return;
    setDeleting(true);
    try {
      await api.write(`/api/items/${deletion.item.id}`, 'DELETE', {
        requestId: deletion.requestId,
        expectedVersion: deletion.item.version,
      });
      saved('作品已永久删除。');
    } catch (error) {
      setError(api.message(error));
    } finally {
      setDeleting(false);
    }
  }
  const title = settings
    ? '为喜欢的作品，划定边界。'
    : scope === 'history'
      ? category
        ? `${categoryNames[category]}，都记得。`
        : '看过的，都值得记下。'
      : scope === 'archive'
        ? '暂别收藏柜，记忆仍在。'
        : category
          ? `留给${categoryNames[category]}的空间。`
          : '为热爱，留一点位置。';
  const activeCategory = summary?.categories.find((c) => c.id === category);
  return (
    <div className="app-shell">
      <aside className="sidebar">
        <a
          className="brand"
          href="/"
          onClick={(event) => {
            event.preventDefault();
            navigate('/');
          }}
        >
          <span className="brand-mark">
            ll<span>.</span>
          </span>
          <span className="brand-name">
            Limited
            <br />
            Library
          </span>
        </a>
        <p className="brand-caption">有限收藏 · 无限记忆</p>
        <div className="sidebar-rule" />
        <p className="nav-caption">我的资料库</p>
        <nav aria-label="主导航">
          {[
            {
              path: '/',
              label: '收藏柜',
              english: 'The cabinet',
              icon: 'cabinet',
              active: scope === 'retained' && !settings,
            },
            {
              path: '/history',
              label: '已看 · 已读',
              english: 'Every memory',
              icon: 'history',
              active: scope === 'history',
            },
            {
              path: '/archive',
              label: '归档',
              english: 'Set aside',
              icon: 'archive',
              active: scope === 'archive',
            },
            {
              path: '/settings',
              label: '容量设置',
              english: 'Make room',
              icon: 'settings',
              active: settings,
            },
          ].map((item) => (
            <a
              key={item.path}
              href={item.path}
              className={`nav-item ${item.active ? 'active' : ''}`}
              aria-current={item.active ? 'page' : undefined}
              onClick={(event) => {
                event.preventDefault();
                navigate(item.path);
              }}
            >
              <Icon name={item.icon} />
              <span>
                {item.label}
                <small>{item.english}</small>
              </span>
              {item.active && <span className="nav-dot" />}
            </a>
          ))}
        </nav>
        <div className="sidebar-bottom">
          <span className="local-dot" />
          仅存于本机
          <p>
            不必拥有所有。
            <br />
            让留下来的，都是喜欢。
          </p>
          <span className="sidebar-version">LIMITED LIBRARY / 01</span>
        </div>
      </aside>
      <main className="main">
        <header className="topbar">
          <span className="topbar-label">PERSONAL COLLECTION</span>
          <span className="topbar-note">
            <span className="local-dot" />
            本地资料库
          </span>
        </header>
        <section className="intro">
          <div>
            <p className="eyebrow">
              {settings
                ? 'A LITTLE INTENTION'
                : scope === 'history'
                  ? 'EVERY STORY STAYS'
                  : scope === 'archive'
                    ? 'NOT FORGOTTEN'
                    : 'LESS, BUT MEANINGFUL'}
            </p>
            <h1>{title}</h1>
            <p className="intro-subtitle">
              {settings
                ? '容量不是目标，是为每一次选择留一点思考。'
                : scope === 'history'
                  ? '没有数量上限。曾经喜欢过的，完整留在这里。'
                  : scope === 'archive'
                    ? '归档释放位置，也保留作品资料与收藏标记。'
                    : '收藏有边界，喜欢没有。慢慢选，把值得的留下。'}
            </p>
          </div>
          {!settings && (
            <button
              className="button primary add-button"
              onClick={() => setEditor({ placement: scope === 'history' ? 'history' : 'cabinet' })}
            >
              <Icon name="plus" size={18} />
              {scope === 'history' ? '补录已看 / 已读' : '添加作品'}
            </button>
          )}
        </section>
        {notice && (
          <div className="notice" role="status">
            <Icon name="check" size={17} />
            {notice}
            <button className="icon-button" aria-label="关闭提示" onClick={() => setNotice('')}>
              <Icon name="close" size={16} />
            </button>
          </div>
        )}
        {error && (
          <div className="error-banner" role="alert">
            <span>{error}</span>
            <button className="text-button" onClick={() => setRefresh((n) => n + 1)}>
              重新读取
            </button>
          </div>
        )}
        {settings ? (
          <>
            <div className="section-title">
              <h2>六种热爱，六个边界</h2>
              <span>
                当前保留 {summary?.retained ?? '—'} / {summary?.capacity ?? '—'}
              </span>
            </div>
            <div className="settings-grid">
              {summary?.categories.map((c) => (
                <CapacityForm
                  key={`${c.id}-${c.version}`}
                  category={c}
                  onSave={() => {
                    setNotice('容量已更新。');
                    setRefresh((n) => n + 1);
                  }}
                  onError={setError}
                />
              ))}
            </div>
            <div className="settings-note">
              <Icon name="archive" />
              <div>
                <h3>历史记录不受容量限制</h3>
                <p>
                  已看／已读和归档可以完整保留。要缩小柜子，先归档作品；归档后仍能在历史清单中找到它。
                </p>
                <p>备份与恢复请按项目 README 的停服步骤操作。个人记录不会上传 GitHub。</p>
              </div>
            </div>
          </>
        ) : (
          <>
            {scope === 'retained' && !category && (
              <section className="capacity-overview" aria-label="六类容量">
                {summary?.categories.map((c, index) => (
                  <button
                    key={c.id}
                    className="category-capacity"
                    onClick={() => navigate(`/cabinet/${c.id}`)}
                  >
                    <div className="capacity-top">
                      <span className="capacity-number">0{index + 1}</span>
                      <Icon name="arrow" size={16} />
                    </div>
                    <h2>{c.name}</h2>
                    <div className="capacity-values">
                      <strong>
                        {c.retained}
                        <small> / {c.capacity}</small>
                      </strong>
                      <span>
                        {c.capacity === 0
                          ? '已停用'
                          : c.remaining === 0
                            ? '已满'
                            : `余 ${c.remaining} 位`}
                      </span>
                    </div>
                    <span className="capacity-track">
                      <span
                        style={{ width: `${c.capacity ? (c.retained / c.capacity) * 100 : 0}%` }}
                      />
                    </span>
                  </button>
                ))}
              </section>
            )}
            {activeCategory && scope === 'retained' && (
              <div className="category-banner">
                <span>
                  目前保留{' '}
                  <strong>
                    {activeCategory.retained} / {activeCategory.capacity}
                  </strong>
                </span>
                <span>
                  {activeCategory.capacity === 0
                    ? '此分类已停用，请在设置中调整容量。'
                    : activeCategory.remaining
                      ? `还有 ${activeCategory.remaining} 个位置，不必急着填满。`
                      : '收藏柜已满，下一次加入需要做一次选择。'}
                </span>
              </div>
            )}
            <section className="collection-section">
              <div className="section-title">
                <h2>
                  {scope === 'history'
                    ? category === 'comic'
                      ? '已读清单'
                      : '已看 / 已读清单'
                    : scope === 'archive'
                      ? '归档作品'
                      : '柜中的作品'}
                  <span className="count-badge">{list?.total ?? '—'}</span>
                </h2>
                <span className="section-note">
                  {scope === 'history'
                    ? `${summary?.completedCount ?? '—'} 条完整记忆`
                    : scope === 'archive'
                      ? '留着，等想起的时候'
                      : `${summary?.retained ?? '—'} / ${summary?.capacity ?? '—'} 个位置`}
                </span>
              </div>
              {
                <div className="category-tabs" aria-label="分类">
                  <button
                    className={!category ? 'active' : ''}
                    onClick={() =>
                      navigate(
                        scope === 'history' ? '/history' : scope === 'archive' ? '/archive' : '/',
                      )
                    }
                  >
                    全部
                  </button>
                  {categoryIds.map((id) => (
                    <button
                      key={id}
                      className={category === id ? 'active' : ''}
                      onClick={() =>
                        navigate(
                          `${scope === 'history' ? '/history' : scope === 'archive' ? '/archive' : '/cabinet'}/${id}`,
                        )
                      }
                    >
                      {categoryNames[id]}
                    </button>
                  ))}
                </div>
              }
              <div className="filters">
                <label className="search-field">
                  <Icon name="search" size={19} />
                  <input
                    type="search"
                    value={q}
                    maxLength={300}
                    placeholder="搜索标题或原标题…"
                    aria-label="搜索作品"
                    onChange={(event) => {
                      setQ(event.target.value);
                      setPage(1);
                    }}
                  />
                </label>
                <div className="filter-controls">
                  <select
                    aria-label="状态筛选"
                    value={status}
                    onChange={(event) => {
                      setStatus(event.target.value);
                      setPage(1);
                    }}
                  >
                    <option value="">全部状态</option>
                    {statuses.map((s) => (
                      <option key={s} value={s}>
                        {statusLabel(s, category)}
                      </option>
                    ))}
                  </select>
                  {scope === 'history' && (
                    <select
                      aria-label="位置筛选"
                      value={placement}
                      onChange={(event) => {
                        setPlacement(event.target.value);
                        setPage(1);
                      }}
                    >
                      <option value="all">全部位置</option>
                      <option value="cabinet">仍在柜内</option>
                      <option value="history">历史归档</option>
                    </select>
                  )}
                  <select
                    aria-label="排序方式"
                    value={sort}
                    onChange={(event) => {
                      setSort(event.target.value);
                      setPage(1);
                    }}
                  >
                    <option value="">{scope === 'history' ? '完成日期' : '最近添加'}</option>
                    <option value="recent">最近添加</option>
                    <option value="completed">完成日期</option>
                    <option value="rating">评分优先</option>
                    <option value="title">标题顺序</option>
                  </select>
                  <button
                    className={`favorite-filter ${favorites ? 'selected' : ''}`}
                    aria-pressed={favorites}
                    onClick={() => {
                      setFavorites(!favorites);
                      setPage(1);
                    }}
                  >
                    <Icon name="star" size={17} />
                    只看收藏
                  </button>
                </div>
              </div>
              {!list && !error ? (
                <div className="empty-state" role="status">
                  <div className="loading-dot" />
                  <p>正在打开资料库…</p>
                </div>
              ) : list?.items.length ? (
                <div className="media-grid">
                  {list.items.map((item) => (
                    <MediaCard
                      key={item.id}
                      item={item}
                      busy={pendingIds.includes(item.id)}
                      onOpen={() =>
                        setEditor({
                          item,
                          placement: item.status === 'archived' ? 'history' : 'cabinet',
                        })
                      }
                      onFavorite={() => void toggleFavorite(item)}
                    />
                  ))}
                  {scope === 'retained' &&
                    category &&
                    activeCategory &&
                    activeCategory.remaining > 0 &&
                    Array.from({ length: Math.min(activeCategory.remaining, 6) }, (_, index) => (
                      <button
                        key={`slot-${index}`}
                        className="empty-slot"
                        onClick={() => setEditor({ placement: 'cabinet' })}
                      >
                        <Icon name="plus" size={25} />
                        <span>留一个位置</span>
                        <small>给下一部好作品</small>
                      </button>
                    ))}
                </div>
              ) : (
                list && (
                  <div className="empty-state">
                    <div className="empty-symbol">
                      <Icon name={scope === 'history' ? 'history' : 'cabinet'} size={34} />
                    </div>
                    <h3>
                      {q || status || favorites || placement !== 'all'
                        ? '没有找到这样的作品'
                        : scope === 'history'
                          ? '第一段记忆，从这里开始'
                          : scope === 'archive'
                            ? '这里还没有归档作品'
                            : '留白，也是一种选择'}
                    </h3>
                    <p>
                      {q || status || favorites
                        ? '换一个关键词，或放宽筛选条件。'
                        : scope === 'history'
                          ? '把看过、读过的作品慢慢补上，日期可以留空。'
                          : scope === 'archive'
                            ? '暂时移出收藏柜的作品，会在这里好好保存。'
                            : '添加一部你想留下的作品，让收藏从喜欢开始。'}
                    </p>
                    {scope !== 'archive' && (
                      <button
                        className="button secondary"
                        onClick={() =>
                          setEditor({ placement: scope === 'history' ? 'history' : 'cabinet' })
                        }
                      >
                        <Icon name="plus" size={16} />
                        {scope === 'history' ? '补录第一条记录' : '添加第一部作品'}
                      </button>
                    )}
                  </div>
                )
              )}
              {list && list.total > list.pageSize && (
                <div className="pagination">
                  <button
                    className="button secondary"
                    onClick={() => setPage(page - 1)}
                    disabled={page === 1}
                  >
                    上一页
                  </button>
                  <span>
                    第 {page} / {Math.ceil(list.total / list.pageSize)} 页 · {list.total} 部作品
                  </span>
                  <button
                    className="button secondary"
                    onClick={() => setPage(page + 1)}
                    disabled={page * list.pageSize >= list.total}
                  >
                    下一页
                  </button>
                </div>
              )}
            </section>
          </>
        )}
        <footer className="page-footer">
          <span>KEEP WHAT MATTERS.</span>
          <span>少一些占有，多一些珍惜。</span>
        </footer>
      </main>
      {editor && (
        <ItemForm
          existing={editor.item}
          placement={editor.placement}
          category={category}
          onClose={closeEditor}
          onSave={() => saved()}
          onReplace={setReplacement}
          onDelete={(item) => setDeletion({ item, requestId: crypto.randomUUID() })}
        />
      )}
      {replacement && (
        <ReplaceDialog
          draft={replacement}
          onClose={() => setReplacement(null)}
          onSuccess={() => saved('替换已完成，历史资料按所选方式处理。')}
        />
      )}
      {deletion && (
        <Dialog
          title="永久删除这条记录？"
          eyebrow="PLEASE CONFIRM"
          onClose={() => setDeletion(null)}
          busy={deleting}
        >
          <div className="dialog-body">
            <p>「{deletion.item.title}」将从收藏柜、归档和已看／已读清单中移除，无法撤销。</p>
            <p className="muted">如果想保留记忆，请取消并选择归档。</p>
            {error && (
              <p className="form-error" role="alert">
                {error}
              </p>
            )}
          </div>
          <footer className="dialog-footer">
            <button
              className="button secondary"
              onClick={() => setDeletion(null)}
              disabled={deleting}
            >
              取消，保留记录
            </button>
            <button className="button danger" onClick={() => void deleteItem()} disabled={deleting}>
              {deleting ? '正在删除…' : '确认永久删除'}
            </button>
          </footer>
        </Dialog>
      )}
    </div>
  );
}
