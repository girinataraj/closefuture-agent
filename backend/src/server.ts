import dotenv from "dotenv";
dotenv.config();

import express, { type Request, type Response } from "express";
import cors from "cors";
import chatRouter from "./routes/chat.js";
import sessionsRouter from "./routes/sessions.js";

const app = express();
const port = process.env.PORT || 4000;

const allowedOrigins = process.env.ALLOWED_ORIGINS
  ? process.env.ALLOWED_ORIGINS.split(",").map((o) => o.trim())
  : ["http://localhost:5173", "http://localhost:3000"];

app.use(
  cors({
    origin: (origin, callback) => {
      if (!origin || allowedOrigins.includes(origin)) {
        return callback(null, true);
      }
      return callback(new Error(`CORS policy blocked access from origin ${origin}`));
    },
    credentials: true,
  })
);

app.use(express.json());

app.get("/health", (_req: Request, res: Response) => {
  res.json({
    status: "ok",
    message: "CloseFuture Agent backend is running",
  });
});

app.use("/api/chat", chatRouter);
app.use("/api/sessions", sessionsRouter);

app.listen(port, () => {
  console.log(`Backend running at http://localhost:${port}`);
});
