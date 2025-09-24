"use client";

import * as React from "react";
import { Component, ErrorInfo, ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { AlertTriangle, RefreshCw, Home, Bug } from "lucide-react";
import { cn } from "@/lib/utils";

interface Props {
  children: ReactNode;
  fallback?: ReactNode;
  variant?: 'inline' | 'card' | 'page'; // Different display styles
  showErrorDetails?: boolean; // Show error details in development
  onError?: (error: Error, errorInfo: ErrorInfo) => void; // Custom error handler
  resetKeys?: Array<string | number>; // Keys that trigger reset when changed
}

interface State {
  hasError: boolean;
  error?: Error;
  errorInfo?: ErrorInfo;
  errorId: string;
}

class ErrorBoundary extends Component<Props, State> {
  private resetTimeoutId: number | null = null;

  public state: State = {
    hasError: false,
    errorId: '',
  };

  public static getDerivedStateFromError(error: Error): State {
    return {
      hasError: true,
      error,
      errorId: `error-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`
    };
  }

  public componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    // Log error for monitoring/analytics
    console.error("ErrorBoundary caught an error:", {
      error: error.message,
      stack: error.stack,
      componentStack: errorInfo.componentStack,
      timestamp: new Date().toISOString(),
      errorId: this.state.errorId
    });

    // Call custom error handler if provided
    this.props.onError?.(error, errorInfo);

    // Store error info for display
    this.setState({ errorInfo });
  }

  public componentDidUpdate(prevProps: Props) {
    const { resetKeys } = this.props;
    const { resetKeys: prevResetKeys } = prevProps;

    // Reset error boundary if resetKeys have changed
    if (resetKeys && prevResetKeys &&
        resetKeys.some((key, index) => key !== prevResetKeys[index])) {
      this.handleReset();
    }
  }

  public componentWillUnmount() {
    if (this.resetTimeoutId) {
      clearTimeout(this.resetTimeoutId);
    }
  }

  private handleReset = () => {
    this.setState({
      hasError: false,
      error: undefined,
      errorInfo: undefined,
      errorId: ''
    });
  };

  private handleReload = () => {
    window.location.reload();
  };

  private handleGoHome = () => {
    window.location.href = '/';
  };

  private renderInlineError = () => {
    const { error, errorId } = this.state;

    return (
      <Alert variant="destructive" className="m-2" role="alert" aria-labelledby={`error-title-${errorId}`}>
        <AlertTriangle className="h-4 w-4" />
        <AlertDescription className="flex items-center justify-between">
          <div id={`error-title-${errorId}`}>
            <strong>Something went wrong:</strong> {error?.message || 'An unexpected error occurred'}
          </div>
          <Button
            variant="outline"
            size="sm"
            onClick={this.handleReset}
            className="ml-2"
            aria-label="Try again to recover from error"
          >
            <RefreshCw className="h-4 w-4 mr-1" />
            Try again
          </Button>
        </AlertDescription>
      </Alert>
    );
  };

  private renderCardError = () => {
    const { error, errorId } = this.state;
    const { showErrorDetails } = this.props;

    return (
      <Card className="max-w-md mx-auto" role="alert" aria-labelledby={`error-title-${errorId}`}>
        <CardHeader>
          <CardTitle id={`error-title-${errorId}`} className="flex items-center gap-2 text-destructive">
            <AlertTriangle className="h-5 w-5" />
            Something went wrong
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="text-muted-foreground">
            {error?.message || 'An unexpected error occurred'}
          </p>

          <div className="flex gap-2">
            <Button onClick={this.handleReset} aria-label="Try again to recover from error">
              <RefreshCw className="h-4 w-4 mr-2" />
              Try again
            </Button>
            <Button variant="outline" onClick={this.handleReload} aria-label="Reload the page">
              Reload Page
            </Button>
          </div>

          {showErrorDetails && process.env.NODE_ENV === 'development' && error && (
            <details className="mt-4">
              <summary className="cursor-pointer text-sm text-muted-foreground hover:text-foreground">
                Error details (development only)
              </summary>
              <pre className="mt-2 text-xs bg-muted p-2 rounded overflow-auto">
                {error.stack}
              </pre>
            </details>
          )}
        </CardContent>
      </Card>
    );
  };

  private renderPageError = () => {
    const { error, errorId } = this.state;
    const { showErrorDetails } = this.props;

    return (
      <div className="min-h-screen flex items-center justify-center p-4 bg-background" role="main" aria-labelledby={`error-title-${errorId}`}>
        <Card className="max-w-lg w-full">
          <CardHeader className="text-center">
            <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-destructive/10">
              <AlertTriangle className="h-6 w-6 text-destructive" />
            </div>
            <CardTitle id={`error-title-${errorId}`} className="text-xl">
              Oops! Something went wrong
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-6 text-center">
            <p className="text-muted-foreground">
              We encountered an unexpected error. Don't worry, your data is safe.
            </p>

            {error && (
              <div className="text-sm text-muted-foreground bg-muted/50 p-3 rounded-md">
                {error.message}
              </div>
            )}

            <div className="flex flex-col sm:flex-row gap-3 justify-center">
              <Button onClick={this.handleReset} className="flex-1" aria-label="Try again to recover from error">
                <RefreshCw className="h-4 w-4 mr-2" />
                Try again
              </Button>
              <Button variant="outline" onClick={this.handleGoHome} className="flex-1" aria-label="Go back to home page">
                <Home className="h-4 w-4 mr-2" />
                Go Home
              </Button>
              <Button variant="ghost" onClick={this.handleReload} className="flex-1" aria-label="Reload the page">
                <Bug className="h-4 w-4 mr-2" />
                Reload
              </Button>
            </div>

            {showErrorDetails && process.env.NODE_ENV === 'development' && error && (
              <details className="text-left">
                <summary className="cursor-pointer text-sm text-muted-foreground hover:text-foreground">
                  Technical details
                </summary>
                <div className="mt-2 space-y-2">
                  <div className="text-xs bg-muted p-2 rounded">
                    <strong>Error ID:</strong> {errorId}
                  </div>
                  <pre className="text-xs bg-muted p-2 rounded overflow-auto max-h-32">
                    {error.stack}
                  </pre>
                </div>
              </details>
            )}
          </CardContent>
        </Card>
      </div>
    );
  };

  public render() {
    if (this.state.hasError) {
      if (this.props.fallback) {
        return this.props.fallback;
      }

      const { variant = 'card' } = this.props;

      switch (variant) {
        case 'inline':
          return this.renderInlineError();
        case 'page':
          return this.renderPageError();
        case 'card':
        default:
          return this.renderCardError();
      }
    }

    return this.props.children;
  }
}

export default ErrorBoundary;
