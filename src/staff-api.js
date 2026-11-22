import express from "express";
import multer from "multer";
import { randomUUID } from "node:crypto";
import { pool } from "./db.js";
import { decryptPii, isUuid, lookupHash, normalizeCpf, normalizeEmail } from "./security.js";
import { paymentConfiguration } from "./payments.js";
import { deleteExcursionImage, storeExcursionImage } from "./storage.js";
import { requireSameOrigin, requireStaff } from "./auth.js";
import { resendConfirmation } from "./marketplace.js";

export const staffRouter = express.Router();

class InputError extends Error {}

const photoUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024, files: 1 },
});
export const excursionPhotoUpload = photoUpload.single("photo");

staffRouter.use(requireStaff);
staffRouter.use((req, res, next) => {
  if (["POST", "PUT", "PATCH", "DELETE"].includes(req.method)) {
    return requireSameOrigin(req, res, next);
  }
  next();
});

function excursionAvailability(row) {
  return {
    ...row,
    available_seats: Math.max(0, row.capacity - row.seats_sold - row.seats_reserved),
    image_url: `/media/${encodeURIComponent(row.image_key)}`,
  };
}

function parseExcursion(body) {
  const title = String(body.title || "").trim();
  const description = String(body.description || "").trim();
  const departureDate = String(body.departureDate || "");
  const price = Number(body.price);
  const minAge = Number(body.minAge);
  const capacity = Number(body.capacity);
  const installmentsEnabled = body.installmentsEnabled === "true" ||
    body.installmentsEnabled === "on";
  const installmentsCount = installmentsEnabled ? Number(body.installmentsCount) : 0;
  const isPublished = body.isPublished === "true" || body.isPublished === "on";
  const todayInBrazil = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Sao_Paulo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());

  if (title.length < 3 || title.length > 120) throw new InputError("Informe o nome da excursão.");
  if (description.length > 2000) throw new InputError("A descrição pode ter até 2.000 caracteres.");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(departureDate) ||
      new Date(`${departureDate}T12:00:00Z`).toISOString().slice(0, 10) !== departureDate ||
      departureDate < todayInBrazil) {
    throw new InputError("Informe uma data futura válida.");
  }
  if (!Number.isFinite(price) || price < 0.01 || price > 1_000_000) {
    throw new InputError("Informe um preço válido.");
  }
  if (!Number.isInteger(minAge) || minAge < 0 || minAge > 120) {
    throw new InputError("Informe uma idade mínima entre 0 e 120 anos.");
  }
  if (!Number.isInteger(capacity) || capacity < 1 || capacity > 10000) {
    throw new InputError("Informe uma quantidade de vagas entre 1 e 10.000.");
  }
  if (installmentsEnabled && (!Number.isInteger(installmentsCount) ||
      installmentsCount < 2 || installmentsCount > 12)) {
    throw new InputError("Escolha de 2 a 12 parcelas.");
  }
  return {
    title,
    description,
    departureDate,
    priceCents: Math.round(price * 100),
    minAge,
    capacity,
    installmentsCount,
    isPublished,
  };
}

function parseCoupon(body) {
  const code = String(body.code || "").trim().toUpperCase();
  const discountType = String(body.discountType || "");
  const rawValue = Number(body.discountValue);
  const maxUses = body.maxUses === "" || body.maxUses == null ? null : Number(body.maxUses);
  const expiresAt = String(body.expiresAt || "").trim() || null;
  if (!/^[A-Z0-9_-]{3,32}$/.test(code)) throw new InputError("Use de 3 a 32 letras ou números no cupom.");
  if (!["percent", "fixed"].includes(discountType)) throw new InputError("Escolha um tipo de desconto.");
  if (!Number.isFinite(rawValue) || rawValue <= 0) throw new InputError("Informe um desconto maior que zero.");
  const discountValue = discountType === "fixed" ? Math.round(rawValue * 100) : Math.round(rawValue);
  if (discountType === "fixed" && (discountValue < 1 || discountValue > 100_000_000)) {
    throw new InputError("Informe um valor de desconto válido.");
  }
  if (discountType === "percent" && (discountValue < 1 || discountValue > 100)) {
    throw new InputError("O percentual precisa ficar entre 1% e 100%.");
  }
  if (maxUses !== null && (!Number.isInteger(maxUses) || maxUses < 1 || maxUses > 1_000_000)) {
    throw new InputError("Informe um limite de usos válido.");
  }
  let expiry = null;
  if (expiresAt) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(expiresAt)) throw new InputError("Informe uma data de validade válida.");
    expiry = `${expiresAt} 23:59:59`;
  }
  return { code, discountType, discountValue, maxUses, expiry };
}

