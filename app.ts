import express, { type Express } from "express";
import application from "./server/dist/app.js";

const app: Express = express();
app.use(application);

export default app;