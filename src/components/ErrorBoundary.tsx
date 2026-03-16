import { Component, ReactNode } from "react";

interface Props {
  children: ReactNode;
}

interface State {
  hasError: boolean;
  error: string;
}

export default class ErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false, error: "" };
  }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error: error.message };
  }

  componentDidCatch(error: Error) {
    console.error("OmWhisper UI error:", error);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div
          className="min-h-screen flex items-center justify-center"
          style={{ background: "#0a0f0d" }}
        >
          <div className="text-center max-w-sm px-8">
            <div className="text-4xl mb-4 opacity-30">ॐ</div>
            <h2
              className="text-white/70 font-semibold mb-2"
              style={{ fontFamily: "'DM Sans', sans-serif" }}
            >
              Something went wrong
            </h2>
            <p
              className="text-white/50 text-sm mb-6 leading-relaxed"
              style={{ fontFamily: "'DM Sans', sans-serif" }}
            >
              {this.state.error || "An unexpected error occurred."}
            </p>
            <button
              onClick={() => this.setState({ hasError: false, error: "" })}
              className="px-6 py-2.5 rounded-xl bg-emerald-500 text-black text-sm font-semibold hover:bg-emerald-400 transition-colors cursor-pointer"
              style={{ fontFamily: "'DM Sans', sans-serif" }}
            >
              Try Again
            </button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}
