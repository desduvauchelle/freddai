import { expect, it } from 'vitest';
import { remarkMediaPaths } from './remark-media-paths';

type N = { type: string; value?: string; url?: string; alt?: string; children?: N[] };
const run = (children: N[]) => { const tree: N = { type: 'root', children: [{ type: 'paragraph', children }] }; remarkMediaPaths()(tree); return tree.children![0].children!; };
const text = (value: string): N => ({ type: 'text', value });
const shape = (nodes: N[]) => nodes.map(n => n.type === 'image' ? `img:${n.url}|${n.alt}` : `${n.type}:${n.value}`);

it('splits bare absolute, home, relative, file and sandbox paths', () => {
  expect(shape(run([text('Saved to /Users/denis/Desktop/hero.png now')]))).toEqual(['text:Saved to ', 'img:/Users/denis/Desktop/hero.png|hero.png', 'text: now']);
  expect(shape(run([text('~/a/b.WEBP')]))).toEqual(['img:~/a/b.WEBP|b.WEBP']);
  expect(shape(run([text('file:///tmp/a%20b.jpg sandbox:/mnt/x.svg')]))).toEqual(['img:file:///tmp/a%20b.jpg|a%20b.jpg'.replace('a%20b.jpg|', 'a%20b.jpg|').replace('|a%20b.jpg', '|a b.jpg'), 'text: ', 'img:sandbox:/mnt/x.svg|x.svg']);
});
it('keeps trailing punctuation and wrapping parens as text', () => {
  expect(shape(run([text('see out/chart.png.')]))).toEqual(['text:see ', 'img:out/chart.png|chart.png', 'text:.']);
  expect(shape(run([text('(/a/b.gif),')]))).toEqual(['text:(', 'img:/a/b.gif|b.gif', 'text:),']);
});
it('ignores non-image, bare filenames, other schemes and non-image URLs', () => {
  for (const v of ['/usr/bin/python', 'foo.png', 'mailto:a/b.png', 'https://x.test/page', 'a/b.png.bak', '//cdn.test/a.png']) expect(shape(run([text(v)]))).toEqual([`text:${v}`]);
});
it('converts inline code but not fenced code, links or images', () => {
  expect(shape(run([{ type: 'inlineCode', value: '~/a/b.webp' }]))).toEqual(['img:~/a/b.webp|b.webp']);
  expect(shape(run([{ type: 'inlineCode', value: 'ls /a/b' }]))).toEqual(['inlineCode:ls /a/b']);
  const tree: N = { type: 'root', children: [{ type: 'code', value: '/a/b.png' }, { type: 'paragraph', children: [{ type: 'link', url: '/a/b.png', children: [text('/a/b.png')] }] }] };
  remarkMediaPaths()(tree);
  expect(tree.children![0].type).toBe('code');
  expect(tree.children![1].children![0].children![0].type).toBe('text');
});
it('handles hosted URLs ignoring the query and autolinked nodes', () => {
  expect(shape(run([text('Here: https://x.test/a.png?x=1.')]))).toEqual(['text:Here: ', 'img:https://x.test/a.png?x=1|a.png', 'text:.']);
  expect(shape(run([{ type: 'link', url: 'https://x.test/a.png', children: [text('https://x.test/a.png')] }]))).toEqual(['img:https://x.test/a.png|a.png']);
  expect(shape(run([{ type: 'link', url: 'https://x.test/a.png', children: [text('look')] }]))).toEqual(['link:undefined']);
});
it('matches video and audio extensions for local paths, inline code and hosted URLs', () => {
  expect(shape(run([text('Rendered ~/Movies/a.MOV and /tmp/b.m4a.')]))).toEqual(['text:Rendered ', 'img:~/Movies/a.MOV|a.MOV', 'text: and ', 'img:/tmp/b.m4a|b.m4a', 'text:.']);
  expect(shape(run([{ type: 'inlineCode', value: '/tmp/clip.webm' }]))).toEqual(['img:/tmp/clip.webm|clip.webm']);
  expect(shape(run([text('https://x.test/v/a.mp4?t=1')]))).toEqual(['img:https://x.test/v/a.mp4?t=1|a.mp4']);
  for (const ext of ['mp4', 'm4v', 'mov', 'webm', 'mp3', 'm4a', 'wav', 'ogg']) expect(shape(run([text(`/x/y.${ext}`)]))).toEqual([`img:/x/y.${ext}|y.${ext}`]);
  expect(shape(run([text('/x/y.zip')]))).toEqual(['text:/x/y.zip']);
});
