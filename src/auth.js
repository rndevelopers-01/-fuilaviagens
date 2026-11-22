import express from "express";
import rateLimit from "express-rate-limit";
import { normalizeEmail, safeTextEqual } from "./security.js";

export const authRouter = express.Router();

const loginLimit = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 8,
  standardHeaders: "draft-8",
  legacyHeaders: false,
  message: { error: "Muitas tentativas. Aguarde alguns minutos e tente novamente." },
});

authRouter.get("/session", (req, res) => {
  res.set("Cache-Control", "no-store");
  res.json({
    authenticated: req.session?.staff === true,
    email: req.session?.staff === true ? process.env.STAFF_EMAIL : null,
  });
});

authRouter.post("/login", loginLimit, requireSameOrigin, async (req, res, next) => {
  try {
    const configuredEmail = process.env.STAFF_EMAIL;
    const configuredPassword = process.env.STAFF_PASSWORD;
    if (!configuredEmail || !configuredPassword) {
      return res.status(503).json({
        error: "O acesso da equipe ainda não foi configurado nos Secrets do Replit.",
      });
    }

    const emailMatches = safeTextEqual(
      normalizeEmail(req.body?.email),
      normalizeEmail(configuredEmail)
    );
    const passwordMatches = safeTextEqual(
      String(req.body?.password || ""),
      configuredPassword
    );
    if (!emailMatches || !passwordMatches) {
      return res.status(401).json({ error: "E-mail ou senha incorretos." });
    }

    await new Promise((resolve, reject) => {
      req.session.regenerate((error) => error ? reject(error) : resolve());
    });
    req.session.staff = true;
    await new Promise((resolve, reject) => {
      req.session.save((error) => error ? reject(error) : resolve());
    });
    res.set("Cache-Control", "no-store");
    res.json({ authenticated: true });
  } catch (error) {
    next(error);
  }
});

authRouter.post("/logout", requireSameOrigin, requireStaff, async (req, res, next) => {
  try {
    await new Promise((resolve, reject) => {
      req.session.destroy((error) => error ? reject(error) : resolve());
    });
    res.clearCookie("fuila.staff", {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      path: "/",
    });
    res.json({ authenticated: false });
  } catch (error) {
    next(error);
  }
});

export function requireStaff(req, res, next) {
  res.set("Cache-Control", "no-store");
  if (req.session?.staff !== true) {
    return res.status(401).json({ error: "Entre na área da equipe para continuar." });
  }
  next();
}

export function requireSameOrigin(req, res, next) {
  const origin = req.get("origin");
  if (origin) {
    try {
      if (new URL(origin).host.toLowerCase() !== req.get("host")?.toLowerCase()) {
        return res.status(403).json({ error: "Origem da solicitação não permitida." });
      }
    } catch {
      return res.status(403).json({ error: "Origem da solicitação inválida." });
    }
  }
  next();
}
