import { Component, ErrorInfo, ReactNode } from 'react';

interface Props {
  children: ReactNode;
  layerType?: string;
  fallback?: ReactNode;
}

interface State {
  hasError: boolean;
  error?: Error;
}

/**
 * Isolates runtime rendering errors within individual AST layers or shapes
 * so that a single malformed component never crashes the entire composition,
 * timeline preview, or headless Remotion render pipeline.
 */
export class ASTErrorBoundary extends Component<Props, State> {
  public state: State = {
    hasError: false,
  };

  public static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  public componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.warn(
      `[ASTErrorBoundary] Caught render error in AST layer (${this.props.layerType || 'unknown'}):`,
      error.message,
      errorInfo
    );
  }

  public render() {
    if (this.state.hasError) {
      return this.props.fallback ?? null;
    }
    return this.props.children;
  }
}
