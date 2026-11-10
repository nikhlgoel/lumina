import { describe, expect, it } from 'vitest';
import { embeddedLinkLists, extractFileLinks, githubAssets, githubReleaseApi, githubReleaseRef, isDirectoryIndex, isNoMediaMessage, looksLikeFileLink, rewriteShareLink } from '@core/pageFiles';

describe('share links that have an address of the file itself', () => {
  it('turns a GitHub file page into the raw file', () => {
    expect(rewriteShareLink('https://github.com/aria2/aria2/blob/master/README.rst')).toBe('https://raw.githubusercontent.com/aria2/aria2/master/README.rst');
    expect(rewriteShareLink('https://github.com/o/r/blob/v1.0/docs/a b.md')).toContain('raw.githubusercontent.com/o/r/v1.0/docs/');
  });

  it('turns a GitLab file page into the raw file', () => {
    expect(rewriteShareLink('https://gitlab.com/grp/sub/proj/-/blob/main/x.txt')).toBe('https://gitlab.com/grp/sub/proj/-/raw/main/x.txt');
  });

  it('turns a Hugging Face file page into the file, for models, datasets and spaces', () => {
    expect(rewriteShareLink('https://huggingface.co/org/model/blob/main/weights.safetensors')).toBe('https://huggingface.co/org/model/resolve/main/weights.safetensors');
    expect(rewriteShareLink('https://huggingface.co/datasets/org/data/blob/main/train.csv')).toBe('https://huggingface.co/datasets/org/data/resolve/main/train.csv');
    expect(rewriteShareLink('https://huggingface.co/org/model')).toBeNull();
  });

  it('turns a Codeberg file page into the raw file', () => {
    expect(rewriteShareLink('https://codeberg.org/o/r/src/branch/main/docs/a.txt')).toBe('https://codeberg.org/o/r/raw/branch/main/docs/a.txt');
    expect(rewriteShareLink('https://codeberg.org/o/r')).toBeNull();
  });

  it('asks Dropbox for the file instead of the preview page', () => {
    expect(rewriteShareLink('https://www.dropbox.com/s/abc123/file.zip?dl=0')).toBe('https://www.dropbox.com/s/abc123/file.zip?dl=1');
    expect(rewriteShareLink('https://www.dropbox.com/scl/fi/xyz/f.pdf?rlkey=k&dl=0')).toContain('dl=1');
    expect(rewriteShareLink('https://www.dropbox.com/scl/fi/xyz/f.pdf?rlkey=k&dl=0')).toContain('rlkey=k');
  });

  it('leaves a Dropbox link that already asks for the file, and other Dropbox pages, alone', () => {
    expect(rewriteShareLink('https://www.dropbox.com/s/abc/f.zip?dl=1')).toBeNull();
    expect(rewriteShareLink('https://www.dropbox.com/home')).toBeNull();
  });

  it('builds the Google Drive download address from the file id', () => {
    const want = 'https://drive.usercontent.google.com/download?id=1AbCdEfGhIjKlMnOp&export=download&confirm=t';
    expect(rewriteShareLink('https://drive.google.com/file/d/1AbCdEfGhIjKlMnOp/view?usp=sharing')).toBe(want);
    expect(rewriteShareLink('https://drive.google.com/open?id=1AbCdEfGhIjKlMnOp')).toBe(want);
  });

  it('does not touch anything else', () => {
    for (const u of ['https://example.org/a.zip', 'https://github.com/aria2/aria2', 'https://github.com/o/r/releases', 'not a url', 'ftp://x/y', 'https://drive.google.com/drive/folders/abc']) {
      expect(rewriteShareLink(u), u).toBeNull();
    }
  });
});

describe('a GitHub release page', () => {
  it('names the release whose files are wanted', () => {
    expect(githubReleaseRef('https://github.com/aria2/aria2/releases/tag/release-1.37.0')).toEqual({ owner: 'aria2', repo: 'aria2', tag: 'release-1.37.0' });
    expect(githubReleaseRef('https://github.com/aria2/aria2/releases/latest')).toEqual({ owner: 'aria2', repo: 'aria2', tag: null });
    expect(githubReleaseRef('https://github.com/aria2/aria2/releases')).toEqual({ owner: 'aria2', repo: 'aria2', tag: null });
  });

  it('is not a release page for other GitHub pages', () => {
    expect(githubReleaseRef('https://github.com/aria2/aria2')).toBeNull();
    expect(githubReleaseRef('https://github.com/aria2/aria2/issues')).toBeNull();
    expect(githubReleaseRef('https://example.org/a/b/releases')).toBeNull();
  });

  it('builds the API address, with the tag encoded', () => {
    expect(githubReleaseApi({ owner: 'o', repo: 'r', tag: 'v1/rc 1' })).toBe('https://api.github.com/repos/o/r/releases/tags/v1%2Frc%201');
    expect(githubReleaseApi({ owner: 'o', repo: 'r', tag: null })).toBe('https://api.github.com/repos/o/r/releases/latest');
  });

  it('lists the assets with their sizes and ignores anything malformed', () => {
    const files = githubAssets({ assets: [
      { name: 'a.zip', browser_download_url: 'https://github.com/o/r/releases/download/v1/a.zip', size: 10 },
      { name: 'no-url' }, null, { browser_download_url: 'https://x/y' },
    ] });
    expect(files).toEqual([{ url: 'https://github.com/o/r/releases/download/v1/a.zip', name: 'a.zip', sizeBytes: 10 }]);
    expect(githubAssets(null)).toEqual([]);
    expect(githubAssets({})).toEqual([]);
  });
});

