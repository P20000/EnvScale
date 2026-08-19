import "dotenv/config";
import cookieParser from "cookie-parser";
import express from "express";
import { authRouter } from "./routes/auth.routes.js";

const app = express();
const port = Number(process.env.PORT ?? 3000);

app.use(express.json());
app.use(cookieParser());
app.get("/health", (_request, response) => {
  response.json({ status: "ok" });
});
app.use("/api/v1/auth", authRouter);

app.use((error: unknown, _request: express.Request, response: express.Response, _next: express.NextFunction) => {
  console.error(error);
  response.status(500).json({ error: "Internal server error" });
});

if (process.env.NODE_ENV !== "test") {
  app.listen(port, () => {
    console.log(`API server listening on port ${port}`);
  });
}

export default app;
