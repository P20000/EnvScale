import { Router } from "express";
import { register, login, refresh, me } from "../controllers/auth.controller.js";
import { requireAuth } from "../middleware/auth.middleware.js";
import { validate } from "../middleware/validate.js";
import { credentialsSchema, registerSchema } from "../schemas/request.schemas.js";

export const authRouter: Router = Router();

authRouter.post("/register", validate("body", registerSchema, "Invalid registration data"), register);
authRouter.post("/login", validate("body", credentialsSchema, "Invalid login data"), login);
authRouter.post("/refresh", refresh);
authRouter.get("/me", requireAuth, me);