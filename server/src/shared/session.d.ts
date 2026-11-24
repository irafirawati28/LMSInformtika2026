import "express-session";

declare module "express-session" {
  interface SessionData {
    auth?: {
      userId: string;
      username: string;
      role: "TEACHER" | "STUDENT";
      authVersion: number;
    };
  }
}
