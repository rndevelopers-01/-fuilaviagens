import test from "node:test";
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import {
  decryptPii,
  encryptPii,
  isPiiEncryptionReady,
  isValidCpf,
  lookupHash,
  maskCpf,
} from "../src/security.js";
import { createPaymentPreference, verifyPaymentWebhook } from "../src/payments.js";
import { sendPurchaseConfirmation } from "../src/email.js";

const testKey = Buffer.alloc(32, 7).toString("base64");

test("CPF validation rejects repeated or invalid check digits", () => {
  assert.equal(isValidCpf("529.982.247-25"), true);
  assert.equal(isValidCpf("111.111.111-11"), false);
  assert.equal(isValidCpf("529.982.247-24"), false);
});

test("buyer data is encrypted and searchable only through a keyed hash", () => {
  process.env.PII_ENCRYPTION_KEY = testKey;
  assert.equal(isPiiEncryptionReady(), true);
  const encrypted = encryptPii("52998224725");
  assert.notEqual(encrypted, "52998224725");
  assert.equal(decryptPii(encrypted), "52998224725");
  assert.equal(lookupHash("buyer@example.com"), lookupHash("buyer@example.com"));
  assert.notEqual(lookupHash("buyer@example.com"), lookupHash("other@example.com"));
  assert.equal(maskCpf("52998224725"), "***.***.***-25");
});

test("Mercado Pago webhook signature uses its signed request manifest", () => {
  const secret = "unit-test-webhook-secret";
  const dataId = "123456789";
  const requestId = "request-test-1";
  const timestamp = "1700000000";
  const manifest = `id:${dataId};request-id:${requestId};ts:${timestamp};`;
  const signature = createHmac("sha256", secret).update(manifest).digest("hex");
  process.env.MERCADOPAGO_WEBHOOK_SECRET = secret;
  assert.equal(
    verifyPaymentWebhook({
      dataId,
      requestId,
      signature: `ts=${timestamp},v1=${signature}`,
    }),
    true
  );
  assert.equal(
    verifyPaymentWebhook({
      dataId,
      requestId,
      signature: `ts=${timestamp},v1=${"0".repeat(64)}`,
    }),
    false
  );
});

test("Mercado Pago preference redirects to its hosted test checkout", async () => {
  process.env.MERCADOPAGO_ACCESS_TOKEN = "TEST-token-for-unit-test";
  process.env.PUBLIC_APP_URL = "https://fuila.example";
  const originalFetch = globalThis.fetch;
  let body;
  globalThis.fetch = async (url, options) => {
    assert.equal(url, "https://api.mercadopago.com/checkout/preferences");
    body = JSON.parse(options.body);
    return new Response(JSON.stringify({
      id: "preference-test-id",
      init_point: "https://www.mercadopago.com.br/checkout/live",
      sandbox_init_point: "https://sandbox.mercadopago.com.br/checkout/test",
    }), {
      status: 201,
      headers: { "Content-Type": "application/json" },
    });
  };
  try {
    const preference = await createPaymentPreference({
      orderId: "order-test-2",
      title: "Penedo",
      seats: 2,
      totalCents: 30000,
      email: "buyer@example.com",
      installmentsCount: 12,
      receiptToken: "receipt-test-token",
    });
    assert.equal(preference.checkoutUrl, "https://sandbox.mercadopago.com.br/checkout/test");
  } finally {
    globalThis.fetch = originalFetch;
  }
  assert.equal(body.external_reference, "order-test-2");
  assert.equal(body.items[0].unit_price, 300);
  assert.equal(body.payment_methods.installments, 12);
  assert.match(body.back_urls.success, /token=receipt-test-token/);
  assert.match(body.notification_url, /\/api\/payments\/webhook$/);
});

test("confirmation email masks each CPF and sends to the first contact only", async () => {
  process.env.RESEND_API_KEY = "unit-test-api-key";
  process.env.RESEND_FROM_EMAIL = "Fui Lá <reservas@example.test>";
  const originalFetch = globalThis.fetch;
  let requestBody;
  let requestHeaders;
  globalThis.fetch = async (_url, options) => {
    requestBody = JSON.parse(options.body);
    requestHeaders = options.headers;
    return new Response(JSON.stringify({ id: "email-test-id" }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  };
  try {
    await sendPurchaseConfirmation({
      id: "order-test-1",
      contact_email: "buyer@example.com",
      total_cents: 49996,
      excursion_title: "Campos do Jordão",
      departure_date: "2027-08-20",
      participants: [{
        firstName: "Maria",
        lastName: "Silva",
        cpf: "52998224725",
      }],
    });
  } finally {
    globalThis.fetch = originalFetch;
  }
  assert.deepEqual(requestBody.to, ["buyer@example.com"]);
  assert.ok(requestBody.text.includes("***.***.***-25"));
  assert.doesNotMatch(requestBody.text, /52998224725/);
  assert.equal(requestHeaders["Idempotency-Key"], "fuila-order-order-test-1");
});