describe('finding the files a page lists', () => {
  const apache = `<html><head><title>Index of /gnu/wget</title></head><body><h1>Index of /gnu/wget</h1><table>
    <tr><td><a href="?C=N;O=D">Name</a></td></tr>
    <tr><td><a href="/gnu/">Parent Directory</a></td></tr>
    <tr><td><a href="wget-1.21.tar.gz">wget-1.21.tar.gz</a></td><td>4.3M</td></tr>
    <tr><td><a href="wget-1.21.tar.gz.sig">wget-1.21.tar.gz.sig</a></td></tr>
    <tr><td><a href="sub/">sub/</a></td></tr>
    <tr><td><a href="README">README</a></td></tr>
    <tr><td><a href="https://elsewhere.example/other.zip">elsewhere</a></td></tr></table></body></html>`;

  it('recognises the listing a web server makes for a folder', () => {
    expect(isDirectoryIndex(apache)).toBe(true);
    expect(isDirectoryIndex('<title>My shop</title>')).toBe(false);
    expect(isDirectoryIndex('<title>Directory listing for /x</title>')).toBe(true);
  });

  it('lists the files of a folder, not its sort links, parent, sub-folders or other sites', () => {
    const files = extractFileLinks(apache, 'https://ftp.example.org/gnu/wget/');
    expect(files.map((f) => f.url)).toEqual([
      'https://ftp.example.org/gnu/wget/wget-1.21.tar.gz', 'https://ftp.example.org/gnu/wget/wget-1.21.tar.gz.sig', 'https://ftp.example.org/gnu/wget/README',
    ]);
  });

  it('finds download links on an ordinary page, on any host, once each', () => {
    const html = `<a href="/about">About</a> <a href="https://cdn.example.net/app/Setup-2.0.exe">Download</a>
      <a href="https://cdn.example.net/app/Setup-2.0.exe">Again</a> <a href="/files/manual.pdf">Manual</a> <a href="mailto:a@b.c">Mail</a>
      <a href="#top">Top</a> <a href="javascript:void(0)" >x</a> <a href="/img/logo.png">Logo</a>`;
    expect(extractFileLinks(html, 'https://example.org/downloads').map((f) => f.url)).toEqual([
      'https://cdn.example.net/app/Setup-2.0.exe', 'https://example.org/files/manual.pdf',
    ]);
  });

  it('names a file by its file name when the button only says Download, and by its text when that is a file name', () => {
    const html = `<a href="/f/123/Setup.exe">Download</a> <a href="/f/9?x=1">Release.part01.rar</a> <a href="/dl/Archive%20One.7z">Get it now</a>`;
    const files = extractFileLinks(html, 'https://example.org/');
    expect(files.map((f) => f.name)).toEqual(['Setup.exe', 'Archive One.7z']);
  });

  it('keeps multi-part and double extensions', () => {
    for (const u of ['https://x.example/a.tar.gz', 'https://x.example/a.7z.001', 'https://x.example/a.part01.rar?token=1']) expect(looksLikeFileLink(u), u).toBe(true);
    for (const u of ['https://x.example/a', 'https://x.example/a.html', 'https://x.example/a.png']) expect(looksLikeFileLink(u), u).toBe(false);
  });

  it('is capped so a page of thousands of links cannot flood the batch screen', () => {
    const many = Array.from({ length: 900 }, (_, i) => `<a href="/f${i}.zip">f${i}</a>`).join('');
    expect(extractFileLinks(many, 'https://example.org/')).toHaveLength(300);
  });

  it('copes with nonsense', () => {
    expect(extractFileLinks('', 'https://example.org/')).toEqual([]);
    expect(extractFileLinks('<a href="/a.zip">a</a>', 'not a url')).toEqual([]);
    expect(extractFileLinks('<a href=">', 'https://example.org/')).toEqual([]);
  });
});