staffRouter.get("/config", (_req, res) => {
  res.set("Cache-Control", "no-store");
  res.json(paymentConfiguration());
});

staffRouter.get("/overview", async (_req, res, next) => {
  try {
    const [daily, totals] = await Promise.all([
      pool.query(
        `WITH RECURSIVE days AS (
           SELECT CURRENT_DATE - INTERVAL 29 DAY AS day_date
           UNION ALL
           SELECT day_date + INTERVAL 1 DAY FROM days WHERE day_date < CURRENT_DATE
         ), visits AS (
           SELECT DATE(created_at) AS day_date, COUNT(*) AS visits
             FROM page_views
            WHERE created_at >= CURRENT_DATE - INTERVAL 29 DAY
            GROUP BY DATE(created_at)
         ), payments AS (
           SELECT DATE(created_at) AS day_date, COUNT(*) AS orders,
                  COALESCE(SUM(total_cents), 0) AS revenue_cents
             FROM orders
            WHERE status = 'approved'
              AND created_at >= CURRENT_DATE - INTERVAL 29 DAY
            GROUP BY DATE(created_at)
         )
         SELECT DATE_FORMAT(days.day_date, '%Y-%m-%d') AS day,
                COALESCE(visits.visits, 0) AS visits,
                COALESCE(payments.orders, 0) AS orders,
                COALESCE(payments.revenue_cents, 0) AS revenue_cents
           FROM days
            LEFT JOIN visits ON visits.day_date = days.day_date
            LEFT JOIN payments ON payments.day_date = days.day_date
           ORDER BY days.day_date`
      ),
      pool.query(
         `SELECT COALESCE(SUM(CASE WHEN status = 'approved' THEN 1 ELSE 0 END), 0) AS approved_orders,
                 COALESCE(SUM(CASE WHEN status = 'pending' THEN 1 ELSE 0 END), 0) AS pending_orders,
                 COALESCE(SUM(CASE WHEN status = 'review_required' THEN 1 ELSE 0 END), 0) AS review_orders,
                 COALESCE(SUM(CASE WHEN status = 'approved' THEN total_cents ELSE 0 END), 0) AS revenue_cents
           FROM orders`
      ),
    ]);
    res.set("Cache-Control", "no-store");
    res.json({ daily: daily.rows, totals: totals.rows[0] });
  } catch (error) {
    next(error);
  }
});

staffRouter.get("/excursions", async (_req, res, next) => {
  try {
    const result = await pool.query(
      `SELECT * FROM excursions ORDER BY departure_date DESC, created_at DESC`
    );
    res.json(result.rows.map(excursionAvailability));
  } catch (error) {
    next(error);
  }
});

