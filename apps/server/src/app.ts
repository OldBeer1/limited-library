import Fastify from 'fastify';
import type { FastifyError } from 'fastify';
import multipart from '@fastify/multipart';
import staticFiles from '@fastify/static';
import { randomBytes, timingSafeEqual } from 'node:crypto';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import {
  createSchema,
  updateSchema,
  deleteSchema,
  capacitySchema,
  replacementSchema,
  idParamsSchema,
  categoryParamsSchema,
  listSchema,
} from '@limited-library/contracts';
import type {
  CreateRequest,
  UpdateRequest,
  DeleteRequest,
  CapacityRequest,
  ReplacementRequest,
  CategoryId,
  ListQuery,
} from '@limited-library/contracts';
import { acquireDataLock, projectRoot } from './config.js';
import type { AppConfig } from './config.js';
import { openDatabase, closeDatabase } from './db/database.js';
import { LibraryService } from './services/library.js';
import { AppError, invalid, mapDatabaseError } from './services/errors.js';
import { importCover, MAX_IMAGE_BYTES, readCover } from './services/assets.js';
export async function createApp(config: AppConfig, serveWeb = false) {
  const release = acquireDataLock(config.dataDir, 'server');
  let db;
  try {
    db = openDatabase(config.dataDir, config.allowCreate);
  } catch (error) {
    release();
    throw error;
  }
  const service = new LibraryService(db);
  const app = Fastify({
    logger: false,
    bodyLimit: 65536,
    ajv: { customOptions: { removeAdditional: false, coerceTypes: false } },
  });
  const token = randomBytes(32).toString('hex');
  const authorities = new Set([`127.0.0.1:${config.port}`]);
  if (config.mode === 'development') authorities.add(`127.0.0.1:${config.webPort ?? 43128}`);
  app.addHook('onRequest', async (request, reply) => {
    reply.header('X-Content-Type-Options', 'nosniff').header('Referrer-Policy', 'no-referrer');
    if (!authorities.has(request.headers.host ?? ''))
      throw new AppError('LOCAL_REQUEST_REJECTED', 403, '本地访问地址不受信任。');
    if (request.url.startsWith('/api')) reply.header('Cache-Control', 'no-store');
    if (['POST', 'PATCH', 'DELETE', 'PUT'].includes(request.method)) {
      const supplied = request.headers['x-csrf-token'];
      const origin = request.headers.origin;
      const expectedOrigin = `http://${request.headers.host}`;
      if (
        origin !== expectedOrigin ||
        typeof supplied !== 'string' ||
        Buffer.byteLength(supplied) !== Buffer.byteLength(token) ||
        !timingSafeEqual(Buffer.from(supplied), Buffer.from(token))
      )
        throw new AppError('LOCAL_REQUEST_REJECTED', 403, '本次本地会话已失效，请刷新页面后重试。');
      const type = request.headers['content-type'] ?? '';
      if (
        request.url === '/api/assets'
          ? !type.startsWith('multipart/form-data;')
          : !/^application\/json(?:\s*;|$)/i.test(type)
      )
        throw new AppError('LOCAL_REQUEST_REJECTED', 403, '写入请求格式不正确。');
    }
  });
  app.setErrorHandler<FastifyError>((error, _request, reply) => {
    const result = error.validation
      ? new AppError('VALIDATION_ERROR', 400, '输入格式不正确，请检查必填项、日期与数值。', {
          fields: error.validation.map((e) => e.instancePath),
        })
      : error.code === 'FST_REQ_FILE_TOO_LARGE'
        ? new AppError('ASSET_TOO_LARGE', 413, '封面不能超过 5 MiB。')
        : error.statusCode === 413
          ? new AppError('ASSET_TOO_LARGE', 413, '请求内容太大。')
          : error.statusCode === 400
            ? new AppError('VALIDATION_ERROR', 400, '请求格式不正确。')
            : error.statusCode === 403
              ? new AppError('LOCAL_REQUEST_REJECTED', 403, '请求路径不允许访问。')
              : error.statusCode === 404
                ? new AppError('NOT_FOUND', 404, '请求内容不存在。')
                : mapDatabaseError(error);
    reply
      .code(result.status)
      .send({
        code: result.code,
        message: result.message,
        ...(result.details ? { details: result.details } : {}),
      });
  });
  app.addHook('onClose', async () => {
    try {
      closeDatabase(db);
    } finally {
      release();
    }
  });
  try {
    await app.register(multipart, {
      limits: { fileSize: MAX_IMAGE_BYTES, files: 1, fields: 0, parts: 1 },
    });
    app.get('/api/health', async () => ({ status: 'ok', schemaVersion: 1 }));
    app.get('/api/session', async () => ({ token }));
    app.get('/api/summary', async () => service.repo.summary());
    app.get('/api/categories', async () => service.repo.categories());
    app.get<{ Querystring: ListQuery }>(
      '/api/items',
      { schema: { querystring: listSchema } },
      async (request) => {
        const query = request.query;
        if (query.scope !== 'history' && query.placement && query.placement !== 'all')
          invalid('位置筛选只适用于已看／已读清单。');
        return service.repo.list(query);
      },
    );
    app.get<{ Params: { id: string } }>(
      '/api/items/:id',
      { schema: { params: idParamsSchema } },
      async (request) => service.get(request.params.id),
    );
    app.post<{ Body: CreateRequest }>(
      '/api/items',
      { schema: { body: createSchema } },
      async (request, reply) => reply.code(201).send(service.create(request.body)),
    );
    app.patch<{ Params: { id: string }; Body: UpdateRequest }>(
      '/api/items/:id',
      { schema: { params: idParamsSchema, body: updateSchema } },
      async (request) => service.update(request.params.id, request.body),
    );
    app.delete<{ Params: { id: string }; Body: DeleteRequest }>(
      '/api/items/:id',
      { schema: { params: idParamsSchema, body: deleteSchema } },
      async (request) => service.delete(request.params.id, request.body),
    );
    app.patch<{ Params: { id: CategoryId }; Body: CapacityRequest }>(
      '/api/categories/:id',
      { schema: { params: categoryParamsSchema, body: capacitySchema } },
      async (request) => service.capacity(request.params.id, request.body),
    );
    app.post<{ Body: ReplacementRequest }>(
      '/api/replacements',
      { schema: { body: replacementSchema } },
      async (request) => service.replace(request.body),
    );
    app.post('/api/assets', { bodyLimit: MAX_IMAGE_BYTES + 4096 }, async (request) => {
      const file = await request.file();
      if (!file) invalid('请选择一张封面图片。');
      const buffer = await file.toBuffer();
      if (file.file.truncated) throw new AppError('ASSET_TOO_LARGE', 413, '封面不能超过 5 MiB。');
      return importCover(db, config.dataDir, buffer, file.mimetype);
    });
    app.get<{ Params: { id: string } }>(
      '/api/assets/:id',
      { schema: { params: idParamsSchema } },
      async (request, reply) => {
        const cover = await readCover(db, config.dataDir, request.params.id);
        return reply
          .type(cover.mime)
          .header('Cache-Control', 'private, max-age=3600')
          .send(cover.bytes);
      },
    );
    if (serveWeb) {
      const root = join(projectRoot, 'apps/web/dist');
      if (!existsSync(join(root, 'index.html')))
        throw new Error('未找到网页构建，请先运行 npm run build。');
      await app.register(staticFiles, { root, index: ['index.html'] });
      app.setNotFoundHandler(async (request, reply) => {
        if (
          request.url.startsWith('/api/') ||
          request.method !== 'GET' ||
          !request.headers.accept?.includes('text/html')
        )
          return reply.code(404).send({ code: 'NOT_FOUND', message: '页面不存在。' });
        return reply.type('text/html').sendFile('index.html', { maxAge: 0 });
      });
    }
    await app.ready();
    return { app, db, service };
  } catch (error) {
    await app.close();
    throw error;
  }
}
