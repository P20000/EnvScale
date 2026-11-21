import React from "react";

export type ToastVariant = "default" | "success" | "error" | "warning" | "info";

export interface ToastAction {
  label: string;
  onClick: () => void;
}

export interface ToastItem {
  id: string;
  title?: React.ReactNode;
  description?: React.ReactNode;
  variant?: ToastVariant;
  duration?: number;
  action?: ToastAction;
}

type ToastListener = (toasts: ToastItem[]) => void;

class ToastManager {
  private toasts: ToastItem[] = [];
  private listeners: Set<ToastListener> = new Set();
  private timers: Map<string, ReturnType<typeof setTimeout>> = new Map();

  subscribe(listener: ToastListener) {
    this.listeners.add(listener);
    listener([...this.toasts]);
    return () => {
      this.listeners.delete(listener);
    };
  }

  private notify() {
    const copy = [...this.toasts];
    this.listeners.forEach((listener) => listener(copy));
  }

  show(options: Omit<ToastItem, "id"> & { id?: string }): string {
    const id = options.id || `toast-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    const duration = options.duration ?? (options.variant === "error" ? 6000 : 4000);

    // Remove existing if any
    this.dismiss(id);

    const toastItem: ToastItem = {
      ...options,
      id,
      duration,
    };

    // Keep at most 5 active toasts in buffer
    this.toasts = [toastItem, ...this.toasts].slice(0, 5);
    this.notify();

    if (duration > 0) {
      const timer = setTimeout(() => {
        this.dismiss(id);
      }, duration);
      this.timers.set(id, timer);
    }

    return id;
  }

  pause(id: string) {
    const timer = this.timers.get(id);
    if (timer) {
      clearTimeout(timer);
      this.timers.delete(id);
    }
  }

  resume(id: string, remainingDuration = 3000) {
    if (this.timers.has(id)) return;
    const timer = setTimeout(() => {
      this.dismiss(id);
    }, remainingDuration);
    this.timers.set(id, timer);
  }

  dismiss(id: string) {
    const timer = this.timers.get(id);
    if (timer) {
      clearTimeout(timer);
      this.timers.delete(id);
    }
    const prevLen = this.toasts.length;
    this.toasts = this.toasts.filter((t) => t.id !== id);
    if (this.toasts.length !== prevLen) {
      this.notify();
    }
  }

  clear() {
    this.timers.forEach((t) => clearTimeout(t));
    this.timers.clear();
    this.toasts = [];
    this.notify();
  }

  success(title: React.ReactNode, description?: React.ReactNode, duration?: number, action?: ToastAction) {
    return this.show({ title, description, variant: "success", duration, action });
  }

  error(title: React.ReactNode, description?: React.ReactNode, duration?: number, action?: ToastAction) {
    return this.show({ title, description, variant: "error", duration, action });
  }

  warning(title: React.ReactNode, description?: React.ReactNode, duration?: number, action?: ToastAction) {
    return this.show({ title, description, variant: "warning", duration, action });
  }

  info(title: React.ReactNode, description?: React.ReactNode, duration?: number, action?: ToastAction) {
    return this.show({ title, description, variant: "info", duration, action });
  }
}

export const toast = new ToastManager();
