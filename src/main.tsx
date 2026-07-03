import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import "./theme.css";

// Desktop app chrome, not a web page — no browser-style right-click menu
// except inside actual text inputs, where it's still useful (paste, etc).
window.addEventListener("contextmenu", (e) => {
  const target = e.target as HTMLElement;
  if (!target.closest("input, textarea")) {
    e.preventDefault();
  }
});

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
