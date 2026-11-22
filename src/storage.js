import { randomUUID } from "node:crypto";
import { Client } from "@replit/object-storage";

const allowedMimeTypes = new Map([
  ["image/jpeg", "jpg"],
  ["image/png", "png"],
  ["image/webp", "webp"],
]);
let storageClient;

function client() {
  storageClient ||= new Client();
  return storageClient;
}

export async function storeExcursionImage(file) {
  const extension = allowedMimeTypes.get(file?.mimetype);
  if (!extension || !Buffer.isBuffer(file.buffer)) {
    throw new Error("Envie uma imagem JPG, PNG ou WebP válida.");
  }
  const bytes = file.buffer;
  const validSignature =
    (file.mimetype === "image/jpeg" && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) ||
    (file.mimetype === "image/png" && bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) ||
    (file.mimetype === "image/webp" && bytes.toString("ascii", 0, 4) === "RIFF" && bytes.toString("ascii", 8, 12) === "WEBP");
  if (!validSignature) throw new Error("O conteúdo do arquivo não corresponde a uma foto JPG, PNG ou WebP.");

  const key = `${randomUUID()}.${extension}`;
  const result = await client().uploadFromBytes(key, file.buffer);
  if (!result.ok) {
    console.error("O armazenamento de imagens recusou o envio.");
    throw new Error("Não foi possível salvar a foto. Verifique se o App Storage está configurado.");
  }
  return { key, mime: file.mimetype };
}

export async function readExcursionImage(key) {
  if (!/^[0-9a-f-]{36}\.(jpg|png|webp)$/i.test(String(key))) return null;
  const result = await client().downloadAsBytes(key);
  if (!result.ok) return null;
  const value = Array.isArray(result.value) ? result.value[0] : result.value;
  return Buffer.isBuffer(value) ? value : Buffer.from(value);
}

export async function deleteExcursionImage(key) {
  if (!/^[0-9a-f-]{36}\.(jpg|png|webp)$/i.test(String(key))) return;
  const result = await client().delete(key, { ignoreNotFound: true });
  if (!result.ok) console.error("Uma foto antiga não pôde ser removida do App Storage.");
}
