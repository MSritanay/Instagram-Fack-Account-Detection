import { type Request, type Response, type NextFunction } from "express";
import jwt from "jsonwebtoken";

const isProduction = process.env.NODE_ENV === "production";
const JWT_SECRET = process.env.JWT_SECRET || (isProduction ? "" : "dev-only-jwt-secret-change-me-32chars");
if (!JWT_SECRET || JWT_SECRET.length < 32) {
  throw new Error("JWT_SECRET must be set and at least 32 characters long.");
}

export function isAuthenticated(req: Request, res: Response, next: NextFunction) {
  const token = req.headers.authorization?.split(" ")[1];

  if (!token) {
    return res.status(401).json({ message: "Unauthorized" });
  }

  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    (req as any).user = decoded;
    next();
  } catch (error) {
    return res.status(401).json({ message: "Unauthorized" });
  }
}

export function isAdmin(req: Request, res: Response, next: NextFunction) {
  const user = (req as any).user;

  if (user.role !== "admin") {
    return res.status(403).json({ message: "Forbidden" });
  }

  next();
}
