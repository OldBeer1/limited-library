export class AppError extends Error {
  constructor(
    public code: string,
    public status: number,
    message: string,
    public details?: Record<string, unknown>,
  ) {
    super(message);
  }
}
export function invalid(message: string): never {
  throw new AppError('VALIDATION_ERROR', 400, message);
}
export function mapDatabaseError(error: unknown): AppError {
  if (error instanceof AppError) return error;
  const message = error instanceof Error ? error.message : '';
  if (message.includes('CATEGORY_FULL'))
    return new AppError('CATEGORY_FULL', 409, '收藏柜已满，请选择替换作品。');
  if (message.includes('CAPACITY_TOO_SMALL'))
    return new AppError('CAPACITY_TOO_SMALL', 409, '容量不能小于当前保留数，请先归档作品。');
  if (message.includes('SQLITE_BUSY') || message.includes('database is locked'))
    return new AppError('DATABASE_BUSY', 503, '数据正在写入，请稍后重试。');
  if (message.includes('FOREIGN KEY') || message.includes('CHECK constraint'))
    return new AppError('VALIDATION_ERROR', 400, '作品字段或封面引用无效。');
  return new AppError('STORAGE_FAILURE', 500, '保存失败，请保留输入并检查本地存储。');
}
