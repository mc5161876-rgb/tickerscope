// AC-8 / AC-10: explainer popover opens from the label, one at a time, Esc closes, null example text.
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { ExplainerProvider } from "../components/Explainer";
import { MetricTile } from "../components/MetricTile";
import { METRIC_BY_ID } from "../lib/metrics";

function Fixture() {
  return (
    <ExplainerProvider>
      <MetricTile metric={METRIC_BY_ID["forward_pe"]} value={32.61} ticker="NVDA" />
      <MetricTile metric={METRIC_BY_ID["free_cash_flow"]} value={null} ticker="NVDA" />
    </ExplainerProvider>
  );
}

describe("explainer popover", () => {
  it("opens with What / How / For NVDA and a live example; only one open at a time; Esc closes", async () => {
    const user = userEvent.setup();
    render(<Fixture />);
    expect(screen.queryByRole("dialog")).toBeNull();

    await user.click(screen.getByRole("button", { name: "Forward P/E" }));
    const dlg = screen.getByRole("dialog");
    expect(dlg).toHaveTextContent("What it is");
    expect(dlg).toHaveTextContent("How to read it");
    expect(dlg).toHaveTextContent("For NVDA");
    expect(dlg).toHaveTextContent("32.61×");
    expect(dlg).toHaveTextContent("NVDA");

    // open the second one -> first closes
    await user.click(screen.getByRole("button", { name: "Free cash flow (TTM)" }));
    const dialogs = screen.getAllByRole("dialog");
    expect(dialogs).toHaveLength(1);
    expect(dialogs[0]).toHaveTextContent("Not reported for NVDA.");
    expect(dialogs[0]).toHaveTextContent("What it is");

    await user.keyboard("{Escape}");
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("null value renders an em dash in the tile", () => {
    render(<Fixture />);
    const tile = document.querySelector('[data-metric="free_cash_flow"] .tile-value');
    expect(tile?.textContent).toBe("—");
  });
});
