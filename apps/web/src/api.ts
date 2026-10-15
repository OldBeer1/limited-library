import type { ApiErrorBody } from '@limited-library/contracts';
export class ApiError extends Error {
  constructor(
    public code: string,
    message: string,
    public details?: Record<string, unknown>,
  ) {
    super(message);
  }
}
let token: string | undefined;
async function decode<T>(response: Response): Promise<T> {
  if (!response.ok) {
    const error = (await response
      .json()
      .catch(() => ({
        code: 'NETWORK_ERROR',
        message: '服务未响应，请确认应用仍在运行。',
      }))) as ApiErrorBody;
    if (error.code === 'LOCAL_REQUEST_REJECTED') token = undefined;
    throw new ApiError(error.code, error.message, error.details);
  }
  return response.json() as Promise<T>;
}
export async function get<T>(path: string): Promise<T> {
  try {
    return await decode<T>(await fetch(path, { cache: 'no-store' }));
  } catch (error) {
    if (error instanceof ApiError) throw error;
    throw new ApiError('NETWORK_ERROR', '连接中断，输入仍保留。请确认应用正在运行后重试。');
  }
}
async function session(): Promise<string> {
  if (!token) token = (await get<{ token: string }>('/api/session')).token;
  return token;
}
export async function write<T>(
  path: string,
  method: 'POST' | 'PATCH' | 'DELETE',
  body: object,
): Promise<T> {
  const options = {
    method,
    headers: { 'Content-Type': 'application/json', 'x-csrf-token': await session() },
    body: JSON.stringify(body),
  };
  // A lost response may be retried once with the exact same UUID and payload.
  let response: Response;
  try {
    response = await fetch(path, options);
  } catch {
    try {
      response = await fetch(path, options);
    } catch {
      throw new ApiError('NETWORK_ERROR', '连接中断，输入仍保留。再次保存会重试相同请求。');
    }
  }
  return decode<T>(response);
}
export async function upload(file: File): Promise<string> {
  if (file.size > 5 * 1024 * 1024) throw new ApiError('ASSET_TOO_LARGE', '封面不能超过 5 MiB。');
  const form = new FormData();
  form.append('file', file);
  const response = await fetch('/api/assets', {
    method: 'POST',
    headers: { 'x-csrf-token': await session() },
    body: form,
  });
  return (await decode<{ assetId: string }>(response)).assetId;
}
export function message(error: unknown): string {
  return error instanceof TypeError
    ? '连接中断，输入仍保留。请稍后重试。'
    : error instanceof Error
      ? error.message
      : '操作失败，请稍后重试。';
}
