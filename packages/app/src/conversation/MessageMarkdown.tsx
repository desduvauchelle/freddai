import { memo, useMemo, useState } from "react";
import { isTauri } from "@tauri-apps/api/core";
import { openUrl } from "@tauri-apps/plugin-opener";
import Markdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";
import { ScrollArea } from "@freddai/ui/components/scroll-area";
import { splitMarkdownBlocks } from "./markdown-blocks";

// Hoisted so every message and block shares one stable plugin list and component map.
const remarkPlugins = [remarkGfm];
const components: Components = {
  pre: ({ children }) => <ScrollArea orientation="both" viewportProps={{ style: { maxHeight: 400 }, "aria-label": "Code block" }}><pre>{children}</pre></ScrollArea>,
  table: ({ children }) => <ScrollArea className="message-table" orientation="horizontal" viewportProps={{ "aria-label": "Message table", tabIndex: 0 }}><table>{children}</table></ScrollArea>,
  a: MessageLink,
};

/** Only web URLs can leave the app; relative/file/custom-scheme links stay plain text. */
function MessageLink({ children, href, title }: React.ComponentProps<"a">) {
  const [error, setError] = useState(false);
  let webUrl = false;
  try { webUrl = ["http:", "https:"].includes(new URL(href ?? "").protocol); } catch { /* Not an absolute URL. */ }
  if (!webUrl || !href) return <span title={title}>{children}</span>;
  return <><a href={href} title={title ?? href} target="_blank" rel="noopener noreferrer" onClick={event => {
    if (!isTauri()) return;
    event.preventDefault();
    setError(false);
    void openUrl(href).catch(() => setError(true));
  }}>{children}</a>{error && <small role="alert">Couldn’t open the browser. Copy the link and open it manually.</small>}</>;
}

// A block re-parses only when its own text changes, so streaming re-renders just the last block.
const MarkdownBlock = memo(function MarkdownBlock({ text }: { text: string }) {
  return <Markdown remarkPlugins={remarkPlugins} components={components}>{text}</Markdown>;
});

export const MessageMarkdown = memo(function MessageMarkdown({ text }: { text: string }) {
  const blocks = useMemo(() => splitMarkdownBlocks(text), [text]);
  return <>{blocks.map((block, index) => <MarkdownBlock key={index} text={block} />)}</>;
});
