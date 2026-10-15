export const categoryIds = ['tv', 'movie', 'anime', 'documentary', 'theatre', 'comic'] as const;
export type CategoryId = (typeof categoryIds)[number];
export const categoryNames: Record<CategoryId, string> = {
  tv: '电视剧',
  movie: '电影',
  anime: '动漫',
  documentary: '纪录片',
  theatre: '话剧',
  comic: '漫画',
};
export const statuses = ['planned', 'watching', 'completed', 'dropped', 'archived'] as const;
export type Status = (typeof statuses)[number];
export type ActiveStatus = Exclude<Status, 'archived'>;
export const statusNames: Record<Status, string> = {
  planned: '想看',
  watching: '在看',
  completed: '已看完',
  dropped: '已弃看',
  archived: '已归档',
};
export function statusLabel(status: Status, category?: CategoryId): string {
  if (category === 'comic')
    return {
      planned: '想读',
      watching: '在读',
      completed: '已读完',
      dropped: '已弃读',
      archived: '已归档',
    }[status];
  return statusNames[status];
}
export interface MediaInput {
  title: string;
  category: CategoryId;
  originalTitle?: string | null;
  cover?: string | null;
  status?: Status;
  rating?: number | null;
  dateAdded?: string;
  dateCompleted?: string | null;
  notes?: string;
  favorite?: boolean;
  hasCompleted?: boolean;
  archivedFromStatus?: ActiveStatus | null;
}
export interface MediaItem {
  id: string;
  title: string;
  originalTitle: string | null;
  category: CategoryId;
  cover: string | null;
  status: Status;
  rating: number | null;
  dateAdded: string;
  dateCompleted: string | null;
  notes: string;
  favorite: boolean;
  hasCompleted: boolean;
  archivedFromStatus: ActiveStatus | null;
  createdAt: string;
  updatedAt: string;
  version: number;
}
export interface Category {
  id: CategoryId;
  name: string;
  capacity: number;
  retained: number;
  remaining: number;
  version: number;
}
export interface Summary {
  categories: Category[];
  retained: number;
  capacity: number;
  completedCount: number;
  favoriteCount: number;
}
export type Scope = 'retained' | 'history' | 'archive';
export interface ListQuery {
  scope?: Scope;
  q?: string;
  category?: CategoryId;
  status?: Status;
  favorite?: string;
  placement?: 'all' | 'cabinet' | 'history';
  sort?: 'recent' | 'completed' | 'title' | 'rating';
  page?: string;
  pageSize?: string;
}
export interface ItemPage {
  items: MediaItem[];
  total: number;
  page: number;
  pageSize: number;
}
export interface CreateRequest {
  requestId: string;
  item: MediaInput;
  placement: 'cabinet' | 'history';
}
export interface UpdateRequest {
  requestId: string;
  expectedVersion: number;
  changes: Partial<MediaInput>;
}
export interface DeleteRequest {
  requestId: string;
  expectedVersion: number;
}
export interface CapacityRequest extends DeleteRequest {
  capacity: number;
}
export type Incoming =
  | { kind: 'create'; item: MediaInput }
  | {
      kind: 'restore' | 'move';
      id: string;
      expectedVersion: number;
      changes?: Partial<MediaInput>;
    };
export interface ReplacementRequest {
  requestId: string;
  targetCategory: CategoryId;
  candidate: { id: string; expectedVersion: number };
  disposition: 'archive' | 'delete';
  incoming: Incoming;
}
export interface ApiErrorBody {
  code: string;
  message: string;
  details?: Record<string, unknown>;
}

const uuid = {
  type: 'string',
  pattern: '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$',
};
const version = { type: 'integer', minimum: 1 };
const category = { type: 'string', enum: categoryIds };
const date = { type: 'string', pattern: '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' };
export const itemProperties = {
  title: { type: 'string', minLength: 1, maxLength: 300 },
  category,
  originalTitle: { anyOf: [{ type: 'string', maxLength: 300 }, { type: 'null' }] },
  cover: { anyOf: [uuid, { type: 'null' }] },
  status: { type: 'string', enum: statuses },
  rating: {
    anyOf: [{ type: 'number', minimum: 0, maximum: 10, multipleOf: 0.5 }, { type: 'null' }],
  },
  dateAdded: date,
  dateCompleted: { anyOf: [date, { type: 'null' }] },
  notes: { type: 'string', maxLength: 10000 },
  favorite: { type: 'boolean' },
  hasCompleted: { type: 'boolean' },
  archivedFromStatus: { anyOf: [{ type: 'string', enum: statuses.slice(0, 4) }, { type: 'null' }] },
};
const object = (properties: object, required: string[] = []) => ({
  type: 'object',
  additionalProperties: false,
  properties,
  required,
});
export const itemSchema = object(itemProperties, ['title', 'category']);
export const changesSchema = { ...object(itemProperties), minProperties: 1 };
export const deleteSchema = object({ requestId: uuid, expectedVersion: version }, [
  'requestId',
  'expectedVersion',
]);
export const createSchema = object(
  {
    requestId: uuid,
    item: itemSchema,
    placement: { type: 'string', enum: ['cabinet', 'history'] },
  },
  ['requestId', 'item', 'placement'],
);
export const updateSchema = object(
  { requestId: uuid, expectedVersion: version, changes: changesSchema },
  ['requestId', 'expectedVersion', 'changes'],
);
export const capacitySchema = object(
  {
    requestId: uuid,
    expectedVersion: version,
    capacity: { type: 'integer', minimum: 0, maximum: 100000 },
  },
  ['requestId', 'expectedVersion', 'capacity'],
);
export const replacementSchema = object(
  {
    requestId: uuid,
    targetCategory: category,
    candidate: object({ id: uuid, expectedVersion: version }, ['id', 'expectedVersion']),
    disposition: { type: 'string', enum: ['archive', 'delete'] },
    incoming: {
      oneOf: [
        object({ kind: { const: 'create' }, item: itemSchema }, ['kind', 'item']),
        object(
          {
            kind: { type: 'string', enum: ['restore', 'move'] },
            id: uuid,
            expectedVersion: version,
            changes: changesSchema,
          },
          ['kind', 'id', 'expectedVersion'],
        ),
      ],
    },
  },
  ['requestId', 'targetCategory', 'candidate', 'disposition', 'incoming'],
);
export const idParamsSchema = object({ id: uuid }, ['id']);
export const categoryParamsSchema = object({ id: category }, ['id']);
export const listSchema = object({
  scope: { type: 'string', enum: ['retained', 'history', 'archive'] },
  q: { type: 'string', maxLength: 300 },
  category,
  status: { type: 'string', enum: statuses },
  favorite: { type: 'string', enum: ['true', 'false'] },
  placement: { type: 'string', enum: ['all', 'cabinet', 'history'] },
  sort: { type: 'string', enum: ['recent', 'completed', 'title', 'rating'] },
  page: { type: 'string', pattern: '^[1-9][0-9]{0,6}$' },
  pageSize: { type: 'string', pattern: '^([1-9]|[1-4][0-9]|50)$' },
});
