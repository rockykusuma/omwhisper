import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, it, expect, vi, beforeEach } from "vitest";
import TipsSection from "./TipsSection";

const mockNavigate = vi.fn();

beforeEach(() => {
  mockNavigate.mockReset();
});

describe("TipsSection", () => {
  it("renders all 6 tips", () => {
    render(<TipsSection onNavigate={mockNavigate} />);
    expect(screen.getByText("Smart Dictation")).toBeInTheDocument();
    expect(screen.getByText("Best AI for Smart Dictation")).toBeInTheDocument();
    expect(screen.getByText("Custom Vocabulary")).toBeInTheDocument();
    expect(screen.getByText("Word Replacements")).toBeInTheDocument();
    expect(screen.getByText("Push-to-Talk")).toBeInTheDocument();
    expect(screen.getByText("History & Export")).toBeInTheDocument();
  });

  it("clicking Smart Dictation navigates to models:smart-dictation", async () => {
    render(<TipsSection onNavigate={mockNavigate} />);
    await userEvent.click(screen.getByText("Smart Dictation").closest("button")!);
    expect(mockNavigate).toHaveBeenCalledWith("models:smart-dictation");
  });

  it("clicking Best AI for Smart Dictation navigates to models:smart-dictation", async () => {
    render(<TipsSection onNavigate={mockNavigate} />);
    await userEvent.click(screen.getByText("Best AI for Smart Dictation").closest("button")!);
    expect(mockNavigate).toHaveBeenCalledWith("models:smart-dictation");
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

  it("clicking Word Replacements navigates to vocabulary", async () => {
    render(<TipsSection onNavigate={mockNavigate} />);
    await userEvent.click(screen.getByText("Word Replacements").closest("button")!);
    expect(mockNavigate).toHaveBeenCalledWith("vocabulary");
  });

  it("clicking History & Export navigates to history", async () => {
    render(<TipsSection onNavigate={mockNavigate} />);
    await userEvent.click(screen.getByText("History & Export").closest("button")!);
    expect(mockNavigate).toHaveBeenCalledWith("history");
  });

  it("renders 5 dividers between 6 tips", () => {
    render(<TipsSection onNavigate={mockNavigate} />);
    // Each divider is a 1px-height div with tip-divider testid
    const dividers = screen.getAllByTestId("tip-divider");
    expect(dividers).toHaveLength(5);
  });
});
