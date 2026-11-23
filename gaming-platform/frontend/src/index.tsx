import React from "react";
import { createRoot } from "react-dom/client";
import { ToastContainer } from "react-toastify";
import "react-toastify/dist/ReactToastify.css";
import { BrowserRouter, Route, Routes } from "react-router-dom";

import "./index.scss";
import App from "./app";
import AuthPage from "./components/auth";
import { Provider } from "./context";

createRoot(document.getElementById("root") as HTMLElement).render(
  <BrowserRouter>
    <Provider>
      <Routes>
        <Route path="/login" element={<AuthPage mode="login" />} />
        <Route path="/register" element={<AuthPage mode="register" />} />
        <Route path="*" element={<App />} />
      </Routes>
      <ToastContainer position="top-center" theme="dark" />
    </Provider>
  </BrowserRouter>,
);
