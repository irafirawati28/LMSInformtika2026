import type { NextFunction, Request, Response } from "express";
import { appConfig } from "../config/app-config.js";

const safeMethods = new Set(["GET", "HEAD", "OPTIONS"]);

export const csrfProtection = (
  request: Request,
  response: Response,
  next: NextFunction,
): void => {
  if (safeMethods.has(request.method)) {
    next();
    return;
  }

  const origin = request.get("origin");
  const requestOrigin = `${request.protocol}://${request.get("host")}`;
  const isVercel = Boolean(origin && origin.endsWith(".vercel.app"));
  if (origin && origin !== appConfig.frontendOrigin && origin !== requestOrigin && !isVercel) {
    response.status(403).json({ error: "Origin permintaan tidak diizinkan." });
    return;
  }

  next();
};
