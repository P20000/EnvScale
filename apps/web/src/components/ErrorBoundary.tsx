import { Component, type ErrorInfo, type ReactNode } from "react";
import { Error500ServerCrash } from "./errors/Error500ServerCrash";

interface ErrorBoundaryProps {
  children: ReactNode;
}

interface ErrorBoundaryState {
  hasError: boolean;
  error: Error | null;
}

export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  state: ErrorBoundaryState = { hasError: false, error: null };

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error("[EnvScale] Unhandled React application error:", error, errorInfo);
  }

  handleRetry = () => {
    this.setState({ hasError: false, error: null });
  };

  handleSafeReload = () => {
    try {
      localStorage.removeItem("envscale-topology-storage");
      sessionStorage.clear();
    } catch {
      // Ignore cache clearing errors
    }
    window.location.reload();
  };

  render() {
    if (!this.state.hasError) return this.props.children;

    return (
      <main className="flex min-h-screen w-screen items-center justify-center bg-[#111318]">
        <Error500ServerCrash
          errorId={`UI-CRASH-${Date.now().toString(36).toUpperCase()}`}
          errorMessage={this.state.error?.message || "An unexpected rendering error occurred in the application canvas."}
          retryAction={this.handleRetry}
          onSafeReload={this.handleSafeReload}
        />
      </main>
    );
  }
}