import type { NextFunction, Request, Response } from "express";
import { requireAuthenticated, type AuthenticatedUser } from "./require-auth.js";

export const requireTeacher = (
  request: Request,
  response: Response,
  next: NextFunction,
): void => {
  requireAuthenticated(request, response, (error?: unknown) => {
    if (error) {
      next(error);
      return;
    }

    const user = response.locals.authUser as AuthenticatedUser | undefined;
    if (!user) {
      return;
    }
    if (user.role !== "TEACHER") {
      response.status(403).json({ error: "Fitur ini hanya dapat diakses guru." });
      return;
    }
    next();
  });
};
