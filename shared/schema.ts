import { sqliteTable, text, integer, customType } from "drizzle-orm/sqlite-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";
import { relations } from "drizzle-orm";

// === TABLE DEFINITIONS ===
export const users = sqliteTable("users", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  username: text("username").notNull().unique(),
  passwordHash: text("password_hash").notNull(),
  role: text("role", { enum: ["user", "admin"] }).notNull().default("user"),
  securityQuestion: text("security_question").notNull(),
  securityAnswer: text("security_answer").notNull(),
  createdAt: customType({
    dataType: () => 'TEXT',
    fromDriver: (value: string) => new Date(value),
    toDriver: (value: Date) => value.toISOString(),
  })('created_at').default(new Date().toISOString()),
});

export const analyses = sqliteTable("analyses", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  userId: integer("user_id").notNull().references(() => users.id),
  contentType: text("content_type", { enum: ["message", "profile"] }).notNull(),
  content: text("content").notNull(),
  riskScore: integer("risk_score").notNull(),
  flags: text("flags", { mode: 'json' }).$type<string[]>().notNull(),
  explanation: text("explanation").notNull(),
  // Heuristic Analysis Data (Client-Side)
  structuralRisk: integer("structural_risk"),
  contentRisk: integer("content_risk"),
  behavioralRisk: integer("behavioral_risk"),
  photoRisk: integer("photo_risk"),
  heuristics: text("heuristics", { mode: 'json' }).$type<Record<string, any>>(),
  // Server-Side Deep Analysis
  anomalyScore: integer("anomaly_score"),
  anomalyFlags: text("anomaly_flags", { mode: 'json' }).$type<string[]>(),
  historicalComparison: text("historical_comparison", { mode: 'json' }).$type<Record<string, any>>(),
  modelConfidence: integer("model_confidence"),
  riskClassification: text("risk_classification"), // "bot-like", "scam", "manipulation", "harassment", "fake-engagement", "safe"
  createdAt: customType({
    dataType: () => 'TEXT',
    fromDriver: (value: string) => new Date(value),
    toDriver: (value: Date) => value.toISOString(),
  })('created_at').default(new Date().toISOString()),
});

export const usersRelations = relations(users, ({ many }) => ({
  analyses: many(analyses),
}));

export const analysesRelations = relations(analyses, ({ one }) => ({
  user: one(users, {
    fields: [analyses.userId],
    references: [users.id],
  }),
}));



// === SCHEMAS ===
export const insertAnalysisSchema = createInsertSchema(analyses).omit({
  id: true,
  createdAt: true,
  userId: true, // Set by backend from session
  riskScore: true, // Calculated by AI
  flags: true,     // Calculated by AI
  explanation: true // Calculated by AI
});

export const analyzeRequestSchema = z.object({
  contentType: z.enum(["message", "profile"]),
  content: z.string().min(1, "Content is required"),
});

// === TYPES ===
export type User = typeof users.$inferSelect;
export type Analysis = typeof analyses.$inferSelect;
export type InsertAnalysis = z.infer<typeof insertAnalysisSchema>;
export type AnalyzeRequest = z.infer<typeof analyzeRequestSchema>;
