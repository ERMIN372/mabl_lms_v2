/**
 * Серверный клиент ЮKassa (https://yookassa.ru/developers).
 *
 * Секреты живут ТОЛЬКО на сервере (переменные окружения Vercel) и никогда не
 * попадают во фронтенд. Если ключи не заданы, эндпоинты платежей отвечают 503:
 * оплатить программу нельзя, остальной сайт продолжает работать.
 *
 * Переменные окружения:
 *   YOOKASSA_SHOP_ID      — идентификатор магазина (shopId)
 *   YOOKASSA_SECRET_KEY   — секретный ключ (Basic-auth пара к shopId)
 *   YOOKASSA_RETURN_URL   — (опц.) базовый URL для возврата после оплаты
 */

const API_BASE = 'https://api.yookassa.ru/v3'

export interface YooKassaAmount {
  value: string
  currency: string
}

export interface YooKassaPayment {
  id: string
  status: 'pending' | 'waiting_for_capture' | 'succeeded' | 'canceled'
  paid: boolean
  amount: YooKassaAmount
  confirmation?: { type: string; confirmation_url?: string }
  metadata?: Record<string, string>
  description?: string
}

/** Настроена ли интеграция (заданы ли оба ключа). */
export function isYooKassaConfigured(): boolean {
  return Boolean(process.env.YOOKASSA_SHOP_ID && process.env.YOOKASSA_SECRET_KEY)
}

function authHeader(): string {
  const shopId = process.env.YOOKASSA_SHOP_ID || ''
  const secret = process.env.YOOKASSA_SECRET_KEY || ''
  return 'Basic ' + Buffer.from(`${shopId}:${secret}`).toString('base64')
}

/** Сумма в рублях (целое или дробное) → формат ЮKassa "1234.00". */
export function toAmountValue(rub: number): string {
  return (Math.round(rub * 100) / 100).toFixed(2)
}

export interface CreatePaymentParams {
  amount: number
  currency?: string
  description: string
  returnUrl: string
  /** Произвольные данные, вернутся в webhook (courseId, orderId, email…). */
  metadata?: Record<string, string>
  /** Ключ идемпотентности — защищает от двойного списания при ретраях. */
  idempotenceKey: string
  /** E-mail для чека (54-ФЗ), если на магазине включена онлайн-касса. */
  receiptEmail?: string
}

/** Создать платёж и получить ссылку на платёжную форму ЮKassa. */
export async function createPayment(params: CreatePaymentParams): Promise<YooKassaPayment> {
  const body: Record<string, unknown> = {
    amount: { value: toAmountValue(params.amount), currency: params.currency || 'RUB' },
    capture: true,
    confirmation: { type: 'redirect', return_url: params.returnUrl },
    description: params.description,
    metadata: params.metadata || {},
  }

  // Чек 54-ФЗ отправляем только если задан e-mail (иначе оставляем на стороне магазина).
  if (params.receiptEmail) {
    body.receipt = {
      customer: { email: params.receiptEmail },
      items: [
        {
          description: params.description.slice(0, 128),
          quantity: '1.00',
          amount: { value: toAmountValue(params.amount), currency: params.currency || 'RUB' },
          vat_code: 1,
          payment_mode: 'full_payment',
          payment_subject: 'service',
        },
      ],
    }
  }

  const res = await fetch(`${API_BASE}/payments`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Idempotence-Key': params.idempotenceKey,
      Authorization: authHeader(),
    },
    body: JSON.stringify(body),
  })

  const json = (await res.json()) as YooKassaPayment & { description?: string }
  if (!res.ok) {
    const msg = (json as { description?: string }).description || `Ошибка ЮKassa (${res.status})`
    throw new Error(msg)
  }
  return json
}

/** Получить актуальный статус платежа по id (используется в webhook и на возврате). */
export async function getPayment(id: string): Promise<YooKassaPayment> {
  const res = await fetch(`${API_BASE}/payments/${id}`, {
    headers: { Authorization: authHeader() },
  })
  const json = (await res.json()) as YooKassaPayment
  if (!res.ok) {
    const msg = (json as { description?: string }).description || `Ошибка ЮKassa (${res.status})`
    throw new Error(msg)
  }
  return json
}
