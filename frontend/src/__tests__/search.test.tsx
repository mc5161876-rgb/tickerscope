// AC-2: search keyboard navigation (React Testing Library).
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { Search } from "../components/Search";
import type { SearchResult } from "../lib/api";
import { pushRecent } from "../lib/recent";

const DATA: SearchResult[] = [
  { ticker: "NVDA", name: "NVIDIA Corp", exchange: "NASDAQ", cik: 1 },
  { ticker: "NVAX", name: "Novavax Inc", exchange: "NASDAQ", cik: 2 },
  { ticker: "AAPL", name: "Apple Inc.", exchange: "NASDAQ", cik: 3 },
];

const fetcher = async (q: string): Promise<SearchResult[]> => {
  const u = q.toUpperCase();
  return DATA.filter((d) => d.ticker.startsWith(u) || d.name.toUpperCase().includes(u));
};

describe("<Search>", () => {
  it("shows matches, moves with arrows and selects with Enter", async () => {
    const user = userEvent.setup();
    const onSelect = vi.fn();
    render(<Search mode="inline" fetcher={fetcher} onSelect={onSelect} />);
    const input = screen.getByRole("combobox");
    await user.type(input, "nv");
    await waitFor(() => expect(screen.getAllByRole("option")).toHaveLength(2));
    const opts = screen.getAllByRole("option");
    expect(opts[0]).toHaveTextContent("NVDA");
    expect(opts[0]).toHaveTextContent("NVIDIA Corp");
    expect(opts[0]).toHaveTextContent("NASDAQ");
    // nothing selected until ↓
    expect(opts[0]).toHaveAttribute("aria-selected", "false");
    await user.keyboard("{ArrowDown}");
    expect(screen.getAllByRole("option")[0]).toHaveAttribute("aria-selected", "true");
    await user.keyboard("{ArrowDown}");
    expect(screen.getAllByRole("option")[1]).toHaveAttribute("aria-selected", "true");
    await user.keyboard("{ArrowUp}");
    expect(screen.getAllByRole("option")[0]).toHaveAttribute("aria-selected", "true");
    await user.keyboard("{Enter}");
    expect(onSelect).toHaveBeenCalledWith("NVDA", "NVIDIA Corp");
  });

  it("Enter with no highlight picks the first match", async () => {
    const user = userEvent.setup();
    const onSelect = vi.fn();
    render(<Search mode="inline" fetcher={fetcher} onSelect={onSelect} />);
    await user.type(screen.getByRole("combobox"), "nv");
    await waitFor(() => expect(screen.getAllByRole("option")).toHaveLength(2));
    await user.keyboard("{Enter}");
    expect(onSelect).toHaveBeenCalledWith("NVDA", "NVIDIA Corp");
  });

  it("Enter on an exact ticker jumps to it even if not first", async () => {
    const user = userEvent.setup();
    const onSelect = vi.fn();
    const f = async () => [DATA[0], DATA[1]]; // NVDA first, NVAX second
    render(<Search mode="inline" fetcher={f} onSelect={onSelect} />);
    await user.type(screen.getByRole("combobox"), "nvax");
    await waitFor(() => expect(screen.getAllByRole("option")).toHaveLength(2));
    await user.keyboard("{Enter}");
    expect(onSelect).toHaveBeenCalledWith("NVAX", "Novavax Inc");
  });

  it("Enter with zero results still tries a ticker-shaped query", async () => {
    const user = userEvent.setup();
    const onSelect = vi.fn();
    render(<Search mode="inline" fetcher={async () => []} onSelect={onSelect} />);
    await user.type(screen.getByRole("combobox"), "zzzz9");
    await waitFor(() => expect(screen.getByRole("status")).toBeInTheDocument());
    await user.keyboard("{Enter}");
    expect(onSelect).toHaveBeenCalledWith("ZZZZ9", undefined);
  });

  it("Escape clears the query first, then calls onEscape", async () => {
    const user = userEvent.setup();
    const onEscape = vi.fn();
    render(<Search mode="modal" fetcher={fetcher} onSelect={() => {}} onEscape={onEscape} />);
    const input = screen.getByRole("combobox");
    await user.type(input, "aa");
    await user.keyboard("{Escape}");
    expect(input).toHaveValue("");
    expect(onEscape).not.toHaveBeenCalled();
    await user.keyboard("{Escape}");
    expect(onEscape).toHaveBeenCalledTimes(1);
  });

  it("modal shows Recent before typing", async () => {
    pushRecent("AAPL", "Apple Inc.");
    pushRecent("JPM");
    render(<Search mode="modal" fetcher={fetcher} onSelect={() => {}} />);
    expect(screen.getByText("Recent")).toBeInTheDocument();
    const chips = screen.getAllByRole("button");
    expect(chips.map((c) => c.textContent)).toEqual(expect.arrayContaining([expect.stringContaining("JPM")]));
    // most recent first
    expect(chips[0]).toHaveTextContent("JPM");
  });

  it("caps the list at 8", async () => {
    const user = userEvent.setup();
    const many = Array.from({ length: 12 }, (_, i) => ({ ticker: `T${i}`, name: `Test ${i}`, exchange: "NYSE", cik: i }));
    render(<Search mode="inline" fetcher={async () => many} onSelect={() => {}} />);
    await user.type(screen.getByRole("combobox"), "t");
    await waitFor(() => expect(screen.getAllByRole("option")).toHaveLength(8));
  });
});
