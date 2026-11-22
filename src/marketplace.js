import express from "express";
import rateLimit from "express-rate-limit";
import { randomBytes, randomUUID } from "node:crypto";
import { pool } from "./db.js";
import {
  decryptPii,
  encryptPii,
  hashToken,
  isValidCpf,
  isValidEmail,
  isPiiEncryptionReady,
  isUuid,
  lookupHash,
  normalizeCpf,
  normalizeEmail,
} from "./security.js";
import {
  createPaymentPreference,
  fetchMercadoPagoPayment,
  isPaymentReady,
  verifyPaymentWebhook,
} from "./payments.js";
import { sendPurchaseConfirmation } from "./email.js";
import { readExcursionImage } from "./storage.js";
import { requireSameOrigin } from "./auth.js";

export const marketplaceRouter = express.Router();

class ApiError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

const orderLimit = rateLimit({
  windowMs: 10 * 60 * 1000,
  limit: 10,
  standardHeaders: "draft-8",
  legacyHeaders: false,
  message: { error: "Muitas tentativas de compra. Aguarde alguns minutos." },
});
const couponLimit = rateLimit({
  windowMs: 10 * 60 * 1000,
  limit: 25,
  standardHeaders: "draft-8",
  legacyHeaders: false,
  message: { error: "Muitas consultas de cupom. Tente novamente mais tarde." },
});
const analyticsLimit = rateLimit({
  windowMs: 60 * 1000,
  limit: 60,
  standardHeaders: "draft-8",
  legacyHeaders: false,
  message: { error: "Limite de visitas excedido." },
});

function publicExcursion(row) {
  const availableSeats = Math.max(0, row.capacity - row.seats_sold - row.seats_reserved);
  return {
    id: row.id,
    title: row.title,
    description: row.description,
    departureDate: row.departure_date,
    imageUrl: `/media/${encodeURIComponent(row.image_key)}`,
    priceCents: row.price_cents,
    minAge: row.min_age,
    availableSeats,
    installmentsCount: row.installments_count,
    soldOut: availableSeats === 0,
  };
}

async function releaseExpiredReservations(client) {
  const expired = await client.query(
    `SELECT id, excursion_id, coupon_id, seats
       FROM orders
      WHERE status = 'pending' AND reservation_expires_at <= NOW()
      ORDER BY reservation_expires_at
      LIMIT 200
      FOR UPDATE SKIP LOCKED`
  );
  for (const order of expired.rows) {
    const result = await client.query(
      `UPDATE orders
          SET status = 'expired', updated_at = NOW()
        WHERE id = $1 AND status = 'pending'
        `,
      [order.id]
    );
    if (!result.rowCount) continue;
    await client.query(
      `UPDATE excursions
          SET seats_reserved = GREATEST(0, seats_reserved - $2), updated_at = NOW()
        WHERE id = $1`,
      [order.excursion_id, order.seats]
    );
    if (order.coupon_id) {
      await client.query(
        `UPDATE coupons
            SET reserved_uses = GREATEST(0, reserved_uses - 1)
          WHERE id = $1`,
        [order.coupon_id]
      );
    }
  }
}

function couponDiscount(coupon, subtotalCents) {
  if (!coupon) return 0;
  const discount = coupon.discount_type === "percent"
    ? Math.floor(subtotalCents * coupon.discount_value / 100)
    : coupon.discount_value;
  return Math.min(discount, Math.max(0, subtotalCents - 1));
}

async function findCoupon(client, rawCode, { lock = false } = {}) {
  const code = String(rawCode || "").trim().toUpperCase();
  if (!code) return null;
  if (!/^[A-Z0-9_-]{3,32}$/.test(code)) {
    throw new ApiError(400, "O código do cupom é inválido.");
  }
  const result = await client.query(
    `SELECT * FROM coupons
      WHERE code = $1 AND is_active = TRUE
        AND (starts_at IS NULL OR starts_at <= NOW())
        AND (expires_at IS NULL OR expires_at > NOW())
        AND (max_uses IS NULL OR used_count + reserved_uses < max_uses)
      ${lock ? "FOR UPDATE" : ""}`,
    [code]
  );
  if (!result.rowCount) throw new ApiError(400, "Esse cupom não existe, expirou ou não tem mais usos.");
  return result.rows[0];
}

