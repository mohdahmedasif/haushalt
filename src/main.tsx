import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import { ConfigProvider, App as AntApp } from "antd";
import { App } from "./App";
import { AccessGate } from "./access";
import { antdTheme } from "./theme";
import "./index.css";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <ConfigProvider theme={antdTheme}>
      <AntApp>
        <BrowserRouter>
          <AccessGate>
            <App />
          </AccessGate>
        </BrowserRouter>
      </AntApp>
    </ConfigProvider>
  </StrictMode>,
);
