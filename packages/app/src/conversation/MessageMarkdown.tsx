import { ExternalLink, PanelRightOpen } from "lucide-react";
import "./MessageMarkdown.css";
import { BrowserContext } from "./browser-context";
import { memo, useMemo, useState, useContext } from "react";
import { isTauri } from "@tauri-apps/api/core";
import { openUrl } from "@tauri-apps/plugin-opener";
import Markdown, { defaultUrlTransform, type Components } from "react-markdown";
import remarkGfm from "remark-gfm";
import { ScrollArea } from "@freddai/ui/components/scroll-area";
import { GeneratedFile, isGeneratedFile } from "./GeneratedFile";
import { splitMarkdownBlocks } from "./markdown-blocks";

// Hoisted so every message and block shares one stable plugin list and component map.
const remarkPlugins = [remarkGfm];
const components: Components = {
  pre: ({ children }) => <ScrollArea orientation="both" viewportProps={{ style: { maxHeight: 400 }, "aria-label": "Code block" }}><pre>{children}</pre></ScrollArea>,
  table: ({ children }) => <ScrollArea className="message-table" orientation="horizontal" viewportProps={{ "aria-label": "Message table", tabIndex: 0 }}><table>{children}</table></ScrollArea>,
  a: MessageLink,
  img: ({src, alt}) => typeof src === "string" && isGeneratedFile(src) ? <GeneratedFile href={src}>{alt || "Preview image"}</GeneratedFile> : <img src={src} alt={alt} style={{maxWidth:"100%"}} />,
};

/** Only web URLs can leave the app; relative/file/custom-scheme links stay plain text. */
function MessageLink({ children, href, title }: React.ComponentProps<"a">) {
  const [error, setError] = useState(false);
  const openBrowser = useContext(BrowserContext);
  if (href && isGeneratedFile(href)) return <GeneratedFile href={href}>{children}</GeneratedFile>;
  let webUrl = false;
  try { webUrl = ["http:", "https:"].includes(new URL(href ?? "").protocol); } catch { /* Not an absolute URL. */ }
  if (!webUrl || !href) return <span title={title}>{children}</span>;
  const external = () => {
    setError(false);
    if (isTauri()) void openUrl(href).catch(() => setError(true));
    else window.open(href, "_blank", "noopener,noreferrer");
  };
  return <><span className="message-web-link"><a href={href} title={title ?? href} target="_blank" rel="noopener noreferrer" onClick={event => {
    if (!isTauri()) return;
    event.preventDefault();
    setError(false);
    if (openBrowser && !event.metaKey && !event.ctrlKey && !event.shiftKey && !event.altKey) { openBrowser(href); return; }
    external();
  }}>{children}</a><span className="message-link-actions">
    {openBrowser && <button type="button" title="Open in side panel" aria-label={`Open in side panel: ${href}`} onClick={() => { setError(false); openBrowser(href); }}><PanelRightOpen size={13} aria-hidden="true" /></button>}
    <button type="button" title="Open in default browser" aria-label={`Open in default browser: ${href}`} onClick={external}><ExternalLink size={13} aria-hidden="true" /></button>
  </span></span>{error && <small role="alert">Couldn’t open the browser. Copy the link and open it manually.</small>}</>;
}

// A block re-parses only when its own text changes, so streaming re-renders just the last block.
const MarkdownBlock = memo(function MarkdownBlock({ text }: { text: string }) {
  return <Markdown urlTransform={url => isGeneratedFile(url) ? url : defaultUrlTransform(url)} remarkPlugins={remarkPlugins} components={components}>{text}</Markdown>;
});

export const MessageMarkdown = memo(function MessageMarkdown({ text }: { text: string }) {
  const blocks = useMemo(() => splitMarkdownBlocks(text), [text]);
  return <>{blocks.map((block, index) => <MarkdownBlock key={index} text={block} />)}</>;
});
