import React from 'react';

interface ErrorBoundaryState {
  hasError: boolean;
  message: string;
}

export class ErrorBoundary extends React.Component<
  { children: React.ReactNode },
  ErrorBoundaryState
> {
  constructor(props: { children: React.ReactNode }) {
    super(props);
    this.state = { hasError: false, message: '' };
  }

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return {
      hasError: true,
      message: error.message || 'An unexpected error occurred.',
    };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo): void {
    console.error('Exvis Beatz ErrorBoundary:', error, info);
  }

  render() {
    if (this.state.hasError) {
      let parsedMessage = this.state.message;
      try {
        const parsed = JSON.parse(this.state.message) as { error?: string; path?: string };
        if (parsed.error) {
          parsedMessage = `${parsed.error}${parsed.path ? ` (${parsed.path})` : ''}`;
        }
      } catch {
        // Use raw message
      }

      return (
        <div className="min-h-screen bg-[#0B0B0D] text-[#F5F4F0] flex items-center justify-center p-6">
          <div className="max-w-lg w-full border border-white/10 bg-[#131316] rounded-xl p-8">
            <h2 className="text-xl font-semibold text-[#F5F4F0] mb-2">
              Studio Session Interrupted
            </h2>
            <p className="text-sm text-[#9C9A94] mb-6 leading-relaxed">
              {parsedMessage}
            </p>
            <button
              type="button"
              onClick={() => this.setState({ hasError: false, message: '' })}
              className="px-4 py-2 text-sm font-medium bg-[#D99B38] text-[#0B0B0D] rounded-lg hover:bg-[#E5A946] transition-colors cursor-pointer"
            >
              Return to Storefront
            </button>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}
