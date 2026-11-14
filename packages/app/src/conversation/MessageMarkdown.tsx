import { Copy, ExternalLink, FolderOpen, PanelRightOpen } from "lucide-react";
import "./MessageMarkdown.css";
import { BrowserContext } from "./browser-context";
import { createContext, memo, useMemo, useState, useContext } from "react";
import { isTauri } from "@tauri-apps/api/core";
import { useSatelliteMode } from "../desktop/satellite";
import { openPath, openUrl, revealItemInDir } from "@tauri-apps/plugin-opener";
import Markdown, { defaultUrlTransform, type Components } from "react-markdown";
import remarkGfm from "remark-gfm";
import { ScrollArea } from "@freddai/ui/components/scroll-area";
import { GeneratedFile, InlineImage, InlineVideo, LocalPageContext, RemoteImage, RemoteVideo, isAudioFile, isGeneratedFile, isHtmlFile, isImageFile, isVideoFile } from "./GeneratedFile";
import { isHostedImageUrl, mediaBasename, remarkMediaPaths } from "./remark-media-paths";
import { splitMarkdownBlocks } from "./markdown-blocks";
import { ThreadChip, threadLinkId } from "./ThreadChip";
import { renderSpoken } from "./voiceCallMarkup";
import { LocalhostPreviewChips, PreviewConfirm, PreviewContext, PreviewErrorText, describePreviewError, normalizeLocalhostUrl, useLocalhostPreview, type PreviewOpen } from "./localhostPreview";

// Hoisted so every message and block shares one stable plugin list and component map.
const remarkPlugins = [remarkGfm, remarkMediaPaths];
const hostedPath = (src: string) => { try { return new URL(src).pathname; } catch { return src; } };
const hostedMedia = (src: string, alt: string) => isVideoFile(hostedPath(src)) ? <RemoteVideo src={src} alt={alt} /> : isAudioFile(hostedPath(src)) ? <RemoteVideo src={src} alt={alt} audio /> : <RemoteImage src={src} alt={alt} />;
const localMedia = (href: string, alt: string) => isImageFile(href) ? <InlineImage href={href} alt={alt} /> : isVideoFile(href) ? <InlineVideo href={href} alt={alt} /> : isAudioFile(href) ? <InlineVideo href={href} alt={alt} audio /> : undefined;
/** The full message text, so local hrefs can be matched literally (the host only serves hrefs that appear verbatim in the message). */
const MessageTextContext = createContext("");
/** react-markdown percent-encodes urls; restore the literal form the host will find in the message. */
export function literalHref(src: string, text: string): string {
  if (text.includes(src)) return src;
  try { const decoded = decodeURI(src); if (text.includes(decoded)) return decoded; } catch { /* malformed escape */ }
  return src;
}
function MessageImage({ src, alt, ...rest }: React.ComponentProps<"img"> & { "data-href"?: string }) {
  const text = useContext(MessageTextContext);
  if (typeof src !== "string") return <img src={src} alt={alt} style={{maxWidth:"100%"}} />;
  if (isHostedImageUrl(src)) return hostedMedia(src, alt || mediaBasename(src));
  const href = rest["data-href"] ?? literalHref(src, text);
  return isGeneratedFile(href) ? (localMedia(href, alt || "") ?? <GeneratedFile href={href}>{alt || "Preview file"}</GeneratedFile>) : <img src={src} alt={alt} style={{maxWidth:"100%"}} />;
}
const components: Components = {
  pre: ({ children }) => <ScrollArea orientation="both" viewportProps={{ style: { maxHeight: 400 }, "aria-label": "Code block" }}><pre>{children}</pre></ScrollArea>,
  table: ({ children }) => <ScrollArea className="message-table" orientation="horizontal" viewportProps={{ "aria-label": "Message table", tabIndex: 0 }}><table>{children}</table></ScrollArea>,
  a: MessageLink,
  img: MessageImage,
};

/** `freddai://thread/<id>` opens that thread as a live chip. Web URLs open externally; local file paths open a preview/actions dialog; other schemes stay plain text. */
const noPreview: PreviewOpen = () => Promise.resolve();