function normalizeParticipants(input, minAge) {
  if (!Array.isArray(input) || input.length < 1 || input.length > 20) {
    throw new ApiError(400, "Informe de 1 a 20 pessoas na reserva.");
  }
  const people = input.map((person) => {
    const firstName = String(person?.firstName || "").trim();
    const lastName = String(person?.lastName || "").trim();
    const cpf = normalizeCpf(person?.cpf);
    const email = normalizeEmail(person?.email);
    const phone = String(person?.phone || "").trim();
    const phoneDigits = phone.replace(/\D/g, "");
    const age = Number(person?.age);
    if (firstName.length < 2 || firstName.length > 80 || lastName.length < 2 || lastName.length > 100) {
      throw new ApiError(400, "Informe nome e sobrenome de cada pessoa.");
    }
    if (!isValidCpf(cpf)) throw new ApiError(400, "Um dos CPFs informados não é válido.");
    if (!isValidEmail(email)) throw new ApiError(400, "Informe um e-mail válido para cada pessoa.");
    if (phoneDigits.length < 10 || phoneDigits.length > 13) {
      throw new ApiError(400, "Informe um telefone válido para cada pessoa.");
    }
    if (!Number.isInteger(age) || age < minAge || age > 120) {
      throw new ApiError(400, `Todas as pessoas precisam ter pelo menos ${minAge} anos.`);
    }
    return {
      firstName,
      lastName,
      cpf,
      email,
      phone: phoneDigits,
      age,
    };
  });
  if (new Set(people.map((person) => lookupHash(person.cpf))).size !== people.length) {
    throw new ApiError(400, "Cada pessoa precisa ter um CPF diferente.");
  }
  return people;
}

async function releaseOrderReservation(client, order, finalStatus) {
  if (order.status !== "pending") return;
  await client.query(
    `UPDATE excursions
        SET seats_reserved = GREATEST(0, seats_reserved - $2), updated_at = NOW()
      WHERE id = $1`,
    [order.excursion_id, order.seats]
  );
  if (order.coupon_id) {
    await client.query(
      `UPDATE coupons SET reserved_uses = GREATEST(0, reserved_uses - 1) WHERE id = $1`,
      [order.coupon_id]
    );
  }
  await client.query(
    `UPDATE orders SET status = $2, updated_at = NOW() WHERE id = $1`,
    [order.id, finalStatus]
  );
}

async function deliverConfirmation(orderId, force = false) {
  const claimed = await pool.query(
    `UPDATE orders
        SET email_status = 'sending', email_lock_until = DATE_ADD(NOW(), INTERVAL 2 MINUTE),
            email_error = NULL, updated_at = NOW()
      WHERE id = $1 AND status = 'approved'
        AND ($2 = TRUE OR email_sent_at IS NULL)
        AND (email_status <> 'sending' OR email_lock_until < NOW())`,
    [orderId, force]
  );
  if (!claimed.rowCount) return;

  try {
    const result = await pool.query(
      `SELECT o.id, o.total_cents, o.contact_email_cipher, e.title AS excursion_title,
              e.departure_date
         FROM orders o
         JOIN excursions e ON e.id = o.excursion_id
        WHERE o.id = $1`,
      [orderId]
    );
    if (!result.rowCount) throw new Error("A reserva não foi encontrada.");
    const order = result.rows[0];
    const participants = await pool.query(
      `SELECT first_name_cipher, last_name_cipher, cpf_cipher
         FROM participants WHERE order_id = $1 ORDER BY position`,
      [orderId]
    );
    order.contact_email = decryptPii(order.contact_email_cipher);
    order.participants = participants.rows.map((person) => ({
      firstName: decryptPii(person.first_name_cipher),
      lastName: decryptPii(person.last_name_cipher),
      cpf: decryptPii(person.cpf_cipher),
    }));
    const idempotencyKey = force
      ? `fuila-order-${order.id}-retry-${randomBytes(12).toString("hex")}`
      : `fuila-order-${order.id}`;
    await sendPurchaseConfirmation(order, idempotencyKey);
    await pool.query(
      `UPDATE orders
          SET email_status = 'sent', email_sent_at = NOW(), email_lock_until = NULL,
              email_error = NULL, updated_at = NOW()
        WHERE id = $1`,
      [orderId]
    );
  } catch (error) {
    const message = String(error?.message || "Falha no envio.").slice(0, 180);
    await pool.query(
      `UPDATE orders
          SET email_status = 'failed', email_lock_until = NULL,
              email_error = $2, updated_at = NOW()
        WHERE id = $1`,
      [orderId, message]
    );
    console.error(`Não foi possível enviar a confirmação do pedido ${orderId}.`);
  }
}