describe('a page that keeps its other mirrors in a data attribute', () => {
  // The shape of a real hoster page: one tab per file host, each holding that host's links as JSON, and only the first tab drawn as links.
  const list = (host: string, danger = false) => JSON.stringify([1, 2].map((n) => ({ direct_link: `https://${host}/u/part${n}`, file_name: `Sample.part0${n}.rar`, is_dangerous: danger })));
  const tabs = `<div class="option selected" data-links='${list('mirror-a.example')}'>Alpha</div>
    <div class="option" data-links='${list('pixeldrain.com')}'>Pixeldrain</div>
    <div class="option" data-links='${list('risky.example', true)}'>Risky</div>`;

  it('reads each tab as a list, labelled by the tab, and leaves out what the page itself flags as dangerous', () => {
    const lists = embeddedLinkLists(tabs, 'https://hosters.example/GAME');
    expect(lists.map((l) => l.label)).toEqual(['Alpha', 'Pixeldrain']);
    expect(lists[1]?.files).toEqual([
      { url: 'https://pixeldrain.com/u/part1', name: 'Sample.part01.rar' },
      { url: 'https://pixeldrain.com/u/part2', name: 'Sample.part02.rar' },
    ]);
  });

  it('reads a double-quoted attribute with escaped quotes the same way', () => {
    const html = `<div data-links="${list('mirror-b.example').replace(/"/g, '&quot;')}">Beta</div>`;
    expect(embeddedLinkLists(html, 'https://hosters.example/').map((l) => l.files.length)).toEqual([2]);
  });

  it('is used when the page has no plain links of its own, so a script-drawn page still lists its files', () => {
    expect(extractFileLinks(tabs, 'https://hosters.example/GAME').map((f) => f.url)).toEqual(['https://mirror-a.example/u/part1', 'https://mirror-a.example/u/part2']);
  });

  it('is left alone when the page already shows links, which are what the person sees', () => {
    const html = `<a href="https://shown.example/x/Sample.part01.rar">Download</a>${tabs}`;
    expect(extractFileLinks(html, 'https://hosters.example/').map((f) => f.url)).toEqual(['https://shown.example/x/Sample.part01.rar']);
  });

  it('ignores attributes that are not link lists', () => {
    expect(embeddedLinkLists(`<div data-ids='[1,2,3]' data-x='[{"a":1}]' data-y='not json [x]'>t</div>`, 'https://hosters.example/')).toEqual([]);
  });
});

describe('when a page is worth reading for files', () => {
  it('is when the answer was "no media here"', () => {
    expect(isNoMediaMessage('Lumina doesn’t recognise media on this page. Play it in your browser with the Lumina extension installed and it will catch the stream.')).toBe(true);
    expect(isNoMediaMessage('The file wasn’t found on the server (404).')).toBe(false);
  });
});

describe('a hostile page cannot freeze the app', () => {
  // These patterns run in the main process on someone else's HTML. Unclosed tags used to make each one rescan the rest of the page, so the
  // time grew with the square of the size: about a second at 400 KB, a minute or more at the 3 MB the reader accepts.
  const within = (ms: number, fn: () => unknown) => {
    const t = Date.now();
    fn();
    expect(Date.now() - t).toBeLessThan(ms);
  };

  it('reads a page of a million unclosed links in a moment', () => {
    const page = '<a href="x">'.repeat(90_000);
    within(1500, () => extractFileLinks(page, 'https://example.org/'));
  });

  it('reads a page of unclosed data lists in a moment', () => {
    const page = "<i data-a='[1'>".repeat(90_000);
    within(1500, () => embeddedLinkLists(page, 'https://example.org/'));
  });

  it('reads a page of unclosed tags in a moment', () => {
    within(1500, () => extractFileLinks('<a '.repeat(500_000), 'https://example.org/'));
    within(1500, () => embeddedLinkLists('<div data-x='.repeat(200_000), 'https://example.org/'));
  });

  it('survives the shape that made the unbounded pattern cubic', () => {
    within(1500, () => embeddedLinkLists("<i data-a='[1 ".repeat(150_000), 'https://example.org/'));
    within(1500, () => extractFileLinks('<a href="x.zip">'.repeat(100_000), 'https://example.org/'));
  });

  it('still finds the links in a large honest page', () => {
    const honest = `${'<p>filler text </p>'.repeat(50_000)}<a href="/files/real.zip">real</a>`;
    expect(extractFileLinks(honest, 'https://example.org/').map((f) => f.name)).toEqual(['real.zip']);
  });
});
