import "dotenv/config";
import express from "express";
import session from "express-session";
import connectMysql from "express-mysql-session";
import helmet from "helmet";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { mysqlPool, pool } from "./src/db.js";
import { authRouter } from "./src/auth.js";
import { marketplaceRouter, serveExcursionImage } from "./src/marketplace.js";
import { staffRouter } from "./src/staff-api.js";

const app = express();
const root = path.dirname(fileURLToPath(import.meta.url));
const MySQLStore = connectMysql(session);
const port = Number(process.env.PORT || 5000);

if (!process.env.SESSION_SECRET) {
  throw new Error("SESSION_SECRET não está configurado nos Secrets do Replit.");
}

app.disable("x-powered-by");
app.set("trust proxy", 1);
const contentSecurityPolicy = {
  defaultSrc: ["'self'"],
  baseUri: ["'self'"],
  objectSrc: ["'none'"],
  frameAncestors: ["'none'"],
  formAction: ["'self'", "https://www.mercadopago.com.br", "https://www.mercadopago.com"],
  scriptSrc: ["'self'"],
  styleSrc: ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com"],
  fontSrc: ["'self'", "https://fonts.gstatic.com", "data:"],
  imgSrc: ["'self'", "data:"],
  connectSrc: ["'self'"],
};
if (process.env.NODE_ENV === "production") {
  contentSecurityPolicy.upgradeInsecureRequests = [];
}

app.use(helmet({
  contentSecurityPolicy: { directives: contentSecurityPolicy },
  referrerPolicy: { policy: "no-referrer" },
}));
app.use(express.json({ limit: "64kb" }));
app.use(express.urlencoded({ extended: false, limit: "32kb" }));
app.use(session({
  name: "fuila.staff",
  secret: process.env.SESSION_SECRET,
  resave: false,
  saveUninitialized: false,
  store: new MySQLStore({
    schema: {
      tableName: "app_sessions",
      columnNames: {
        session_id: "sid",
        expires: "expire",
        data: "sess",
      },
    },
    clearExpired: true,
    checkExpirationInterval: 15 * 60 * 1000,
    expiration: 8 * 60 * 60 * 1000,
  }, mysqlPool),
  cookie: {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    maxAge: 8 * 60 * 60 * 1000,
    path: "/",
  },
}));

app.get("/api/health", async (_req, res) => {
  try {
    await pool.query("SELECT 1");
    res.json({ ok: true });
  } catch {
    res.status(503).json({ ok: false });
  }
});

app.use("/api/auth", authRouter);
app.use("/api/staff", staffRouter);
app.use("/api", marketplaceRouter);
app.get("/media/:key", serveExcursionImage);

app.use("/images", express.static(path.join(root, "images"), {
  index: false,
  dotfiles: "deny",
  maxAge: "1d",
}));
app.get("/styles.css", (_req, res) => res.sendFile(path.join(root, "styles.css")));
app.get("/script.js", (_req, res) => res.sendFile(path.join(root, "script.js")));
app.get("/staff.css", (_req, res) => res.sendFile(path.join(root, "staff.css")));
app.get("/staff.js", (_req, res) => res.sendFile(path.join(root, "staff.js")));
app.get("/favicon.ico", (_req, res) => res.sendFile(path.join(root, "favicon.ico")));
app.get("/favicon.svg", (_req, res) => res.sendFile(path.join(root, "images", "favicon.svg")));

function sendPage(res, filename, noIndex = false) {
  res.set({
    "Cache-Control": "no-store",
    "X-Robots-Tag": noIndex ? "noindex, nofollow" : "index, follow",
  });
  res.sendFile(path.join(root, filename));
}

app.get(["/", "/payment/return"], (_req, res) => sendPage(res, "index.html"));
app.get(["/staff", "/staff/"], (_req, res) => sendPage(res, "staff.html", true));
app.get("/privacidade", (_req, res) => sendPage(res, "privacy.html"));

app.use((req, res) => {
  if (req.path.startsWith("/api/")) return res.status(404).json({ error: "Endereço não encontrado." });
  res.status(404).send("Página não encontrada.");
});


app.use((error, req, res, _next) => {
  console.error(`Erro em ${req.method} ${req.path}:`, error);

  if (error?.name === "MulterError") {
    const message = error.code === "LIMIT_FILE_SIZE"
      ? "A foto precisa ter até 5 MB."
      : "Não foi possível receber essa foto.";

    return res.status(400).json({ error: message });
  }

  if (req.path.startsWith("/api/")) {
    return res.status(500).json({
      error: "Não foi possível concluir a solicitação."
    });
  }

  res.status(500).send("Não foi possível abrir esta página.");
});


const server = app.listen(port, "0.0.0.0", () => {
  console.log(`Fui Lá Excursões disponível na porta ${port}.`);
});

function shutdown() {
  server.close(() => {
    pool.end().finally(() => process.exit(0));
  });
  setTimeout(() => process.exit(1), 10_000).unref();
}

process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);
