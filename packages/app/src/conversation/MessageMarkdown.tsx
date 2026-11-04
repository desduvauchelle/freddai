import { memo, useMemo } from "react";
import Markdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";
import { ScrollArea } from "@freddai/ui/components/scroll-area";
import { splitMarkdownBlocks } from "./markdown-blocks";

// Hoisted so every message and block shares one stable plugin list and component map.
const remarkPlugins = [remarkGfm];
const components: Components = {
  pre: ({ children }) => <ScrollArea orientation="both" viewportProps={{ style: { maxHeight: 400 }, "aria-label": "Code block" }}><pre>{children}</pre></ScrollArea>,
  table: ({ children }) => <ScrollArea orientation="horizontal" viewportProps={{ "aria-label": "Message table" }}><table>{children}</table></ScrollArea>,
  a: ({ children, href }) => (
    <span title={href}>
      {children}
      {href && ` (${href})`}
    </span>
  ),
};

// A block re-parses only when its own text changes, so streaming re-renders just the last block.
const MarkdownBlock = memo(function MarkdownBlock({ text }: { text: string }) {
  return <Markdown remarkPlugins={remarkPlugins} components={components}>{text}</Markdown>;
});

export const MessageMarkdown = memo(function MessageMarkdown({ text }: { text: string }) {
  const blocks = useMemo(() => splitMarkdownBlocks(text), [text]);
  return <>{blocks.map((block, index) => <MarkdownBlock key={index} text={block} />)}</>;
});