marketplaceRouter.get("/excursions", async (_req, res, next) => {
  try {
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await releaseExpiredReservations(client);
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK").catch(() => {});
      throw error;
    } finally {
      client.release();
    }
    const result = await pool.query(
      `SELECT * FROM excursions
        WHERE is_published = TRUE AND departure_date >= CURRENT_DATE
        ORDER BY departure_date ASC`
    );
    res.set("Cache-Control", "no-store");
    res.json(result.rows.map(publicExcursion));
  } catch (error) {
    next(error);
  }
});

marketplaceRouter.post("/analytics/pageview", analyticsLimit, requireSameOrigin, async (req, res, next) => {
  try {
    const path = String(req.body?.path || "/").slice(0, 100);
    if (!/^\/[a-z0-9/_-]*$/i.test(path)) {
      return res.status(400).json({ error: "Página inválida." });
    }
    await pool.query("INSERT INTO page_views (path) VALUES ($1)", [path]);
    res.status(204).end();
  } catch (error) {
    next(error);
  }
});

marketplaceRouter.post("/coupons/preview", couponLimit, requireSameOrigin, async (req, res, next) => {
  const seats = Number(req.body?.seats);
  if (!isUuid(req.body?.excursionId) || !Number.isInteger(seats) || seats < 1 || seats > 20) {
    return res.status(400).json({ error: "Selecione uma excursão e uma quantidade válida." });
  }
  const client = await pool.connect();
  try {
    const excursion = await client.query(
      `SELECT price_cents FROM excursions
        WHERE id = $1 AND is_published = TRUE AND departure_date >= CURRENT_DATE`,
      [req.body.excursionId]
    );
    if (!excursion.rowCount) throw new ApiError(404, "Essa excursão não está disponível.");
    const subtotal = excursion.rows[0].price_cents * seats;
    const coupon = await findCoupon(client, req.body?.code);
    const discount = couponDiscount(coupon, subtotal);
    res.json({
      subtotalCents: subtotal,
      discountCents: discount,
      totalCents: subtotal - discount,
    });
  } catch (error) {
    if (error instanceof ApiError) return res.status(error.status).json({ error: error.message });
    next(error);
  } finally {
    client.release();
  }
});

