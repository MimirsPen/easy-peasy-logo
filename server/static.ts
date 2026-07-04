import express, { Express } from "express";

export function serveStatic(app: Express) {
  // We are letting Vercel handle all static file routing 
  // via vercel.json, so this function stays empty.
}