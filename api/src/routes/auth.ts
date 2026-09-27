import { Router } from "express";
import { z } from "zod";
import rateLimit from "express-rate-limit";
import { login } from "../modules/auth/auth";

export const authRouter = Router();

const loginLimiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 10, standardHeaders: true, legacyHeaders: false });

const loginSchema = z.object({ email: z.string().email(), password: z.string().min(1) });

authRouter.post("/login", loginLimiter, async (req, res) => {
  const parsed = loginSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ message: "Invalid credentials" });

  const result = await login(parsed.data.email, parsed.data.password);
  if (!result) return res.status(401).json({ message: "Invalid email or password" });
  res.json(result);
});
