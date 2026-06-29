import type { Express } from "express";
import type { Server } from "http";
import { storage } from "./storage";
import { api } from "@shared/routes";
import Stripe from "stripe";
import express from "express";
import { createClient } from "@supabase/supabase-js";
import { WebSocketServer, WebSocket } from "ws";

// Session → WebSocket connection map (routes generation callbacks to the right browser tab)
const sessionClients = new Map<string, WebSocket>();
// projectId → sessionId map (populated when generate-logo fires, consumed by logo-callback)
const projectSession = new Map<string, string>();

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!, {
  apiVersion: "2026-01-28.clover",
});

const supabaseAdmin = createClient(
  process.env.VITE_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

const processedEvents = new Set<string>();

export async function registerRoutes(
  httpServer: Server,
  app: Express
): Promise<Server> {
  // --- WEBSOCKET SERVER ---
  const wss = new WebSocketServer({ noServer: true });

  httpServer.on("upgrade", (request, socket, head) => {
    const url = new URL(request.url!, `http://${request.headers.host}`);
    if (url.pathname === "/ws") {
      wss.handleUpgrade(request, socket as any, head, (ws) => {
        wss.emit("connection", ws, request);
      });
    }
    // Non-/ws upgrades (e.g. /vite-hmr) fall through to Vite's own listener.
  });

  wss.on("connection", (ws: WebSocket, request: any) => {
    const url = new URL(request.url!, `http://${request.headers.host}`);
    const sid = url.searchParams.get("sessionId") || "";
    if (sid) {
      sessionClients.set(sid, ws);
      console.log(`[ws] connected sid=${sid} total=${sessionClients.size}`);
    }
    ws.on("close", () => {
      if (sid) {
        sessionClients.delete(sid);
        console.log(`[ws] disconnected sid=${sid}`);
      }
    });
    ws.on("error", (err: Error) => {
      console.error(`[ws] error sid=${sid}:`, err.message);
    });
  });

  // --- STRIPE WEBHOOK (MUST BE FIRST) ---
  app.post(
    "/api/stripe-webhook",
    express.raw({ type: "application/json" }),
    async (req, res) => {
      const sig = req.headers["stripe-signature"] as string;
      let event: Stripe.Event;

      try {
        event = stripe.webhooks.constructEvent(
          req.body,
          sig,
          process.env.STRIPE_WEBHOOK_SECRET!
        );
      } catch (err: any) {
        console.error(`Webhook signature verification failed: ${err.message}`);
        return res.status(400).send(`Webhook Error: ${err.message}`);
      }

      if (processedEvents.has(event.id)) {
        return res.json({ received: true });
      }

      if (event.type === "checkout.session.completed") {
        const session = event.data.object as Stripe.Checkout.Session;
        const userId = session.metadata?.userId;
        const credits = Number(session.metadata?.credits || 0);
        const mode = session.mode;

        console.log("Webhook session.mode:", mode, "userId:", userId);

        if (userId) {
          try {
            // Always increment credits (for both payment and subscription modes)
            const { error: rpcError } = await supabaseAdmin.rpc("increment_credits", {
              uid: userId,
              amount: credits,
            });

            if (rpcError) {
              console.error("Supabase RPC credit increment failed:", rpcError);
              return res.status(500).json({ error: "Failed to update credits" });
            }

            // If this is a subscription purchase, save subscription data
            if (mode === "subscription" && session.customer && session.subscription) {
              console.log("Saving subscription data - customer:", session.customer, "subscription:", session.subscription);

              const { error: subError } = await supabaseAdmin
                .from("user_subscriptions")
                .upsert(
                  {
                    user_id: userId,
                    stripe_customer_id: session.customer,
                    stripe_subscription_id: session.subscription,
                    subscription_status: "active",
                  },
                  { onConflict: "user_id" }
                );

              if (subError) {
                console.error("Supabase subscription upsert failed:", subError);
                return res.status(500).json({ error: "Failed to save subscription data" });
              }

              console.log("Subscription data saved successfully");
            }
          } catch (error) {
            console.error("Critical error during checkout fulfillment:", error);
            return res.status(500).json({ error: "Internal server error during fulfillment" });
          }
        }
      } else if (event.type === "customer.subscription.updated" || event.type === "customer.subscription.deleted") {
        const subscription = event.data.object as Stripe.Subscription;
        const subscriptionId = subscription.id;
        const status = subscription.status;
        const cancelAtPeriodEnd = subscription.cancel_at_period_end;
        const cancelAt = subscription.cancel_at;
        const cancelAtDate = cancelAt ? new Date(cancelAt * 1000).toISOString() : null;

        console.log("Webhook subscription event:", event.type, "subscriptionId:", subscriptionId, "status:", status, "cancelAtPeriodEnd:", cancelAtPeriodEnd, "cancelAt RAW:", cancelAt, "cancelAtDate:", cancelAtDate);

        const updatePayload = {
          subscription_status: status,
          cancel_at_period_end: cancelAtPeriodEnd,
          cancel_at: cancelAtDate,
          updated_at: new Date().toISOString(),
        };

        console.log("Supabase update payload:", JSON.stringify(updatePayload));

        try {
          const { data: updateData, error: updateError } = await supabaseAdmin
            .from("user_subscriptions")
            .update(updatePayload)
            .eq("stripe_subscription_id", subscriptionId)
            .select();

          if (updateError) {
            console.error("Supabase subscription update FAILED:", JSON.stringify(updateError));
            // Do not return error - let webhook complete successfully
          } else {
            console.log("Supabase subscription update SUCCESS. Rows matched:", updateData?.length ?? 0, "data:", JSON.stringify(updateData));
          }
        } catch (error) {
          console.error("Error processing subscription event:", error);
          // Do not return error - let webhook complete successfully
        }
      }

      processedEvents.add(event.id);
      res.json({ received: true });
    }
  );

  // --- GLOBAL MIDDLEWARE FOR ALL OTHER ROUTES ---
  app.use(express.json());
  app.use(express.urlencoded({ extended: false }));

  // --- GENERATE LOGO PROXY ---
  // Buffers the browser's raw multipart/form-data body and forwards it
  // unchanged to the n8n webhook.
  // Query params ?sessionId=&projectId= are used to register the WS route
  // so the /api/logo-callback can push the result back to the right tab.
  app.post("/api/generate-logo", async (req, res) => {
    try {
      const apiUrl = process.env.VITE_API_BASE_URL;
      if (!apiUrl) {
        return res.status(500).json({ error: "VITE_API_BASE_URL is not configured" });
      }

      // Register session→project mapping for async WS delivery
      const wsSessionId = (req.query.sessionId as string) || "";
      const wsProjectId = (req.query.projectId as string) || "";
      if (wsSessionId && wsProjectId) {
        projectSession.set(wsProjectId, wsSessionId);
        console.log(`[proxy] registered session sid=${wsSessionId} pid=${wsProjectId}`);
      }

      // Mark project as generating in the database
      if (wsProjectId) {
        supabaseAdmin
          .from("projects")
          .update({ generation_status: "generating" })
          .eq("project_id", wsProjectId)
          .then(({ error }) => {
            if (error) console.error("[generate-logo] generation_status update error:", error.message);
          })
          .catch(console.error);
      }

      // Collect the raw stream — express.json() does not consume multipart bodies
      const chunks: Buffer[] = [];
      for await (const chunk of req) {
        chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
      }
      const rawBody = Buffer.concat(chunks);

      // Forward to n8n preserving the multipart boundary in Content-Type
      const upstream = await fetch(apiUrl, {
        method: "POST",
        headers: {
          "content-type": req.headers["content-type"] ?? "",
        },
        body: rawBody,
      });

      if (!upstream.ok) {
        console.error(`[proxy] n8n returned ${upstream.status}`);
        return res.status(upstream.status).json({ error: `Upstream error: ${upstream.status}` });
      }

      const data = await upstream.json();
      res.json(data);
    } catch (err: any) {
      console.error("[proxy] generate-logo error:", err.message);
      res.status(502).json({ error: "Failed to reach generation service" });
    }
  });

  // --- LOGO CALLBACK (called by n8n after async generation) ---
  // n8n posts the finished result here; we push it to the waiting browser tab via WS.
  app.post("/api/logo-callback", async (req, res) => {
    try {
      console.log("FULL CALLBACK DATA:", req.body);
      const { projectId, response, concept_1_title, concept_1_url, concept_2_title, concept_2_url } = req.body;

      if (!projectId) {
        console.warn("[callback] Missing projectId — returning 200 anyway");
        return res.json({ received: true, delivered: false, reason: "missing_projectId" });
      }

      // Persist to logo_gallery — look up user_id via project
      try {
        const { data: projectRow } = await supabaseAdmin
          .from("projects")
          .select("user_id")
          .eq("project_id", projectId)
          .single();

        const { error: insertError } = await supabaseAdmin.from("logo_gallery").insert({
          user_id: projectRow?.user_id ?? null,
          project_id: projectId,
          concept_1_title: concept_1_title || null,
          concept_1_url: concept_1_url || null,
          concept_2_title: concept_2_title || null,
          concept_2_url: concept_2_url || null,
        });
        if (insertError) console.error("[callback] logo_gallery insert error:", insertError.message);
        else console.log(`[callback] saved to logo_gallery pid=${projectId}`);

        // Deduct 10 credits from user_credits
        try {
          const { data: creditRow } = await supabaseAdmin
            .from("user_credits")
            .select("balance")
            .eq("user_id", projectRow?.user_id)
            .single();

          if (creditRow) {
            const newBalance = Math.max(0, creditRow.balance - 10);
            const { error: creditError } = await supabaseAdmin
              .from("user_credits")
              .update({ balance: newBalance })
              .eq("user_id", projectRow?.user_id);

            if (creditError) {
              console.error("[callback] credit deduction error:", creditError.message);
            } else {
              console.log(`[callback] deducted 10 credits from user=${projectRow?.user_id}, new balance=${newBalance}`);
            }
          } else {
            console.warn("[callback] no user_credits row found for user_id:", projectRow?.user_id);
          }
        } catch (creditErr: any) {
          console.error("[callback] credit deduction threw:", creditErr.message);
        }
      } catch (dbErr: any) {
        console.error("[callback] logo_gallery save failed:", dbErr.message);
      }

      const payload = JSON.stringify({
        type: "generation_complete",
        projectId,
        text: response || "",
        concept_1_title: concept_1_title || "",
        concept_1_url: concept_1_url || "",
        concept_2_title: concept_2_title || "",
        concept_2_url: concept_2_url || "",
      });

      const sid = projectSession.get(projectId);
      const ws = sid ? sessionClients.get(sid) : undefined;

      if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(payload);
        projectSession.delete(projectId);
        console.log(`[callback] delivered via WS sid=${sid} pid=${projectId}`);
        res.json({ received: true, delivered: true });
      } else {
        console.warn(`[callback] no open WS for pid=${projectId} sid=${sid ?? "none"} — returning 200`);
        if (sid) projectSession.delete(projectId);
        res.json({ received: true, delivered: false, reason: "no_open_ws" });
      }
    } catch (err: any) {
      console.error("[callback] error:", err.message);
      res.status(500).json({ error: "Internal server error" });
    } finally {
      const { projectId } = req.body;
      if (projectId) {
        supabaseAdmin
          .from("projects")
          .update({ generation_status: "completed" })
          .eq("project_id", projectId)
          .then(({ error }) => {
            if (error) console.error("[callback] generation_status clear error:", error.message);
          })
          .catch(console.error);
      }
    }
  });

  app.get(api.health.path, (req, res) => {
    res.json({ status: "ok" });
  });

  app.post("/api/delete-account", async (req, res) => {
    try {
      const { userId } = req.body;

      if (!userId || typeof userId !== "string") {
        return res.status(400).json({ error: "Missing or invalid userId" });
      }

      // Delete user from Supabase Auth using admin API
      // This will trigger database cascades to delete all related data
      const { error } = await supabaseAdmin.auth.admin.deleteUser(userId);

      if (error) {
        console.error("Failed to delete user:", error);
        return res.status(500).json({ error: "Failed to delete account" });
      }

      res.json({ success: true });
    } catch (err: any) {
      console.error("Delete account error:", err.message);
      res.status(500).json({ error: "Internal server error" });
    }
  });

  app.post("/api/check-subscription-cancel-at", async (req, res) => {
    try {
      const { userId } = req.body;

      if (!userId || typeof userId !== "string") {
        return res.status(400).json({ error: "User ID is required" });
      }

      const { data: subscription, error: queryError } = await supabaseAdmin
        .from("user_subscriptions")
        .select("cancel_at")
        .eq("user_id", userId)
        .maybeSingle();

      if (queryError) {
        console.error("Failed to query cancel_at:", queryError);
        return res.status(500).json({ error: "Failed to check subscription status" });
      }

      const hasSubscription = subscription !== null;
      res.json({ 
        has_subscription: hasSubscription,
        cancel_at: subscription?.cancel_at ?? null 
      });
    } catch (error: any) {
      console.error("Check cancel_at error:", error.message);
      res.status(500).json({ error: "Failed to check subscription status" });
    }
  });

  app.post("/api/create-billing-portal-session", async (req, res) => {
    try {
      const { userId } = req.body;

      if (!userId || typeof userId !== "string") {
        return res.status(400).json({ error: "User ID is required" });
      }

      // Query user_subscriptions to get stripe_customer_id
      const { data: subscription, error: queryError } = await supabaseAdmin
        .from("user_subscriptions")
        .select("stripe_customer_id, subscription_status")
        .eq("user_id", userId)
        .maybeSingle();

      if (queryError) {
        console.error("Failed to query subscriptions:", queryError);
        return res.status(500).json({ error: "Failed to create billing portal session" });
      }

      if (!subscription || !subscription.stripe_customer_id) {
        return res.status(404).json({ error: "No active subscription found" });
      }

      const portalSession = await stripe.billingPortal.sessions.create({
        customer: subscription.stripe_customer_id,
        return_url: "https://easypeasylogo.com/profile",
      });

      res.json({ url: portalSession.url });
    } catch (error: any) {
      console.error("Billing portal session error:", error.message);
      res.status(500).json({ error: "Failed to create billing portal session" });
    }
  });

  app.post("/api/create-checkout-session", async (req, res) => {
    console.log("CHECKOUT HIT");
    console.log("HEADERS:", req.headers["content-type"]);
    console.log("BODY RAW:", req.body);
    console.log("IS BUFFER:", Buffer.isBuffer(req.body));
    console.log("SUPABASE URL:", process.env.VITE_SUPABASE_URL);
    console.log("SERVICE ROLE EXISTS:", !!process.env.SUPABASE_SERVICE_ROLE_KEY);

    try {
      const { priceId, quantity, userId } = req.body;
      
      console.log("PRICE ID:", priceId);
      console.log("USER ID:", userId);
      console.log("QUANTITY:", quantity);

      if (!priceId || typeof priceId !== "string") {
        return res.status(400).json({ error: "Missing or invalid priceId" });
      }

      if (!userId || typeof userId !== "string") {
        return res.status(400).json({ error: "Missing or invalid userId" });
      }

      const PRICE_CREDIT_MAP: Record<string, number> = {
        // Top-Ups
        "price_1T2Rhc1ly8rEUw056M6TKESM": 100,
        "price_1T2Ri91ly8rEUw05q6nojIYC": 500,
        "price_1T2Rib1ly8rEUw05Yi2teTxQ": 1000,
        "price_1T2RbA1ly8rEUw057ADvOKGW": 100, // Starter Pack
        // Subscriptions
        "price_1T2Rk31ly8rEUw05ow0gBcXH": 200,
        "price_1T2Rkt1ly8rEUw05HUo3KYl1": 600,
        "price_1T2Rmr1ly8rEUw05KumYzkLY": 1200
      };

      const baseCredits = PRICE_CREDIT_MAP[priceId];
      if (!baseCredits) {
        return res.status(400).json({ error: "Invalid price mapping" });
      }

      const totalCredits = baseCredits * (quantity && quantity > 0 ? quantity : 1);

      let price: Stripe.Price;
      try {
        price = await stripe.prices.retrieve(priceId);
      } catch {
        return res.status(400).json({ error: "Invalid Stripe price ID" });
      }

      if (!price.active) {
        return res.status(400).json({ error: "Price is no longer active" });
      }

      const mode: Stripe.Checkout.SessionCreateParams["mode"] =
        price.type === "recurring" ? "subscription" : "payment";

      const origin = "https://easypeasylogo.com";

      try {
        const session = await stripe.checkout.sessions.create({
          mode,
          line_items: [
            {
              price: priceId,
              quantity: quantity && quantity > 0 ? quantity : 1,
            },
          ],
          metadata: {
            userId: userId,
            credits: totalCredits.toString(),
            priceId: priceId
          },
          success_url: `${origin}/success?session_id={CHECKOUT_SESSION_ID}`,
          cancel_url: `${origin}/checkout`,
        });

        console.log("SESSION CREATED:", session.url);
        res.json({ url: session.url });
      } catch (err: any) {
        console.error("STRIPE SESSION ERROR:", err);
        throw err;
      }
    } catch (err: any) {
      console.error("Stripe checkout error:", err.message);
      res.status(500).json({ error: err.message });
    }
  });

  return httpServer;
}
