import {
  createCipheriv,
  createDecipheriv,
  createHmac,
  createHash,
  randomBytes,
  timingSafeEqual,
} from "node:crypto";

function piiKey() {
  const value = process.env.PII_ENCRYPTION_KEY?.trim();
  if (!value) throw new Error("A chave de proteção de dados ainda não foi configurada.");

  const key = /^[\da-f]{64}$/i.test(value)
    ? Buffer.from(value, "hex")
    : Buffer.from(value, "base64");
  if (key.length !== 32) {
    throw new Error("PII_ENCRYPTION_KEY precisa conter uma chave de 32 bytes em base64.");
  }
  return key;
}

export function isPiiEncryptionReady() {
  try {
    piiKey();
    return true;
  } catch {
    return false;
  }
}

export function encryptPii(value) {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", piiKey(), iv);
  const ciphertext = Buffer.concat([
    cipher.update(String(value), "utf8"),
    cipher.final(),
  ]);
  const tag = cipher.getAuthTag();
  return ["v1", iv, tag, ciphertext].map((part, index) =>
    index === 0 ? part : part.toString("base64url")
  ).join(".");
}

export function decryptPii(value) {
  const [version, iv, tag, ciphertext] = String(value).split(".");
  if (version !== "v1" || !iv || !tag || !ciphertext) {
    throw new Error("Dado protegido inválido.");
  }
  const decipher = createDecipheriv(
    "aes-256-gcm",
    piiKey(),
    Buffer.from(iv, "base64url")
  );
  decipher.setAuthTag(Buffer.from(tag, "base64url"));
  return Buffer.concat([
    decipher.update(Buffer.from(ciphertext, "base64url")),
    decipher.final(),
  ]).toString("utf8");
}

export function lookupHash(value) {
  const key = createHmac("sha256", piiKey()).update("fuila-lookup-key-v1").digest();
  return createHmac("sha256", key).update(String(value)).digest("hex");
}

export function hashToken(value) {
  return createHash("sha256").update(String(value)).digest("hex");
}

export function safeTextEqual(left, right) {
  const a = createHash("sha256").update(String(left)).digest();
  const b = createHash("sha256").update(String(right)).digest();
  return timingSafeEqual(a, b);
}

export function normalizeEmail(value) {
  return String(value || "").trim().toLowerCase();
}

export function normalizeCpf(value) {
  return String(value || "").replace(/\D/g, "");
}

export function isValidCpf(value) {
  const cpf = normalizeCpf(value);
  if (cpf.length !== 11 || /^(\d)\1{10}$/.test(cpf)) return false;

  let sum = 0;
  for (let index = 0; index < 9; index += 1) {
    sum += Number(cpf[index]) * (10 - index);
  }
  let digit = (sum * 10) % 11;
  if (digit === 10) digit = 0;
  if (digit !== Number(cpf[9])) return false;

  sum = 0;
  for (let index = 0; index < 10; index += 1) {
    sum += Number(cpf[index]) * (11 - index);
  }
  digit = (sum * 10) % 11;
  if (digit === 10) digit = 0;
  return digit === Number(cpf[10]);
}

export function maskCpf(value) {
  const cpf = normalizeCpf(value);
  return cpf.length === 11 ? `***.***.***-${cpf.slice(-2)}` : "***.***.***-**";
}

export function isValidEmail(value) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizeEmail(value));
}

export function isUuid(value) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(String(value));
}

export function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, (char) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#039;",
  })[char]);
}
