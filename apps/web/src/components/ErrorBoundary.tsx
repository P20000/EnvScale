import { Component, type ErrorInfo, type ReactNode } from "react";
import { CircleAlert, RotateCcw } from "lucide-react";

import { Button } from "./ui/button";

interface ErrorBoundaryProps {
  children: ReactNode;
}

interface ErrorBoundaryState {
  hasError: boolean;
}

export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  state: ErrorBoundaryState = { hasError: false };

  static getDerivedStateFromError(): ErrorBoundaryState {
    return { hasError: true };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error("[EnvScale] Unhandled application error", error, errorInfo);
  }

  handleRetry = () => {
    this.setState({ hasError: false });
  };

  render() {
    if (!this.state.hasError) return this.props.children;

    return (
      <main className="flex min-h-screen w-screen items-center justify-center bg-[#09090b] px-6 text-neutral-100">
        <section
          role="alert"
          aria-labelledby="application-error-title"
          className="flex w-full max-w-md flex-col items-center gap-5 rounded-2xl border border-neutral-800 bg-[#141417] p-8 text-center shadow-2xl"
        >
          <div className="flex h-14 w-14 items-center justify-center rounded-xl border border-red-500/20 bg-red-500/10 text-red-400">
                <CircleAlert className="h-7 w-7" />
          </div>
          <div className="space-y-2">
            <h1 id="application-error-title" className="text-lg font-semibold text-neutral-100">
              Something went wrong
            </h1>
            <p className="text-sm leading-6 text-neutral-400">
              EnvScale could not render this view. Try again to return to the application.
            </p>
          </div>
          <Button type="button" onClick={this.handleRetry}>
                <RotateCcw aria-hidden="true" />
            Try again
          </Button>
        </section>
      </main>
    );
  }
}