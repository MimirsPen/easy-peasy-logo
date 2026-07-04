import express, { type Request, Response, NextFunction } from "express";
import { registerRoutes } from "../api/routes";
import { serveStatic } from "./static";
import { createServer } from "http";

const app = express();
const httpServer = createServer(app);

declare module "http" {
  interface IncomingMessage {
    rawBody: unknown;
  }
}

// 1. Logging and tracing first
export function log(message: string, source = "express") {
  const formattedTime = new Date().toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
    second: "2-digit",
    hour12: true,
  });

  console.log(`${formattedTime} [${source}] ${message}`);
}

app.use((req, res, next) => {
  console.log("REQ", req.method, req.url);
  const start = Date.now();
  const path = req.path;
  let capturedJsonResponse: Record<string, any> | undefined = undefined;

  const originalResJson = res.json;
  res.json = function (bodyJson: any) {
    capturedJsonResponse = bodyJson;
    return originalResJson.call(res, bodyJson);
  };

  const originalEnd = res.end;
  res.end = function (chunk?: any, encoding?: any, cb?: any) {
    const duration = Date.now() - start;
    console.log("RES", req.method, req.url, res.statusCode, res.getHeader("content-type") || "");
    
    if (path.startsWith("/api")) {
      let logLine = `${req.method} ${path} ${res.statusCode} in ${duration}ms`;
      if (capturedJsonResponse) {
        logLine += ` :: ${JSON.stringify(capturedJsonResponse)}`;
      }
      log(logLine);
    }
    return originalEnd.call(res, chunk, encoding, cb);
  };

  next();
});

process.on("uncaughtException", (err) => {
  console.error("[crash] Uncaught exception:", err);
});

process.on("unhandledRejection", (reason) => {
  console.error("[crash] Unhandled promise rejection:", reason);
});

process.on("SIGTERM", () => {
  console.log("SIGTERM RECEIVED");
  process.exit(0);
});

process.on("SIGINT", () => {
  console.log("SIGINT RECEIVED");
  process.exit(0);
});

process.on("SIGHUP", () => {
  console.log("SIGHUP RECEIVED");
  process.exit(0);
});

setInterval(() => {
  console.log("MEM", JSON.stringify(process.memoryUsage()));
}, 5000);

(async () => {
  // 2. Register routes
  // IMPORTANT: The webhook route must be registered BEFORE the global express.json()
  // middleware so it can receive the raw body for signature verification.
  // We handle this inside registerRoutes by ensuring it's the first route defined.
  await registerRoutes(httpServer, app);

  app.use((err: any, _req: Request, res: Response, next: NextFunction) => {
    const status = err.status || err.statusCode || 500;
    const message = err.message || "Internal Server Error";

    console.error("Internal Server Error:", err);

    if (res.headersSent) {
      return next(err);
    }

    return res.status(status).json({ message });
  });

  // importantly only setup vite in development and after
  // setting up all the other routes so the catch-all route
  // doesn't interfere with the other routes
  if (process.env.NODE_ENV === "production") {
    serveStatic(app);
  } else {
    const { setupVite } = await import("./vite");
    await setupVite(httpServer, app);
  }

  // ALWAYS serve the app on the port specified in the environment variable PORT
  // Other ports are firewalled. Default to 5000 if not specified.
  // this serves both the API and the client.
  // It is the only port that is not firewalled.
  const port = parseInt(process.env.PORT || "5000", 10);
  httpServer.listen(
    {
      port,
      host: "0.0.0.0",
      reusePort: true,
    },
    () => {
      log(`serving on port ${port}`);
      log(`startup NODE_ENV=${process.env.NODE_ENV} PORT=${port}`);
    },
  );
})().catch((err) => {
  console.error("[crash] Server startup failed:", err);
  process.exit(1);
});

export { app };
