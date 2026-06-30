import express, { Express } from "express";
import path from "path";
import fs from "fs";

export function serveStatic(app: Express) {
  // Use path.join to correctly find the directory from where the server runs
  const distPath = path.resolve(__dirname, "../../dist/public");

  if (!fs.existsSync(distPath)) {
    throw new Error(
      `Could not find the build directory: ${distPath}, make sure to build the client first`,
    );
  }

  // 1. Serve static files (CSS, JS, images)
  app.use(express.static(distPath));

  // 2. The Catch-all: Send index.html for any request that isn't an API route
  app.get("*", (req, res, next) => {
    // If the request is for the API, let it pass through
    if (req.path.startsWith("/api")) {
      return next();
    }
    // Otherwise, serve the frontend
    res.sendFile(path.join(distPath, "index.html"));
  });
}
