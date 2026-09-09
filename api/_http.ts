import type { IncomingMessage, ServerResponse } from 'node:http'

/**
 * Типы запроса/ответа API.
 *
 * Раньше здесь были `VercelRequest`/`VercelResponse` из `@vercel/node`. После
 * переезда на собственный сервер (Express на VM Yandex Cloud) обработчики
 * получают обычные объекты Express, у которых тот же набор помощников
 * (`status`, `json`, `send`, `redirect`, `req.query`, `req.body`). Поэтому
 * описываем минимальный контракт сами и ни от чего не зависим.
 */

export interface ApiRequest extends IncomingMessage {
  /** Разобранная строка запроса (`?path=...`). */
  query: Record<string, string | string[] | undefined>
  /** Тело запроса: JSON-объект, строка или Buffer (для загрузки файлов). */
  body?: unknown
}

export interface ApiResponse extends ServerResponse {
  status(code: number): ApiResponse
  json(body: unknown): ApiResponse
  send(body: unknown): ApiResponse
  redirect(status: number, url: string): void
}
