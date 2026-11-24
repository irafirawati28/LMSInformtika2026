import React from "react";
import { createRoot } from "react-dom/client";
import App from "./app/App";
import "./styles.css";

const rootElement = document.getElementById("root");

if (!rootElement) {
  throw new Error("Elemen root aplikasi tidak ditemukan.");
}

createRoot(rootElement).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
