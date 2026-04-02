type ToastOptions = {
  title: string;
  description?: string;
  durationMs?: number;
  variant?: "info" | "success" | "warning" | "error";
};

export function showDashboardToast({
  title,
  description,
  durationMs = 3200,
  variant = "info",
}: ToastOptions) {
  if (typeof document === "undefined") return;
  const existing = document.querySelector(".dashboard-toast-container");
  const container = existing || (() => {
    const el = document.createElement("div");
    el.className = "dashboard-toast-container";
    document.body.appendChild(el);
    return el;
  })();

  const toast = document.createElement("div");
  toast.className = `dashboard-toast dashboard-toast--${variant}`;
  toast.innerHTML = `<strong>${title}</strong>${description ? `<span>${description}</span>` : ""}`;
  container.appendChild(toast);

  requestAnimationFrame(() => toast.classList.add("show"));

  window.setTimeout(() => {
    toast.classList.remove("show");
    window.setTimeout(() => toast.remove(), 250);
  }, durationMs);
}
