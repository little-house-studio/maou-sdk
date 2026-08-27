import { createRoot } from "react-dom/client";
import { App } from "./App";
import "./fonts.css";
import "./styles.css";

const el = document.getElementById("root");
if (el) {
  createRoot(el).render(<App />);
}
