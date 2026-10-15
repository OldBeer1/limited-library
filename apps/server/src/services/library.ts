import { createHash, randomUUID } from 'node:crypto';
import type Database from 'better-sqlite3';
import type {
  CapacityRequest,
  CategoryId,
  CreateRequest,
  DeleteRequest,
  MediaInput,
  MediaItem,
  ReplacementRequest,
  UpdateRequest,
} from '@limited-library/contracts';
import { LibraryRepository } from '../repositories/library.js';
import { AppError, invalid, mapDatabaseError } from './errors.js';
function canonical(value: unknown): string {
  if (Array.isArray(value)) return '[' + value.map(canonical).join(',') + ']';
  if (value && typeof value === 'object')
    return (
      '{' +
      Object.entries(value)
        .filter(([, v]) => v !== undefined)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([k, v]) => JSON.stringify(k) + ':' + canonical(v))
        .join(',') +
      '}'
    );
  return JSON.stringify(value);
}
export function calendarDate(value: string): boolean {
  if (!/^[0-9]{4}-[0-9]{2}-[0-9]{2}$/.test(value) || value.startsWith('0000')) return false;
  const date = new Date(value + 'T00:00:00.000Z');
  return Number.isFinite(date.valueOf()) && date.toISOString().slice(0, 10) === value;
}
function today(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
}
export function normalize(input: Partial<MediaInput>, existing?: MediaItem): MediaItem {
  const now = new Date().toISOString();
  const item: MediaItem = {
    id: randomUUID(),
    title: '',
    originalTitle: null,
    category: 'movie',
    cover: null,
    status: 'planned',
    rating: null,
    dateAdded: today(),
    dateCompleted: null,
    notes: '',
    favorite: false,
    hasCompleted: false,
    archivedFromStatus: null,
    createdAt: now,
    version: 1,
    ...existing,
    ...input,
    updatedAt: now,
  };
  item.title = item.title.trim();
  item.originalTitle = item.originalTitle?.trim() || null;
  if (!item.title || item.title.length > 300) invalid('请填写 1–300 字的标题。');
  if (
    !calendarDate(item.dateAdded) ||
    (item.dateCompleted !== null && !calendarDate(item.dateCompleted))
  )
    invalid('日期不是有效的 YYYY-MM-DD 日历日期。');
  if (item.status === 'archived')
    item.archivedFromStatus =
      input.archivedFromStatus ??
      (existing?.status === 'archived'
        ? existing.archivedFromStatus
        : (existing?.status ?? 'planned'));
  else item.archivedFromStatus = null;
  const requiresCompleted =
    item.status === 'completed' ||
    item.archivedFromStatus === 'completed' ||
    item.dateCompleted !== null;
  if (requiresCompleted && input.hasCompleted === false)
    invalid('取消曾完成标记时，请同时修正完成状态和日期。');
  if (requiresCompleted) item.hasCompleted = true;
  if (!item.hasCompleted && item.dateCompleted !== null) invalid('未完成作品不能填写完成日期。');
  return item;
}
export class LibraryService {
  repo: LibraryRepository;
  constructor(public db: Database.Database) {
    this.repo = new LibraryRepository(db);
  }
  get(id: string): MediaItem {
    const item = this.repo.item(id);
    if (!item) throw new AppError('ITEM_NOT_FOUND', 404, '作品不存在，请刷新列表。');
    return item;
  }
  private version(item: { version: number }, expected: number): void {
    if (item.version !== expected)
      throw new AppError('VERSION_CONFLICT', 409, '此记录已在其他页面修改，请重新加载后比较。', {
        currentVersion: item.version,
      });
  }
  private space(category: CategoryId): void {
    const state = this.repo.category(category);
    if (!state.capacity)
      throw new AppError('CATEGORY_DISABLED', 409, '此分类容量为 0，请先在设置中调整。', {
        category,
      });
    if (state.retained >= state.capacity)
      throw new AppError('CATEGORY_FULL', 409, '收藏柜已满，请选择同分类作品替换。', {
        category,
        retained: state.retained,
        capacity: state.capacity,
      });
  }
  private mutation<T>(requestId: string, operation: string, payload: unknown, work: () => T): T {
    const payloadHash = createHash('sha256')
      .update(canonical({ operation, payload }))
      .digest('hex');
    try {
      return this.db
        .transaction(() => {
          const prior = this.db
            .prepare('SELECT payload_hash,result_json FROM mutation_requests WHERE request_id=?')
            .get(requestId) as { payload_hash: string; result_json: string } | undefined;
          if (prior) {
            if (prior.payload_hash !== payloadHash)
              throw new AppError(
                'REQUEST_ID_CONFLICT',
                409,
                '这个请求编号已用于不同操作，请重新提交。',
              );
            return JSON.parse(prior.result_json) as T;
          }
          const result = work();
          if (this.repo.categories().some((c) => c.remaining < 0))
            throw new AppError('STORAGE_FAILURE', 500, '容量检查失败，操作已回滚。');
          this.db
            .prepare(
              'INSERT INTO mutation_requests(request_id,operation,payload_hash,result_json) VALUES (?,?,?,?)',
            )
            .run(requestId, operation, payloadHash, JSON.stringify(result));
          return result;
        })
        .immediate();
    } catch (error) {
      throw mapDatabaseError(error);
    }
  }
  create(body: CreateRequest): MediaItem {
    // Normalize field defaults before hashing, but exclude generated identity/time.
    const defaults = {
      originalTitle: null,
      cover: null,
      status: 'planned',
      rating: null,
      notes: '',
      favorite: false,
      hasCompleted: false,
      dateCompleted: null,
      ...body.item,
    };
    return this.mutation(
      body.requestId,
      'item.create',
      { placement: body.placement, item: defaults },
      () => {
        if (body.placement === 'cabinet' && body.item.status === 'archived')
          invalid('柜内新增不能使用归档状态，请使用历史补录。');
        const item = normalize(
          body.placement === 'history'
            ? {
                ...body.item,
                status: 'archived',
                archivedFromStatus: 'completed',
                hasCompleted: true,
              }
            : body.item,
        );
        if (item.status !== 'archived') this.space(item.category);
        this.repo.insert(item);
        return this.get(item.id);
      },
    );
  }
  update(id: string, body: UpdateRequest): MediaItem {
    return this.mutation(
      body.requestId,
      'item.update',
      { id, expectedVersion: body.expectedVersion, changes: body.changes },
      () => {
        const prior = this.get(id);
        this.version(prior, body.expectedVersion);
        const next = normalize(body.changes, prior);
        if (
          next.status !== 'archived' &&
          (prior.status === 'archived' || prior.category !== next.category)
        )
          this.space(next.category);
        this.repo.update(next, prior.version);
        return this.get(id);
      },
    );
  }
  delete(id: string, body: DeleteRequest): { deleted: string } {
    return this.mutation(
      body.requestId,
      'item.delete',
      { id, expectedVersion: body.expectedVersion },
      () => {
        const item = this.get(id);
        this.version(item, body.expectedVersion);
        const result = this.db
          .prepare('DELETE FROM media_items WHERE id=? AND version=?')
          .run(id, body.expectedVersion);
        if (result.changes !== 1) throw new AppError('VERSION_CONFLICT', 409, '记录已发生变化。');
        return { deleted: id };
      },
    );
  }
  capacity(id: CategoryId, body: CapacityRequest) {
    return this.mutation(
      body.requestId,
      'category.update',
      { id, expectedVersion: body.expectedVersion, capacity: body.capacity },
      () => {
        const category = this.repo.category(id);
        this.version(category, body.expectedVersion);
        if (body.capacity < category.retained)
          throw new AppError(
            'CAPACITY_TOO_SMALL',
            409,
            `此类保留了 ${category.retained} 部作品，请先整理后再缩小容量。`,
            { retained: category.retained },
          );
        this.db
          .prepare(
            'UPDATE categories SET capacity=?,version=version+1,updated_at=? WHERE id=? AND version=?',
          )
          .run(body.capacity, new Date().toISOString(), id, body.expectedVersion);
        return this.repo.category(id);
      },
    );
  }
  replace(body: ReplacementRequest): MediaItem {
    return this.mutation(body.requestId, 'replacement', body, () => {
      const target = this.repo.category(body.targetCategory);
      if (!target.capacity)
        throw new AppError('CATEGORY_DISABLED', 409, '分类容量为 0，请先修改设置。');
      if (target.retained < target.capacity)
        throw new AppError('INVALID_REPLACEMENT', 409, '分类已有空位，请返回表单直接保存。');
      const candidate = this.get(body.candidate.id);
      this.version(candidate, body.candidate.expectedVersion);
      if (candidate.category !== body.targetCategory || candidate.status === 'archived')
        throw new AppError('INVALID_REPLACEMENT', 409, '候选必须是目标分类中仍在柜内的作品。');
      let item: MediaItem;
      const incoming = body.incoming;
      if (incoming.kind === 'create') {
        if (incoming.item.category !== body.targetCategory || incoming.item.status === 'archived')
          invalid('新作品必须加入所选目标分类。');
        item = normalize(incoming.item);
      } else {
        const old = this.get(incoming.id);
        this.version(old, incoming.expectedVersion);
        if (
          old.id === candidate.id ||
          (incoming.kind === 'restore'
            ? old.status !== 'archived'
            : old.status === 'archived' || old.category === body.targetCategory)
        )
          throw new AppError(
            'INVALID_REPLACEMENT',
            409,
            '恢复／转入作品或候选已经变化，请重新选择。',
          );
        item = normalize(
          {
            ...incoming.changes,
            category: body.targetCategory,
            status:
              incoming.changes?.status ??
              (old.status === 'archived' ? old.archivedFromStatus! : old.status),
          },
          old,
        );
        if (item.status === 'archived') invalid('替换目标必须放入收藏柜。');
      }
      if (body.disposition === 'archive')
        this.repo.update(normalize({ status: 'archived' }, candidate), candidate.version);
      else
        this.db
          .prepare('DELETE FROM media_items WHERE id=? AND version=?')
          .run(candidate.id, candidate.version);
      if (incoming.kind === 'create') this.repo.insert(item);
      else this.repo.update(item, incoming.expectedVersion);
      return this.get(item.id);
    });
  }
}
