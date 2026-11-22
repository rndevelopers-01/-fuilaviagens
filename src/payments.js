import { createHmac, timingSafeEqual } from "node:crypto";
import { isPiiEncryptionReady } from "./security.js";

const apiBase = "https://api.mercadopago.com";

export function paymentConfiguration() {
  const publicUrl = process.env.PUBLIC_APP_URL?.trim();
  let validPublicUrl = false;
  try {
    validPublicUrl = new URL(publicUrl).protocol === "https:";
  } catch {
    validPublicUrl = false;
  }
  return {
    mercadoPago: Boolean(process.env.MERCADOPAGO_ACCESS_TOKEN),
    webhook: Boolean(process.env.MERCADOPAGO_WEBHOOK_SECRET),
    publicUrl: validPublicUrl,
    resend: Boolean(process.env.RESEND_API_KEY && process.env.RESEND_FROM_EMAIL),
    staff: Boolean(process.env.STAFF_EMAIL && process.env.STAFF_PASSWORD),
    piiEncryption: isPiiEncryptionReady(),
  };
}

function publicOrigin() {
  const value = process.env.PUBLIC_APP_URL?.trim();
  if (!value) throw new Error("PUBLIC_APP_URL não está configurado.");
  const url = new URL(value);
  if (url.protocol !== "https:" || url.username || url.password) {
    throw new Error("PUBLIC_APP_URL precisa ser um endereço HTTPS válido.");
  }
  return url.origin;
}

export function isPaymentReady() {
  const config = paymentConfiguration();
  return config.mercadoPago && config.webhook && config.publicUrl;
}

export async function createPaymentPreference({
  orderId,
  title,
  seats,
  totalCents,
  email,
  installmentsCount,
  receiptToken,
}) {
  const token = process.env.MERCADOPAGO_ACCESS_TOKEN;
  if (!token) throw new Error("Mercado Pago não está configurado.");
  const origin = publicOrigin();
  const returnUrl = new URL("/payment/return", origin);
  returnUrl.searchParams.set("order", orderId);
  returnUrl.searchParams.set("token", receiptToken);
  const result = await fetch(`${apiBase}/checkout/preferences`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      "X-Idempotency-Key": orderId,
    },
    body: JSON.stringify({
      items: [{
        id: orderId,
        title: `${title} — ${seats} ${seats === 1 ? "passageiro" : "passageiros"}`,
        quantity: 1,
        currency_id: "BRL",
        unit_price: totalCents / 100,
      }],
      payer: { email },
      external_reference: orderId,
      metadata: { order_id: orderId },
      payment_methods: installmentsCount > 0
        ? { installments: installmentsCount }
        : undefined,
      back_urls: {
        success: returnUrl.toString(),
        pending: returnUrl.toString(),
        failure: returnUrl.toString(),
      },
      auto_return: "approved",
      notification_url: `${origin}/api/payments/webhook`,
    }),
  });
  if (!result.ok) {
    console.error(`Mercado Pago recusou a criação do pedido ${orderId} (HTTP ${result.status}).`);
    throw new Error("Não foi possível iniciar o pagamento no Mercado Pago.");
  }
  const data = await result.json();
  const checkoutUrl = process.env.MERCADOPAGO_ACCESS_TOKEN.startsWith("TEST-")
    ? data.sandbox_init_point || data.init_point
    : data.init_point;
  if (!data.id || !checkoutUrl) {
    throw new Error("Mercado Pago retornou uma preferência de pagamento incompleta.");
  }
  const checkoutHost = new URL(checkoutUrl).hostname.toLowerCase();
  if (!checkoutHost.endsWith("mercadopago.com.br") && !checkoutHost.endsWith("mercadopago.com")) {
    throw new Error("Mercado Pago retornou um endereço de checkout inválido.");
  }
  return { id: String(data.id), checkoutUrl };
}

export function verifyPaymentWebhook({ dataId, requestId, signature }) {
  const secret = process.env.MERCADOPAGO_WEBHOOK_SECRET;
  if (!secret || !dataId || !requestId || !signature) return false;

  const parts = Object.fromEntries(
    String(signature).split(",").map((part) => {
      const separator = part.indexOf("=");
      return separator < 0
        ? [part.trim(), ""]
        : [part.slice(0, separator).trim(), part.slice(separator + 1).trim()];
    })
  );
  if (!parts.ts || !/^[\da-f]{64}$/i.test(parts.v1 || "")) return false;
  const manifest = `id:${String(dataId).toLowerCase()};request-id:${requestId};ts:${parts.ts};`;
  const expected = createHmac("sha256", secret).update(manifest).digest();
  const received = Buffer.from(parts.v1, "hex");
  return expected.length === received.length && expected.length > 0 &&
    timingSafeEqual(expected, received);
}

export async function fetchMercadoPagoPayment(paymentId) {
  const token = process.env.MERCADOPAGO_ACCESS_TOKEN;
  if (!token) throw new Error("Mercado Pago não está configurado.");
  const response = await fetch(`${apiBase}/v1/payments/${encodeURIComponent(paymentId)}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!response.ok) {
    console.error(`Não foi possível consultar uma notificação do Mercado Pago (HTTP ${response.status}).`);
    throw new Error("Não foi possível consultar o pagamento no Mercado Pago.");
  }
  return response.json();
}
