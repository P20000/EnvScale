import React from "react";

export type ToastVariant = "default" | "success" | "error" | "warning" | "info";

export interface ToastItem {
  id: string;
  title?: React.ReactNode;
  description?: React.ReactNode;
  variant?: ToastVariant;
  duration?: number;
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
    const duration = options.duration ?? 4500;

    // Remove existing if any
    this.dismiss(id);

    const toastItem: ToastItem = {
      ...options,
      id,
    };

    // Keep at most 5 active toasts
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

  success(title: React.ReactNode, description?: React.ReactNode, duration?: number) {
    return this.show({ title, description, variant: "success", duration });
  }

  error(title: React.ReactNode, description?: React.ReactNode, duration?: number) {
    return this.show({ title, description, variant: "error", duration });
  }

  warning(title: React.ReactNode, description?: React.ReactNode, duration?: number) {
    return this.show({ title, description, variant: "warning", duration });
  }

  info(title: React.ReactNode, description?: React.ReactNode, duration?: number) {
    return this.show({ title, description, variant: "info", duration });
  }
}

export const toast = new ToastManager();
