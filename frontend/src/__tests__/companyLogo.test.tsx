import { render, screen } from "@testing-library/react";
import { fireEvent } from "@testing-library/dom";
import { describe, expect, it } from "vitest";
import { CompanyLogo } from "../components/CompanyLogo";
import { avatarText } from "../lib/avatar";

const img = () => document.querySelector("img");

describe("avatarText", () => {
  it("takes the first two alphanumerics, upper-cased", () => {
    expect(avatarText("aapl")).toBe("AA");
    expect(avatarText("BRK-B")).toBe("BR");
    expect(avatarText("F")).toBe("F");
  });
});

describe("CompanyLogo", () => {
  it("asks the API for the logo first", () => {
    render(<CompanyLogo ticker="AAPL" name="Apple Inc." />);
    expect(img()?.getAttribute("src")).toBe("/api/logo/AAPL");
    expect(screen.getByText("Apple Inc.")).toBeInTheDocument(); // screen-reader label
  });

  it("falls back to the letter avatar when the logo 404s", () => {
    render(<CompanyLogo ticker="ZZZZ" />);
    fireEvent.error(img()!);
    expect(img()).toBeNull();
    expect(screen.getByText("ZZ")).toBeInTheDocument();
  });

  it("does not re-request a logo that just failed", () => {
    const { unmount } = render(<CompanyLogo ticker="NOPE" />);
    fireEvent.error(img()!);
    unmount();

    render(<CompanyLogo ticker="NOPE" />);
    expect(img()).toBeNull(); // straight to letters, no second request
  });

  it("keeps tickers independent", () => {
    const { unmount } = render(<CompanyLogo ticker="FAILS" />);
    fireEvent.error(img()!);
    unmount();

    render(<CompanyLogo ticker="WORKS" />);
    expect(img()?.getAttribute("src")).toBe("/api/logo/WORKS");
  });

  it("escapes tickers that need it", () => {
    render(<CompanyLogo ticker="BRK.B" />);
    expect(img()?.getAttribute("src")).toBe("/api/logo/BRK.B");
  });

  it("scales the circle and the letters together", () => {
    const { container } = render(<CompanyLogo ticker="ZZ9" size={20} />);
    const avatar = container.querySelector(".avatar") as HTMLElement;
    expect(avatar.style.width).toBe("20px");
    expect(avatar.style.height).toBe("20px");
  });
});
