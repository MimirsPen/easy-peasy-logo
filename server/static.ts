import express, { Express } from "express";
import path from "path";
import fs from "fs";

export function serveStatic(app: Express) {
  // Use path.join to correctly find the directory from where the server runs
  const distPath = path.resolve(__dirname, "../../dist/public");

  // ADDED DEBUG LOG: This will show up in your Vercel Function Logs
  console.log("DEBUG: Checking for build directory at:", distPath);

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
    const indexPath = path.join(distPath, "index.html");
    console.log("DEBUG: Serving index.html from:", indexPath);
    
    res.sendFile(indexPath);
  });
}
