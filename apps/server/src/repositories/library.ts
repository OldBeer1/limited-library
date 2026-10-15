import type Database from 'better-sqlite3';
import type {
  Category,
  CategoryId,
  ItemPage,
  ListQuery,
  MediaItem,
  Summary,
} from '@limited-library/contracts';
interface ItemRow {
  id: string;
  title: string;
  original_title: string | null;
  category_id: MediaItem['category'];
  cover_asset_id: string | null;
  status: MediaItem['status'];
  rating: number | null;
  date_added: string;
  date_completed: string | null;
  notes: string;
  favorite: number;
  has_completed: number;
  archived_from_status: MediaItem['archivedFromStatus'];
  created_at: string;
  updated_at: string;
  version: number;
}
export function itemDto(row: ItemRow): MediaItem {
  return {
    id: row.id,
    title: row.title,
    originalTitle: row.original_title,
    category: row.category_id,
    cover: row.cover_asset_id,
    status: row.status,
    rating: row.rating,
    dateAdded: row.date_added,
    dateCompleted: row.date_completed,
    notes: row.notes,
    favorite: !!row.favorite,
    hasCompleted: !!row.has_completed,
    archivedFromStatus: row.archived_from_status,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    version: row.version,
  };
}
export class LibraryRepository {
  constructor(public db: Database.Database) {}
  item(id: string): MediaItem | undefined {
    const row = this.db.prepare('SELECT * FROM media_items WHERE id=?').get(id) as
      ItemRow | undefined;
    return row ? itemDto(row) : undefined;
  }
  categories(): Category[] {
    return this.db
      .prepare(
        'SELECT c.id,c.name,c.capacity,c.version,s.retained,s.remaining FROM categories c JOIN v_category_summary s ON s.category_id=c.id ORDER BY c.sort_order',
      )
      .all() as Category[];
  }
  category(id: CategoryId): Category {
    return this.categories().find((c) => c.id === id)!;
  }
  summary(): Summary {
    const categories = this.categories();
    return {
      categories,
      retained: categories.reduce((n, c) => n + c.retained, 0),
      capacity: categories.reduce((n, c) => n + c.capacity, 0),
      completedCount: (
        this.db.prepare('SELECT count(*) AS n FROM media_items WHERE has_completed=1').get() as {
          n: number;
        }
      ).n,
      favoriteCount: (
        this.db.prepare('SELECT count(*) AS n FROM media_items WHERE favorite=1').get() as {
          n: number;
        }
      ).n,
    };
  }
  list(query: ListQuery): ItemPage {
    const scope = query.scope ?? 'retained';
    const where = [
      scope === 'history'
        ? 'has_completed=1'
        : scope === 'archive'
          ? "status='archived'"
          : "status<>'archived'",
    ];
    const params: (string | number)[] = [];
    if (query.category) {
      where.push('category_id=?');
      params.push(query.category);
    }
    if (query.status) {
      where.push('status=?');
      params.push(query.status);
    }
    if (query.favorite) {
      where.push('favorite=?');
      params.push(query.favorite === 'true' ? 1 : 0);
    }
    if (scope === 'history' && query.placement && query.placement !== 'all')
      where.push(query.placement === 'cabinet' ? "status<>'archived'" : "status='archived'");
    if (query.q?.trim()) {
      const search = '%' + query.q.trim().replace(/[\\%_]/g, '\\$&') + '%';
      where.push("(title LIKE ? ESCAPE '\\' OR original_title LIKE ? ESCAPE '\\')");
      params.push(search, search);
    }
    const clause = where.join(' AND ');
    const total = (
      this.db.prepare(`SELECT count(*) AS n FROM media_items WHERE ${clause}`).get(...params) as {
        n: number;
      }
    ).n;
    const page = Number(query.page ?? 1),
      pageSize = Number(query.pageSize ?? 24);
    const orders = {
      recent: 'created_at DESC, id',
      completed: 'date_completed IS NULL, date_completed DESC, created_at DESC, id',
      title: 'title COLLATE NOCASE, id',
      rating: 'rating IS NULL, rating DESC, created_at DESC, id',
    };
    const order = orders[query.sort ?? (scope === 'history' ? 'completed' : 'recent')];
    const rows = this.db
      .prepare(`SELECT * FROM media_items WHERE ${clause} ORDER BY ${order} LIMIT ? OFFSET ?`)
      .all(...params, pageSize, (page - 1) * pageSize) as ItemRow[];
    return { items: rows.map(itemDto), total, page, pageSize };
  }
  insert(item: MediaItem): void {
    this.db
      .prepare(
        `INSERT INTO media_items(id,title,original_title,category_id,cover_asset_id,status,rating,date_added,date_completed,notes,favorite,has_completed,archived_from_status,created_at,updated_at,version)
      VALUES (@id,@title,@originalTitle,@category,@cover,@status,@rating,@dateAdded,@dateCompleted,@notes,@favorite,@hasCompleted,@archivedFromStatus,@createdAt,@updatedAt,@version)`,
      )
      .run({ ...item, favorite: +item.favorite, hasCompleted: +item.hasCompleted });
  }
  update(item: MediaItem, expectedVersion: number): void {
    const result = this.db
      .prepare(
        `UPDATE media_items SET title=@title, original_title=@originalTitle, category_id=@category, cover_asset_id=@cover,
      status=@status,rating=@rating,date_added=@dateAdded,date_completed=@dateCompleted,notes=@notes,favorite=@favorite,has_completed=@hasCompleted,
      archived_from_status=@archivedFromStatus,updated_at=@updatedAt,version=version+1 WHERE id=@id AND version=@expectedVersion`,
      )
      .run({
        ...item,
        favorite: +item.favorite,
        hasCompleted: +item.hasCompleted,
        expectedVersion,
      });
    if (result.changes !== 1) throw new Error('Unexpected version changed inside transaction');
  }
}