marketplaceRouter.post("/orders", orderLimit, requireSameOrigin, async (req, res, next) => {
  if (!isPaymentReady()) {
    return res.status(503).json({
      error: "O pagamento ainda não está habilitado. A equipe precisa configurar o Mercado Pago e o endereço público do site.",
    });
  }
  if (!isPiiEncryptionReady()) {
    return res.status(503).json({
      error: "A proteção dos dados de compradores ainda não foi configurada.",
    });
  }
  if (!isUuid(req.body?.excursionId)) {
    return res.status(400).json({ error: "Selecione uma excursão válida." });
  }

  const client = await pool.connect();
  let order;
  let participants;
  const receiptToken = randomBytes(32).toString("hex");
  try {
    await client.query("BEGIN");
    await releaseExpiredReservations(client);
    const excursionResult = await client.query(
      `SELECT * FROM excursions
        WHERE id = $1 AND is_published = TRUE AND departure_date >= CURRENT_DATE
        FOR UPDATE`,
      [req.body.excursionId]
    );
    if (!excursionResult.rowCount) throw new ApiError(404, "Essa excursão não está disponível.");
    const excursion = excursionResult.rows[0];
    participants = normalizeParticipants(req.body?.participants, excursion.min_age);
    const available = excursion.capacity - excursion.seats_sold - excursion.seats_reserved;
    if (participants.length > available) {
      throw new ApiError(409, `Restam apenas ${Math.max(available, 0)} lugares nessa excursão.`);
    }

    const subtotal = excursion.price_cents * participants.length;
    const coupon = await findCoupon(client, req.body?.couponCode, { lock: true });
    const discount = couponDiscount(coupon, subtotal);
    const total = subtotal - discount;
    const contactEmail = participants[0].email;
    const contactPhone = participants[0].phone;
    const orderId = randomUUID();
    await client.query(
      `INSERT INTO orders
        (id, excursion_id, coupon_id, seats, subtotal_cents, discount_cents, total_cents,
         contact_email_cipher, contact_email_hash, contact_phone_cipher,
         reservation_expires_at, receipt_token_hash)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10,
               DATE_ADD(NOW(), INTERVAL 20 MINUTE), $11)`,
      [
        orderId,
        excursion.id,
        coupon?.id || null,
        participants.length,
        subtotal,
        discount,
        total,
        encryptPii(contactEmail),
        lookupHash(contactEmail),
        encryptPii(contactPhone),
        hashToken(receiptToken),
      ]
    );
    const inserted = await client.query(
      "SELECT id, reservation_expires_at FROM orders WHERE id = $1",
      [orderId]
    );
    order = inserted.rows[0];
    await client.query(
      `UPDATE excursions
          SET seats_reserved = seats_reserved + $2, updated_at = NOW()
        WHERE id = $1`,
      [excursion.id, participants.length]
    );
    if (coupon) {
      await client.query(
        `UPDATE coupons SET reserved_uses = reserved_uses + 1 WHERE id = $1`,
        [coupon.id]
      );
    }
    for (const [index, person] of participants.entries()) {
      await client.query(
        `INSERT INTO participants
          (id, order_id, position, first_name_cipher, last_name_cipher,
           cpf_cipher, cpf_hash, email_cipher, email_hash, phone_cipher, age_years)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
        [
          randomUUID(),
          order.id,
          index + 1,
          encryptPii(person.firstName),
          encryptPii(person.lastName),
          encryptPii(person.cpf),
          lookupHash(person.cpf),
          encryptPii(person.email),
          lookupHash(person.email),
          encryptPii(person.phone),
          person.age,
        ]
      );
    }
    await client.query("COMMIT");

    const preference = await createPaymentPreference({
      orderId: order.id,
      title: excursion.title,
      seats: participants.length,
      totalCents: total,
      email: contactEmail,
      installmentsCount: excursion.installments_count,
      receiptToken,
    });
    await pool.query(
      `UPDATE orders SET mp_preference_id = $2, updated_at = NOW() WHERE id = $1`,
      [order.id, preference.id]
    );
    res.status(201).json({
      checkoutUrl: preference.checkoutUrl,
      receiptUrl: `/payment/return?order=${encodeURIComponent(order.id)}&token=${encodeURIComponent(receiptToken)}`,
    });
  } catch (error) {
    try {
      await client.query("ROLLBACK");
    } catch {
      // The transaction may already be committed before a provider error.
    }
    if (order?.id) await releaseFailedPreference(order.id);
    if (error instanceof ApiError) return res.status(error.status).json({ error: error.message });
    if (order?.id) {
      return res.status(502).json({ error: "Não foi possível iniciar o pagamento. Nenhum lugar foi confirmado." });
    }
    next(error);
  } finally {
    client.release();
  }
});

async function releaseFailedPreference(orderId) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const result = await client.query(
      `SELECT id, excursion_id, coupon_id, seats, status
         FROM orders WHERE id = $1 FOR UPDATE`,
      [orderId]
    );
    if (result.rowCount && result.rows[0].status === "pending") {
      await releaseOrderReservation(client, result.rows[0], "rejected");
    }
    await client.query("COMMIT");
  } catch {
    await client.query("ROLLBACK").catch(() => {});
    console.error("Não foi possível liberar a reserva após uma falha no checkout.");
  } finally {
    client.release();
  }
}

marketplaceRouter.get("/orders/:id/status", async (req, res, next) => {
  if (!isUuid(req.params.id) || !/^[0-9a-f]{64}$/i.test(String(req.query.token || ""))) {
    return res.status(404).json({ error: "Reserva não encontrada." });
  }
  try {
    const result = await pool.query(
      `SELECT o.status, o.email_status, e.title
         FROM orders o JOIN excursions e ON e.id = o.excursion_id
        WHERE o.id = $1 AND o.receipt_token_hash = $2`,
      [req.params.id, hashToken(req.query.token)]
    );
    if (!result.rowCount) return res.status(404).json({ error: "Reserva não encontrada." });
    res.set("Cache-Control", "no-store");
    res.json({
      status: result.rows[0].status,
      emailStatus: result.rows[0].email_status,
      excursionTitle: result.rows[0].title,
    });
  } catch (error) {
    next(error);
  }
});

marketplaceRouter.post("/payments/webhook", async (req, res, next) => {
  const dataId = req.query["data.id"] || req.body?.data?.id || req.body?.id;
  const eventType = req.query.type || req.body?.type || req.query.topic;
  if (eventType && !["payment", "payment.created", "payment.updated", "payment_id"].includes(String(eventType))) {
    return res.status(200).json({ received: true });
  }
  const verified = verifyPaymentWebhook({
    dataId,
    requestId: req.get("x-request-id"),
    signature: req.get("x-signature"),
  });
  if (!verified) return res.status(401).json({ error: "Notificação de pagamento inválida." });

  let payment;
  try {
    payment = await fetchMercadoPagoPayment(dataId);
  } catch (error) {
    return next(error);
  }
  if (!isUuid(payment.external_reference)) {
    return res.status(200).json({ received: true });
  }

  let shouldEmail = false;
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await releaseExpiredReservations(client);
    const orderResult = await client.query(
      `SELECT * FROM orders WHERE id = $1 FOR UPDATE`,
      [payment.external_reference]
    );
    if (!orderResult.rowCount) {
      await client.query("COMMIT");
      return res.status(200).json({ received: true });
    }
    const order = orderResult.rows[0];
    if (order.mp_payment_id && order.mp_payment_id !== String(payment.id)) {
      console.error(`Uma reserva recebeu outra tentativa de pagamento: ${order.id}.`);
      await client.query("COMMIT");
      return res.status(200).json({ received: true });
    }

    const paymentAmount = Math.round(Number(payment.transaction_amount) * 100);
    const amountMatches = payment.currency_id === "BRL" && paymentAmount === order.total_cents;
    if (payment.status === "approved" && !amountMatches) {
      if (order.status === "pending") await releaseOrderReservation(client, order, "review_required");
      else await client.query(
        `UPDATE orders SET status = 'review_required', updated_at = NOW() WHERE id = $1`,
        [order.id]
      );
      await client.query(
        `UPDATE orders SET mp_payment_id = $2, payment_method = $3 WHERE id = $1`,
        [order.id, String(payment.id), String(payment.payment_type_id || "unknown").slice(0, 40)]
      );
      await client.query("COMMIT");
      console.error(`Um pagamento precisa de revisão manual: ${order.id}.`);
      return res.status(200).json({ received: true });
    }

    if (payment.status === "approved" && order.status !== "approved") {
      const excursionResult = await client.query(
        `SELECT capacity, seats_reserved, seats_sold
           FROM excursions WHERE id = $1 FOR UPDATE`,
        [order.excursion_id]
      );
      const excursion = excursionResult.rows[0];
      const held = order.status === "pending";
      const available = excursion.capacity - excursion.seats_reserved - excursion.seats_sold;
      if (held || available >= order.seats) {
        await client.query(
          `UPDATE excursions
              SET seats_reserved = GREATEST(0, seats_reserved - $2),
                  seats_sold = seats_sold + $2, updated_at = NOW()
            WHERE id = $1`,
          [order.excursion_id, held ? order.seats : 0]
        );
        if (order.coupon_id) {
          await client.query(
            `UPDATE coupons
                SET reserved_uses = GREATEST(0, reserved_uses - $2),
                    used_count = used_count + 1
              WHERE id = $1`,
            [order.coupon_id, held ? 1 : 0]
          );
        }
        await client.query(
          `UPDATE orders
              SET status = 'approved', mp_payment_id = $2, payment_method = $3,
                  updated_at = NOW()
            WHERE id = $1`,
          [order.id, String(payment.id), String(payment.payment_type_id || "unknown").slice(0, 40)]
        );
        shouldEmail = true;
      } else {
        await client.query(
          `UPDATE orders SET status = 'review_required', mp_payment_id = $2,
              payment_method = $3, updated_at = NOW() WHERE id = $1`,
          [order.id, String(payment.id), String(payment.payment_type_id || "unknown").slice(0, 40)]
        );
        console.error(`Um pagamento aprovado não encontrou lugares disponíveis: ${order.id}.`);
      }
    } else if (["rejected", "cancelled"].includes(payment.status) && order.status === "pending") {
      await releaseOrderReservation(client, order, payment.status);
      await client.query(
        `UPDATE orders SET mp_payment_id = $2, payment_method = $3 WHERE id = $1`,
        [order.id, String(payment.id), String(payment.payment_type_id || "unknown").slice(0, 40)]
      );
    } else if (payment.status === "refunded" && order.status === "approved") {
      await client.query(
        `UPDATE excursions
            SET seats_sold = GREATEST(0, seats_sold - $2), updated_at = NOW()
          WHERE id = $1`,
        [order.excursion_id, order.seats]
      );
      await client.query(
        `UPDATE orders SET status = 'refunded', mp_payment_id = $2, updated_at = NOW() WHERE id = $1`,
        [order.id, String(payment.id)]
      );
    } else if (!order.mp_payment_id) {
      await client.query(
        `UPDATE orders
            SET mp_payment_id = $2, payment_method = $3, updated_at = NOW()
          WHERE id = $1`,
        [order.id, String(payment.id), String(payment.payment_type_id || "unknown").slice(0, 40)]
      );
    }
    await client.query("COMMIT");
    if (shouldEmail) await deliverConfirmation(order.id);
    res.status(200).json({ received: true });
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    next(error);
  } finally {
    client.release();
  }
});

export async function serveExcursionImage(req, res) {
  const key = String(req.params.key || "");
  if (!/^[0-9a-f-]{36}\.(jpg|png|webp)$/i.test(key)) return res.sendStatus(404);
  try {
    const result = await pool.query(
      `SELECT image_mime, is_published FROM excursions WHERE image_key = $1 LIMIT 1`,
      [key]
    );
    if (!result.rowCount || (!result.rows[0].is_published && req.session?.staff !== true)) {
      return res.sendStatus(404);
    }
    const image = await readExcursionImage(key);
    if (!image) return res.sendStatus(404);
    res.set({
      "Content-Type": result.rows[0].image_mime,
      "Content-Length": image.length,
      "X-Content-Type-Options": "nosniff",
      "Cache-Control": result.rows[0].is_published ? "public, max-age=3600" : "private, no-store",
    });
    res.end(image);
  } catch {
    res.sendStatus(404);
  }
}

export async function resendConfirmation(orderId) {
  await deliverConfirmation(orderId, true);
  const result = await pool.query(
    `SELECT email_status, email_error FROM orders WHERE id = $1`,
    [orderId]
  );
  return result.rows[0] || null;
}