function MessageLink({ children, href: rawHref, title }: React.ComponentProps<"a">) {
  const messageText = useContext(MessageTextContext);
  const href = rawHref && !/^https?:\/\//i.test(rawHref) ? literalHref(rawHref, messageText) : rawHref;
  const [error, setError] = useState(false);
  const openBrowser = useContext(BrowserContext);
  const previewOpen = useContext(PreviewContext);
  const resolvePage = useContext(LocalPageContext);
  const local = previewOpen && href ? normalizeLocalhostUrl(href) : undefined;
  const preview = useLocalhostPreview(local?.url ?? "", previewOpen ?? noPreview);
  const threadId = href ? threadLinkId(href) : undefined;
  if (threadId) return <ThreadChip threadId={threadId} title={title}>{children}</ThreadChip>;
  if (href && isHostedImageUrl(href)) return hostedMedia(href, typeof children === "string" ? children : mediaBasename(href));
  if (href && isGeneratedFile(href)) {
    const media = localMedia(href, typeof children === "string" ? children : "");
    if (media) return media;
    if (isHtmlFile(href) && openBrowser && resolvePage && isTauri()) return <LocalPageLink href={href} openBrowser={openBrowser} resolve={resolvePage}>{children}</LocalPageLink>;
    return <GeneratedFile href={href}>{children}</GeneratedFile>;
  }
  let webUrl = false;
  try { webUrl = ["http:", "https:"].includes(new URL(href ?? "").protocol); } catch { /* Not an absolute URL. */ }
  if (!webUrl || !href) return <span title={title}>{children}</span>;
  const openSide = () => {
    if (!local) { openBrowser?.(href); return; }
    preview.click();
  };
  const localLabel = local?.url.replace(/^https?:\/\//, "") ?? "";
  const external = () => {
    setError(false);
    if (isTauri()) void openUrl(href).catch(() => setError(true));
    else window.open(href, "_blank", "noopener,noreferrer");
  };
  return <><span className="message-web-link"><a href={href} title={title ?? href} target="_blank" rel="noopener noreferrer" onClick={event => {
    if (!isTauri()) return;
    event.preventDefault();
    setError(false);
    if ((local || openBrowser) && !event.metaKey && !event.ctrlKey && !event.shiftKey && !event.altKey) { openSide(); return; }
    external();
  }}>{children}</a><span className="message-link-actions">
    {(local || openBrowser) && <button type="button" title="Open in side panel" aria-label={`Open in side panel: ${href}`} onClick={() => { setError(false); openSide(); }}><PanelRightOpen size={13} aria-hidden="true" /></button>}
    <button type="button" title="Open in default browser" aria-label={`Open in default browser: ${href}`} onClick={external}><ExternalLink size={13} aria-hidden="true" /></button>
  </span></span>{error && <small role="alert">Couldn’t open the browser. Copy the link and open it manually.</small>}{local && preview.state === "starting" && <small role="status">{describePreviewError("preview_server_starting", "", localLabel)}</small>}{local && preview.confirm && <PreviewConfirm label={localLabel} confirm={preview.confirm} onStart={preview.start} />}{local && preview.error && <PreviewErrorText code={preview.error.code} detail={preview.error.detail} label={localLabel} />}</>;
}

/** Local HTML opens in the side browser panel; icons mirror web links (default app, reveal, copy path). */
function LocalPageLink({ href, openBrowser, resolve, children }: { href: string; openBrowser: (url: string) => void; resolve: (href: string) => Promise<{ url: string; path: string }>; children: React.ReactNode }) {
  const [error, setError] = useState("");
  const satellite = useSatelliteMode() === true;
  const act = (run: (page: { url: string; path: string }) => unknown) => { setError(""); void resolve(href).then(run).catch(e => setError(e instanceof Error ? e.message : String(e))); };
  // On a satellite Mac the file lives on the original Mac, so "default app" means the host-served preview URL.
  const openDefault = () => act(page => satellite ? openUrl(page.url) : openPath(page.path));
  return <><span className="message-web-link"><button type="button" className="generated-file-link" title={href} onClick={event => {
    if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) openDefault();
    else act(page => openBrowser(page.url));
  }}>{children}</button><span className="message-link-actions">
    <button type="button" title="Open in default app" aria-label={`Open in default app: ${href}`} onClick={openDefault}><ExternalLink size={13} aria-hidden="true" /></button>
    {!satellite && <button type="button" title="Reveal in Finder" aria-label={`Reveal in Finder: ${href}`} onClick={() => act(page => revealItemInDir(page.path))}><FolderOpen size={13} aria-hidden="true" /></button>}
    <button type="button" title="Copy path" aria-label={`Copy path: ${href}`} onClick={() => act(page => navigator.clipboard.writeText(page.path))}><Copy size={13} aria-hidden="true" /></button>
  </span></span>{error && <small role="alert">{error}</small>}</>;
}

// A block re-parses only when its own text changes, so streaming re-renders just the last block.
const MarkdownBlock = memo(function MarkdownBlock({ text }: { text: string }) {
  return <Markdown urlTransform={url => isGeneratedFile(url) || threadLinkId(url) ? url : defaultUrlTransform(url)} remarkPlugins={remarkPlugins} components={components}>{text}</Markdown>;
});

export const MessageMarkdown = memo(function MessageMarkdown({ text }: { text: string }) {
  const blocks = useMemo(() => splitMarkdownBlocks(renderSpoken(text)), [text]);
  return <MessageTextContext.Provider value={text}>{blocks.map((block, index) => <MarkdownBlock key={index} text={block} />)}<LocalhostPreviewChips text={text} /></MessageTextContext.Provider>;
});