staffRouter.post("/excursions", excursionPhotoUpload, async (req, res, next) => {
  let photo;
  try {
    const values = parseExcursion(req.body);
    if (!req.file) return res.status(400).json({ error: "Escolha a foto da excursão." });
    photo = await storeExcursionImage(req.file);
    const excursionId = randomUUID();
    await pool.query(
      `INSERT INTO excursions
        (id, title, description, departure_date, image_key, image_mime, price_cents,
         min_age, capacity, installments_count, is_published)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
      [
        excursionId,
        values.title, values.description, values.departureDate, photo.key,
        photo.mime, values.priceCents, values.minAge, values.capacity,
        values.installmentsCount, values.isPublished,
      ]
    );
    const result = await pool.query("SELECT * FROM excursions WHERE id = $1", [excursionId]);
    res.status(201).json(excursionAvailability(result.rows[0]));
  } catch (error) {
    if (photo?.key) await deleteExcursionImage(photo.key);
    if (error instanceof InputError) return res.status(400).json({ error: error.message });
    next(error);
  }
});

staffRouter.put("/excursions/:id", excursionPhotoUpload, async (req, res, next) => {
  if (!isUuid(req.params.id)) return res.status(404).json({ error: "Excursão não encontrada." });
  let photo;
  try {
    const values = parseExcursion(req.body);
    const previous = await pool.query("SELECT image_key FROM excursions WHERE id = $1", [req.params.id]);
    if (!previous.rowCount) return res.status(404).json({ error: "Excursão não encontrada." });
    if (req.file) photo = await storeExcursionImage(req.file);
    const imageKey = photo?.key || previous.rows[0].image_key;
    const imageMime = photo?.mime || (await pool.query(
      "SELECT image_mime FROM excursions WHERE id = $1", [req.params.id]
    )).rows[0].image_mime;
    await pool.query(
      `UPDATE excursions
          SET title = $2, description = $3, departure_date = $4,
              image_key = $5, image_mime = $6, price_cents = $7,
              min_age = $8, capacity = $9, installments_count = $10,
              is_published = $11, updated_at = NOW()
        WHERE id = $1`,
      [
        req.params.id, values.title, values.description, values.departureDate,
        imageKey, imageMime, values.priceCents, values.minAge, values.capacity,
        values.installmentsCount, values.isPublished,
      ]
    );
    const updated = await pool.query("SELECT * FROM excursions WHERE id = $1", [req.params.id]);
    if (!updated.rowCount) {
      if (photo?.key) await deleteExcursionImage(photo.key);
      return res.status(404).json({ error: "Excursão não encontrada." });
    }
    if (photo && previous.rows[0].image_key !== photo.key) {
      await deleteExcursionImage(previous.rows[0].image_key);
    }
    res.json(excursionAvailability(updated.rows[0]));
  } catch (error) {
    if (photo?.key) await deleteExcursionImage(photo.key);
    if (error instanceof InputError) return res.status(400).json({ error: error.message });
    if (error.code === "ER_CHECK_CONSTRAINT_VIOLATED" || error.errno === 3819) {
      return res.status(409).json({
        error: "As vagas não podem ficar abaixo dos lugares já reservados ou vendidos.",
      });
    }
    next(error);
  }
});

staffRouter.patch("/excursions/:id/publish", async (req, res, next) => {
  if (!isUuid(req.params.id) || typeof req.body?.published !== "boolean") {
    return res.status(400).json({ error: "Estado da excursão inválido." });
  }
  try {
    await pool.query(
      `UPDATE excursions SET is_published = $2, updated_at = NOW()
        WHERE id = $1`,
      [req.params.id, req.body.published]
    );
    const result = await pool.query("SELECT * FROM excursions WHERE id = $1", [req.params.id]);
    if (!result.rowCount) return res.status(404).json({ error: "Excursão não encontrada." });
    res.json(excursionAvailability(result.rows[0]));
  } catch (error) {
    next(error);
  }
});

staffRouter.get("/coupons", async (_req, res, next) => {
  try {
    const result = await pool.query(
      `SELECT id, code, discount_type, discount_value, max_uses, used_count,
              reserved_uses, starts_at, expires_at, is_active, created_at
         FROM coupons ORDER BY created_at DESC`
    );
    res.json(result.rows);
  } catch (error) {
    next(error);
  }
});

staffRouter.post("/coupons", async (req, res, next) => {
  try {
    const coupon = parseCoupon(req.body);
    const couponId = randomUUID();
    await pool.query(
      `INSERT INTO coupons (id, code, discount_type, discount_value, max_uses, expires_at)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [couponId, coupon.code, coupon.discountType, coupon.discountValue, coupon.maxUses, coupon.expiry]
    );
    const result = await pool.query(
      `SELECT id, code, discount_type, discount_value, max_uses,
              used_count, reserved_uses, expires_at, is_active, created_at
         FROM coupons WHERE code = $1`,
      [coupon.code]
    );
    res.status(201).json(result.rows[0]);
  } catch (error) {
    if (error instanceof InputError) return res.status(400).json({ error: error.message });
    if (error.code === "ER_DUP_ENTRY") return res.status(409).json({ error: "Já existe um cupom com esse código." });
    next(error);
  }
});

staffRouter.patch("/coupons/:id", async (req, res, next) => {
  if (!isUuid(req.params.id) || typeof req.body?.active !== "boolean") {
    return res.status(400).json({ error: "Estado do cupom inválido." });
  }
  try {
    await pool.query(
      `UPDATE coupons SET is_active = $2 WHERE id = $1`,
      [req.params.id, req.body.active]
    );
    const result = await pool.query(
      `SELECT id, code, discount_type, discount_value, max_uses,
              used_count, reserved_uses, expires_at, is_active, created_at
         FROM coupons WHERE id = $1`,
      [req.params.id]
    );
    if (!result.rowCount) return res.status(404).json({ error: "Cupom não encontrado." });
    res.json(result.rows[0]);
  } catch (error) {
    next(error);
  }
});

