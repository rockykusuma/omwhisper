import { render, screen, fireEvent } from "@testing-library/react";
import { describe, it, expect, vi, afterAll } from "vitest";
import ErrorBoundary from "./ErrorBoundary";

// Suppress console.error for expected error boundary calls
const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});

afterAll(() => {
  consoleError.mockRestore();
});

function Bomb({ shouldThrow }: { shouldThrow: boolean }) {
  if (shouldThrow) throw new Error("Test error message");
  return <div>Normal content</div>;
}

describe("ErrorBoundary", () => {
  it("renders children when no error", () => {
    render(
      <ErrorBoundary>
        <Bomb shouldThrow={false} />
      </ErrorBoundary>
    );
    expect(screen.getByText("Normal content")).toBeInTheDocument();
  });

  it("renders error UI when child throws", () => {
    render(
      <ErrorBoundary>
        <Bomb shouldThrow={true} />
      </ErrorBoundary>
    );
    expect(screen.getByText("Something went wrong")).toBeInTheDocument();
    expect(screen.getByText("Test error message")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Try Again" })).toBeInTheDocument();
  });

  it("resets error state when Try Again is clicked", () => {
    const { rerender } = render(
      <ErrorBoundary>
        <Bomb shouldThrow={true} />
      </ErrorBoundary>
    );

    expect(screen.getByText("Something went wrong")).toBeInTheDocument();

    // Swap children to non-throwing BEFORE clicking Try Again so the
    // boundary re-render after setState doesn't throw again immediately.
    rerender(
      <ErrorBoundary>
        <Bomb shouldThrow={false} />
      </ErrorBoundary>
    );

    fireEvent.click(screen.getByRole("button", { name: "Try Again" }));

    expect(screen.getByText("Normal content")).toBeInTheDocument();
  });
});
