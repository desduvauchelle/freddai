/**
 * Remark plugin: turns standalone image references in assistant prose into `image` nodes so they render
 * through the inline-image UI. Detects (in `text` and `inlineCode`, never fenced code, links or images):
 *  - local refs: `file://…`, `sandbox:…`, absolute `/…`, `~/…`, or relative paths containing `/`
 *  - hosted refs: `http(s)://…` whose pathname ends in an image extension (query ignored)
 * all ending in .png/.jpg/.jpeg/.gif/.webp/.svg or a video/audio extension (.mp4/.m4v/.mov/.webm/.mp3/.m4a/.wav/.ogg; the renderer branches on extension), case-insensitive, with no whitespace. Trailing `.,;:)` and
 * wrapping quotes/`(` stay as text. The image `url` is the exact original string so hosts can match it
 * literally against the message. Also converts autolinked `[url](url)` nodes (remark-gfm) to images.
 */
type MdNode = { type: string; value?: string; url?: string; alt?: string; data?: { hProperties?: Record<string, string> }; children?: MdNode[] };

const IMAGE_EXT = /\.(?:png|jpe?g|gif|webp|svg|mp4|m4v|mov|webm|mp3|m4a|wav|ogg)$/i;
const SKIP = new Set(['code', 'link', 'linkReference', 'image', 'imageReference', 'definition', 'html']);

export function isHostedImageUrl(value: string) {
  if (!/^https?:\/\//i.test(value)) return false;
  try { return IMAGE_EXT.test(new URL(value).pathname); } catch { return false; }
}

export function isLocalImageRef(value: string) {
  if (/\s/.test(value) || !IMAGE_EXT.test(value)) return false;
  if (/^(?:file:\/\/|sandbox:)/i.test(value)) return true;
  if (/^~\//.test(value) || /^\/(?!\/)/.test(value)) return true;
  return value.includes('/') && !/^[a-z][a-z0-9+.-]*:/i.test(value) && !value.startsWith('//') && !value.startsWith('#');
}

const isImageRef = (value: string) => isHostedImageUrl(value) || isLocalImageRef(value);

export function mediaBasename(url: string) {
  let path = url;
  if (/^https?:\/\//i.test(url)) { try { path = new URL(url).pathname; } catch { /* keep raw */ } }
  const name = path.split('/').filter(Boolean).pop() ?? url;
  try { return decodeURIComponent(name); } catch { return name; }
}

const image = (url: string): MdNode => ({ type: 'image', url, alt: mediaBasename(url), data: { hProperties: { 'data-href': url } } });

function splitText(value: string): MdNode[] | undefined {
  const out: MdNode[] = [];
  let last = 0;
  let found = false;
  const re = /[^\s`<>]+/g;
  for (let m = re.exec(value); m; m = re.exec(value)) {
    const lead = /^[("'“‘]*/.exec(m[0])![0].length;
    const body = m[0].slice(lead).replace(/[.,;:)"'”’]+$/, '');
    if (!body || !isImageRef(body)) continue;
    const start = m.index + lead;
    if (start > last) out.push({ type: 'text', value: value.slice(last, start) });
    out.push(image(body));
    last = start + body.length;
    found = true;
  }
  if (!found) return undefined;
  if (last < value.length) out.push({ type: 'text', value: value.slice(last) });
  return out;
}

function walk(node: MdNode) {
  if (!node.children) return;
  const next: MdNode[] = [];
  for (const child of node.children) {
    if (child.type === 'link' && child.url && isHostedImageUrl(child.url) && child.children?.length === 1 && child.children[0].type === 'text' && child.children[0].value === child.url) {
      next.push(image(child.url));
    } else if (child.type === 'inlineCode' && child.value !== undefined && isImageRef(child.value.trim())) {
      next.push(image(child.value.trim()));
    } else if (child.type === 'text' && child.value) {
      next.push(...(splitText(child.value) ?? [child]));
    } else {
      if (!SKIP.has(child.type)) walk(child);
      next.push(child);
    }
  }
  node.children = next;
}

export function remarkMediaPaths() {
  return (tree: MdNode) => { walk(tree); };
}
