import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "./css/base.css";

const root = document.getElementById("root");
if (root === null) throw new Error("#root is missing from index.html");

createRoot(root).render(
  <StrictMode>
    <p data-testid="scaffold">react scaffold</p>
  </StrictMode>,
);
