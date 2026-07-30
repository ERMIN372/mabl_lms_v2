import { http } from './config'

/**
 * Ресурс «Платежи» — боевая оплата ЮKassa.
 *
 * Секретов на фронте нет: платёж создаётся на сервере
 * (POST /api/payments/create) по авторизованному запросу, оттуда приходит
 * ссылка на платёжную форму, куда уводится пользователь. После оплаты ЮKassa
 * возвращает его на /checkout?course=…&order=<id>, где статус подтверждается
 * по GET /api/payments/by-order/<id> (плюс серверный webhook).
 */

export interface PaymentIntent {
  itemId: string
  itemTitle: string
  amount: number
  currency: 'RUB'
  /** E-mail для кассового чека. */
  customerEmail?: string
}

export interface PaymentResult {
  /** redirect — браузер уводится на платёжную форму ЮKassa. */
  status: 'redirect' | 'failed'
  /** Номер заказа (при status === 'redirect'). */
  orderId: string
  message: string
  confirmationUrl?: string
}

export interface PaymentConfig {
  provider: string
  configured: boolean
}

export interface OrderPaymentStatus {
  orderId: string
  status: 'paid' | 'pending' | 'refunded'
  paid: boolean
  courseId?: string
}

export const paymentsApi = {
  /** Доступна ли боевая оплата (заданы ли ключи ЮKassa на сервере). */
  async config(): Promise<PaymentConfig> {
    return http<PaymentConfig>('/payments/config')
  },

  /** Создать заказ и уйти на платёжную форму ЮKassa. */
  async pay(intent: PaymentIntent): Promise<PaymentResult> {
    try {
      const data = await http<{ confirmationUrl?: string; orderId?: string }>('/payments/create', {
        method: 'POST',
        body: JSON.stringify({ courseId: intent.itemId, email: intent.customerEmail }),
      })
      if (!data.confirmationUrl) {
        return { status: 'failed', orderId: '', message: 'ЮKassa не вернула ссылку на оплату.' }
      }
      window.location.assign(data.confirmationUrl)
      return {
        status: 'redirect',
        orderId: data.orderId ?? '',
        confirmationUrl: data.confirmationUrl,
        message: 'Переадресация на платёжную форму ЮKassa…',
      }
    } catch (err) {
      return {
        status: 'failed',
        orderId: '',
        message: err instanceof Error ? err.message : 'Не удалось создать платёж. Попробуйте позже.',
      }
    }
  },

  /** Статус заказа после возврата с платёжной формы. */
  async statusByOrder(orderId: string): Promise<OrderPaymentStatus> {
    return http<OrderPaymentStatus>(`/payments/by-order/${encodeURIComponent(orderId)}`)
  },
}