staffRouter.get("/buyers", async (req, res, next) => {
  const page = Math.max(1, Math.min(1000, Number.parseInt(req.query.page, 10) || 1));
  const search = String(req.query.q || "").trim().slice(0, 120);
  const limit = 50;
  let searchHash = null;
  let searchKind = null;
  if (search) {
    const email = normalizeEmail(search);
    const cpf = normalizeCpf(search);
    if (email.includes("@")) {
      searchHash = lookupHash(email);
      searchKind = "email";
    } else if (cpf.length === 11) {
      searchHash = lookupHash(cpf);
      searchKind = "cpf";
    } else {
      return res.json({ buyers: [], page, hasMore: false });
    }
  }
  try {
    const where = searchKind === "email"
      ? "AND (o.contact_email_hash = $1 OR EXISTS (SELECT 1 FROM participants px WHERE px.order_id=o.id AND px.email_hash=$1))"
      : searchKind === "cpf"
        ? "AND EXISTS (SELECT 1 FROM participants px WHERE px.order_id=o.id AND px.cpf_hash=$1)"
        : "";
    const params = searchHash
      ? [searchHash, limit, (page - 1) * limit]
      : [limit, (page - 1) * limit];
    const offset = searchHash ? "$3" : "$2";
    const query = await pool.query(
      `SELECT o.id, o.status, o.seats, o.total_cents, o.payment_method,
              o.email_status, o.email_error, o.created_at, o.contact_email_cipher,
              o.contact_phone_cipher, e.title AS excursion_title, e.departure_date
         FROM orders o JOIN excursions e ON e.id = o.excursion_id
         WHERE 1 = 1 ${where}
        ORDER BY o.created_at DESC
        LIMIT $${searchHash ? 2 : 1} OFFSET ${offset}`,
      params
    );
    const ids = query.rows.map((order) => order.id);
    const peopleResult = ids.length
      ? await pool.query(
        `SELECT order_id, first_name_cipher, last_name_cipher, cpf_cipher,
                email_cipher, phone_cipher, age_years
           FROM participants
          WHERE order_id = ANY($1::uuid[])
          ORDER BY order_id, position`,
        [ids]
      )
      : { rows: [] };
    const peopleByOrder = new Map();
    for (const person of peopleResult.rows) {
      const list = peopleByOrder.get(person.order_id) || [];
      list.push({
        firstName: decryptPii(person.first_name_cipher),
        lastName: decryptPii(person.last_name_cipher),
        cpf: decryptPii(person.cpf_cipher),
        email: decryptPii(person.email_cipher),
        phone: decryptPii(person.phone_cipher),
        age: person.age_years,
      });
      peopleByOrder.set(person.order_id, list);
    }
    res.set("Cache-Control", "no-store");
    res.json({
      buyers: query.rows.map((order) => ({
        id: order.id,
        status: order.status,
        seats: order.seats,
        totalCents: order.total_cents,
        paymentMethod: order.payment_method,
        emailStatus: order.email_status,
        emailError: order.email_error,
        createdAt: order.created_at,
        excursionTitle: order.excursion_title,
        departureDate: order.departure_date,
        contactEmail: decryptPii(order.contact_email_cipher),
        contactPhone: decryptPii(order.contact_phone_cipher),
        participants: peopleByOrder.get(order.id) || [],
      })),
      page,
      hasMore: query.rowCount === limit,
    });
  } catch (error) {
    next(error);
  }
});

staffRouter.post("/orders/:id/resend-email", async (req, res, next) => {
  if (!isUuid(req.params.id)) return res.status(404).json({ error: "Reserva não encontrada." });
  try {
    const result = await resendConfirmation(req.params.id);
    if (!result) return res.status(404).json({ error: "Reserva confirmada não encontrada." });
    if (result.email_status === "failed") {
      return res.status(502).json({
        error: result.email_error || "Não foi possível enviar o e-mail.",
      });
    }
    if (result.email_status === "sending") {
      return res.status(409).json({ error: "O envio do e-mail já está em andamento." });
    }
    res.json({ sent: result.email_status === "sent" });
  } catch (error) {
    next(error);
  }
});
