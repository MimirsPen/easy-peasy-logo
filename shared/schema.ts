import { pgTable, text, serial, boolean, integer, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";

export const users = pgTable("users", {
  id: serial("id").primaryKey(),
  username: text("username").notNull().unique(),
  isAdmin: boolean("is_admin").default(false),
});

export const userCredits = pgTable("user_credits", {
  id: serial("id").primaryKey(),
  userId: text("user_id").notNull().unique(),
  balance: integer("balance").notNull().default(0),
  hasPurchased: boolean("has_purchased").notNull().default(false),
  updatedAt: timestamp("updated_at").defaultNow(),
});

export const userSubscriptions = pgTable("user_subscriptions", {
  id: serial("id").primaryKey(),
  userId: text("user_id").notNull().unique(),
  stripeCustomerId: text("stripe_customer_id").notNull(),
  stripeSubscriptionId: text("stripe_subscription_id").notNull(),
  subscriptionStatus: text("subscription_status").notNull().default("active"),
  cancelAtPeriodEnd: boolean("cancel_at_period_end").notNull().default(false),
  cancelAt: timestamp("cancel_at"),
  updatedAt: timestamp("updated_at").defaultNow(),
});

export const insertUserSchema = createInsertSchema(users).omit({ id: true });
export const insertUserCreditsSchema = createInsertSchema(userCredits).omit({ id: true });
export const insertUserSubscriptionsSchema = createInsertSchema(userSubscriptions).omit({ id: true });

export type User = typeof users.$inferSelect;
export type InsertUser = z.infer<typeof insertUserSchema>;
export type UserCredits = typeof userCredits.$inferSelect;
export type InsertUserCredits = z.infer<typeof insertUserCreditsSchema>;
export type UserSubscriptions = typeof userSubscriptions.$inferSelect;
export type InsertUserSubscriptions = z.infer<typeof insertUserSubscriptionsSchema>;
