import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, it, expect, vi, beforeEach } from "vitest";
import TipsSection from "./TipsSection";

const mockNavigate = vi.fn();

beforeEach(() => {
  mockNavigate.mockReset();
});

describe("TipsSection", () => {
  it("renders all 7 tips", () => {
    render(<TipsSection onNavigate={mockNavigate} />);
    expect(screen.getByText("Speed vs accuracy")).toBeInTheDocument();
    expect(screen.getByText("Multilingual")).toBeInTheDocument();
    expect(screen.getByText("Smart Dictation")).toBeInTheDocument();
    expect(screen.getByText("Custom Vocabulary")).toBeInTheDocument();
    expect(screen.getByText("Word Replacements")).toBeInTheDocument();
    expect(screen.getByText("Push-to-Talk")).toBeInTheDocument();
    expect(screen.getByText("History & Export")).toBeInTheDocument();
  });

  it("clicking Speed vs accuracy navigates to models:whisper", async () => {
    render(<TipsSection onNavigate={mockNavigate} />);
    await userEvent.click(screen.getByText("Speed vs accuracy").closest("button")!);
    expect(mockNavigate).toHaveBeenCalledWith("models:whisper");
  });

  it("clicking Smart Dictation navigates to models:smart-dictation", async () => {
    render(<TipsSection onNavigate={mockNavigate} />);
    await userEvent.click(screen.getByText("Smart Dictation").closest("button")!);
    expect(mockNavigate).toHaveBeenCalledWith("models:smart-dictation");
  });

  it("clicking Multilingual navigates to settings:transcription", async () => {
    render(<TipsSection onNavigate={mockNavigate} />);
    await userEvent.click(screen.getByText("Multilingual").closest("button")!);
    expect(mockNavigate).toHaveBeenCalledWith("settings:transcription");
  });

  it("clicking Push-to-Talk navigates to settings:general", async () => {
    render(<TipsSection onNavigate={mockNavigate} />);
    await userEvent.click(screen.getByText("Push-to-Talk").closest("button")!);
    expect(mockNavigate).toHaveBeenCalledWith("settings:general");
  });

  it("clicking Custom Vocabulary navigates to vocabulary", async () => {
    render(<TipsSection onNavigate={mockNavigate} />);
    await userEvent.click(screen.getByText("Custom Vocabulary").closest("button")!);
    expect(mockNavigate).toHaveBeenCalledWith("vocabulary");
  });

  it("clicking History & Export navigates to history", async () => {
    render(<TipsSection onNavigate={mockNavigate} />);
    await userEvent.click(screen.getByText("History & Export").closest("button")!);
    expect(mockNavigate).toHaveBeenCalledWith("history");
  });

  it("renders 6 dividers between 7 tips", () => {
    const { container } = render(<TipsSection onNavigate={mockNavigate} />);
    // Each divider is a 1px-height div with mx-4
    const dividers = container.querySelectorAll(".mx-4");
    expect(dividers).toHaveLength(6);
  });
});
