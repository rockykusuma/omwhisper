import { render, screen, waitFor } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { invoke } from "@tauri-apps/api/core";
import StatsCard from "./StatsCard";
import type { UsageStats } from "../types";

vi.mock("@tauri-apps/api/core");

const mockInvoke = vi.mocked(invoke);

const baseStats: UsageStats = {
  total_recordings: 10,
  total_duration_seconds: 3661,
  total_words: 999,
  recordings_today: 3,
  streak_days: 2,
};

beforeEach(() => {
  mockInvoke.mockReset();
});

describe("StatsCard", () => {
  it("renders nothing when invoke fails", async () => {
    mockInvoke.mockRejectedValue(new Error("backend unavailable"));
    const { container } = render(<StatsCard />);
    await waitFor(() => expect(mockInvoke).toHaveBeenCalled());
    expect(container.firstChild).toBeNull();
  });

  it("renders nothing when total_recordings is 0", async () => {
    mockInvoke.mockResolvedValue({ ...baseStats, total_recordings: 0 });
    const { container } = render(<StatsCard />);
    await waitFor(() => expect(mockInvoke).toHaveBeenCalled());
    expect(container.firstChild).toBeNull();
  });

  it("renders recording count formatted as integer", async () => {
    mockInvoke.mockResolvedValue(baseStats);
    render(<StatsCard />);
    await waitFor(() => expect(screen.getByText("10")).toBeInTheDocument());
    expect(screen.getByText("recordings")).toBeInTheDocument();
  });

  it("formats large recording count with k suffix", async () => {
    mockInvoke.mockResolvedValue({ ...baseStats, total_recordings: 1500 });
    render(<StatsCard />);
    await waitFor(() => expect(screen.getByText("1.5k")).toBeInTheDocument());
  });

  it("formats duration as hours and minutes when >= 1 hour", async () => {
    // 3661 seconds = 1h 1m
    mockInvoke.mockResolvedValue(baseStats);
    render(<StatsCard />);
    await waitFor(() => expect(screen.getByText("1h 1m")).toBeInTheDocument());
  });

  it("formats duration as minutes when < 1 hour", async () => {
    mockInvoke.mockResolvedValue({ ...baseStats, total_duration_seconds: 125 });
    render(<StatsCard />);
    await waitFor(() => expect(screen.getByText("2m")).toBeInTheDocument());
  });

  it("formats duration as seconds when < 1 minute", async () => {
    mockInvoke.mockResolvedValue({ ...baseStats, total_duration_seconds: 45 });
    render(<StatsCard />);
    await waitFor(() => expect(screen.getByText("45s")).toBeInTheDocument());
  });

  it("renders word count", async () => {
    mockInvoke.mockResolvedValue(baseStats);
    render(<StatsCard />);
    await waitFor(() => expect(screen.getByText("999")).toBeInTheDocument());
    expect(screen.getByText("words")).toBeInTheDocument();
  });

  it("renders today count", async () => {
    mockInvoke.mockResolvedValue(baseStats);
    render(<StatsCard />);
    await waitFor(() => expect(screen.getByText("3")).toBeInTheDocument());
    expect(screen.getByText("today")).toBeInTheDocument();
  });

  it("shows streak when streak_days > 1", async () => {
    mockInvoke.mockResolvedValue({ ...baseStats, streak_days: 5 });
    render(<StatsCard />);
    await waitFor(() => expect(screen.getByText("day streak")).toBeInTheDocument());
  });

  it("hides streak when streak_days is 1", async () => {
    mockInvoke.mockResolvedValue({ ...baseStats, streak_days: 1 });
    render(<StatsCard />);
    await waitFor(() => expect(mockInvoke).toHaveBeenCalled());
    expect(screen.queryByText("day streak")).not.toBeInTheDocument();
  });

  it("calls get_usage_stats on mount", async () => {
    mockInvoke.mockResolvedValue(baseStats);
    render(<StatsCard />);
    await waitFor(() => expect(mockInvoke).toHaveBeenCalledWith("get_usage_stats"));
  });

  it("reloads stats when refreshTrigger changes", async () => {
    mockInvoke.mockResolvedValue(baseStats);
    const { rerender } = render(<StatsCard refreshTrigger={0} />);
    await waitFor(() => expect(mockInvoke).toHaveBeenCalledTimes(1));

    rerender(<StatsCard refreshTrigger={1} />);
    await waitFor(() => expect(mockInvoke).toHaveBeenCalledTimes(2));
  });
});
