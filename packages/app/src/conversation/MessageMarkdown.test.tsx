// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { isTauri } from "@tauri-apps/api/core";
import { openUrl } from "@tauri-apps/plugin-opener";
import { MessageMarkdown } from "./MessageMarkdown";
vi.mock("@tauri-apps/api/core", () => ({ isTauri: vi.fn(() => true) }));
vi.mock("@tauri-apps/plugin-opener", () => ({ openUrl: vi.fn().mockResolvedValue(undefined) }));
afterEach(() => { cleanup(); vi.clearAllMocks(); vi.mocked(isTauri).mockReset().mockReturnValue(true); });

describe("message links", () => {
  it("opens Markdown and bare localhost URLs in the default native browser without duplicating labels", () => {
    render(<MessageMarkdown text={'[Preview](http://localhost:3000/home) and https://example.com/docs?q=one#two'} />);
    const links = screen.getAllByRole("link");
    expect(links).toHaveLength(2);
    expect(links[0].textContent).toBe("Preview");
    for (const link of links) fireEvent.click(link);
    expect(openUrl).toHaveBeenNthCalledWith(1, "http://localhost:3000/home");
    expect(openUrl).toHaveBeenNthCalledWith(2, "https://example.com/docs?q=one#two");
  });
  it("keeps code and non-web destinations from launching applications", () => {
    render(<MessageMarkdown text={'[file](file:///tmp/a) [relative](/home) [unsafe](javascript:alert) `http://localhost:3000`\n\n```\nhttps://example.com\n```'} />);
    expect(screen.queryAllByRole("link")).toHaveLength(0);
    expect(openUrl).not.toHaveBeenCalled();
  });
  it("uses a separate browser tab in a web preview", () => {
    vi.mocked(isTauri).mockReturnValueOnce(false);
    render(<MessageMarkdown text="https://example.com" />);
    const link = screen.getByRole("link");
    expect(link.getAttribute("target")).toBe("_blank");
    expect(link.getAttribute("rel")).toBe("noopener noreferrer");
  });
  it("reports launch failure without navigating the app", async () => {
    vi.mocked(openUrl).mockRejectedValueOnce(new Error("denied"));
    render(<MessageMarkdown text="http://localhost:3000" />);
    expect(fireEvent.click(screen.getByRole("link"))).toBe(false);
    expect((await screen.findByRole("alert")).textContent).toContain("Couldn’t open the browser");
  });
});

it("offers generated images and PDFs as previews instead of losing local links", () => {
  render(<MessageMarkdown text={'[Preview design](/tmp/design.png) [A4 PDF](file:///tmp/design.pdf) ![Design](sandbox:/mnt/data/design.png)'} />);
  expect(screen.getByRole("button", { name: "Preview design" })).toBeTruthy();
  expect(screen.getByRole("button", { name: "A4 PDF" })).toBeTruthy();
  expect(screen.getByRole("button", { name: "Design" })).toBeTruthy();
});

it('offers independent side-panel and default-browser buttons beside each desktop web link', async () => {
  const { BrowserContext } = await import('./browser-context');
  const side = vi.fn();
  render(<BrowserContext.Provider value={side}><MessageMarkdown text="[Preview](http://localhost:3000/home)" /></BrowserContext.Provider>);
  fireEvent.click(screen.getByRole('button', { name: 'Open in side panel: http://localhost:3000/home' }));
  expect(side).toHaveBeenCalledWith('http://localhost:3000/home');
  expect(openUrl).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: 'Open in default browser: http://localhost:3000/home' }));
  expect(openUrl).toHaveBeenCalledWith('http://localhost:3000/home');
  expect(side).toHaveBeenCalledTimes(1);
  fireEvent.click(screen.getByRole('link', { name: 'Preview' }));
  expect(side).toHaveBeenCalledTimes(2);
});
it('reports failure from the explicit default-browser button', async () => {
  vi.mocked(openUrl).mockRejectedValueOnce(new Error('denied'));
  render(<MessageMarkdown text="https://example.com" />);
  fireEvent.click(screen.getByRole('button', { name: 'Open in default browser: https://example.com' }));
  expect((await screen.findByRole('alert')).textContent).toContain('Couldn’t open the browser');
});
