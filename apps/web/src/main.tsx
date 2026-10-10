import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import { Inbox } from "./Inbox";
import "./styles.css";

try {
  if (!localStorage.getItem("theme")) localStorage.setItem("theme", "dark");
} catch {
  // Storage can be disabled; Mailpit then follows the OS theme.
}

const isInbox = window.location.pathname.replace(/\/+$/, "").endsWith("/console/inbox");

createRoot(document.getElementById("root")!).render(<StrictMode>{isInbox ? <Inbox /> : <App />}</StrictMode>);
