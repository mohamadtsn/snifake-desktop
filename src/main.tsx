import React from "react";
import ReactDOM from "react-dom/client";
import { MotionConfig } from "motion/react";
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
    {/* `user` makes every motion component drop transform and layout
        animation under prefers-reduced-motion while keeping opacity, which
        is the "gentler, not absent" contract in DESIGN.md 6.4. It does not
        cover the CSS animations in theme.css: those carry their own media
        block, and both are required. */}
    <MotionConfig reducedMotion="user">
      <App />
    </MotionConfig>
  </React.StrictMode>,
);
