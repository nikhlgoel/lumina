// Download-page layouts for the driver self-test: the ways a file host can word, hide, delay or re-style its "get the file" control.
// Each page offers exactly one real way to the file (`/get/<code>`) and, where it makes sense, a decoy that must NOT be used.
// The point is the one the owner raised: when a host moves or renames a button, the driver should still find it without a release.

export interface DriverVariant {
  id: string;
  /** What is different about this layout. */
  note: string;
  /** The page body. `go` is the address that serves the file; `decoy` an address that must not be taken. */
  body: (go: string, decoy: string) => string;
  /** Extra seconds this layout legitimately needs (a countdown), so the time limit is fair. */
  waitS?: number;
}

const click = (go: string) => `onclick="location.href='${go}'"`;

export const DRIVER_VARIANTS: DriverVariant[] = [
  { id: 'plain', note: 'the classic "Free Download" button', body: (go) => `<button id="method_free" ${click(go)}>Free Download</button>` },
  { id: 'download-now-link', note: 'a styled link, "Download now"', body: (go) => `<a class="btn" href="${go}">Download now</a>` },
  { id: 'click-here', note: 'a plain sentence link', body: (go) => `<p>Your file is ready. <a href="${go}">Click here to download</a></p>` },
  { id: 'start-download', note: 'a "Start Download" button', body: (go) => `<button ${click(go)}>Start Download</button>` },
  { id: 'span-onclick', note: 'a span with a click handler, not a button or link', body: (go) => `<span class="btn" style="cursor:pointer;padding:12px;border:1px solid #333" ${click(go)}>Download</span>` },
  { id: 'div-role-button', note: 'a div that says it is a button', body: (go) => `<div role="button" tabindex="0" style="padding:12px;border:1px solid #333" ${click(go)}>Download</div>` },
  { id: 'spanish', note: 'Spanish', body: (go) => `<button ${click(go)}>Descargar gratis</button>` },
  { id: 'french', note: 'French', body: (go) => `<button ${click(go)}>Télécharger le fichier</button>` },
  { id: 'german', note: 'German', body: (go) => `<button ${click(go)}>Datei herunterladen</button>` },
  { id: 'portuguese', note: 'Portuguese', body: (go) => `<button ${click(go)}>Baixar arquivo</button>` },
  { id: 'italian', note: 'Italian', body: (go) => `<button ${click(go)}>Scarica ora</button>` },
  { id: 'turkish', note: 'Turkish', body: (go) => `<a href="${go}">İndir</a>` },
  { id: 'russian', note: 'Russian', body: (go) => `<a class="btn" href="${go}">Скачать файл</a>` },
  { id: 'chinese', note: 'Chinese', body: (go) => `<button ${click(go)}>免费下载</button>` },
  { id: 'arabic', note: 'Arabic', body: (go) => `<button ${click(go)}>تحميل الملف</button>` },
  { id: 'glyph-uppercase', note: 'an arrow glyph and capitals before the word', body: (go) => `<button ${click(go)}>⬇ DOWNLOAD</button>` },
  { id: 'size-suffix', note: 'the file size after the word', body: (go) => `<button ${click(go)}>Download [rar] 1.2 GB</button>` },
  { id: 'split-spans', note: 'the label split over spans', body: (go) => `<button ${click(go)}><span>Free</span> <span>Download</span></button>` },
  { id: 'icon-only-class', note: 'an icon button: no text, only a class that says download', body: (go) => `<button class="btn btn-download" ${click(go)}><i class="fa fa-download"></i></button>` },
  { id: 'aria-label-only', note: 'an icon button labelled only for screen readers', body: (go) => `<button aria-label="Download file" ${click(go)}><svg width="20" height="20"><circle cx="10" cy="10" r="8"/></svg></button>` },
  { id: 'image-input', note: 'an image button', body: (go) => `<form action="${go}" method="get"><input type="image" alt="Download" width="120" height="40" src="data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7"></form>` },
  { id: 'file-link-generic-text', note: 'a link straight to the file, worded "Mirror 1"', body: (go) => `<a href="${go}.rar">Mirror 1</a>` },
  { id: 'download-attribute', note: 'a link with a download attribute, worded "Get it"', body: (go) => `<a href="${go}" download>Get it</a>` },
  { id: 'form-proceed', note: 'a form with a bare "Proceed" button', body: (go) => `<form method="get" action="${go}"><input type="hidden" name="op" value="download2"><input type="submit" value="Proceed"></form>` },
  { id: 'below-the-fold', note: 'the button far below the visible area', body: (go) => `<div style="height:3200px">Scroll…</div><button ${click(go)}>Download</button>` },
  { id: 'ad-overlay', note: 'an invisible ad layer over the button', body: (go) => `<button id="method_free" ${click(go)}>Free Download</button><div style="position:fixed;inset:0;z-index:50;background:transparent" onclick="window.open('/ad')"></div>` },
  { id: 'premium-decoy', note: 'a large Premium button beside a small free one', body: (go, decoy) => `<a href="${decoy}" style="display:block;width:420px;height:90px;font-size:28px;background:gold">Fast Download (Premium)</a><a href="${go}" style="font-size:12px">Slow download</a>` },
  { id: 'ads-decoy', note: 'a fake "Download" ad button next to the real control', body: (go, decoy) => `<a class="ad" href="${decoy}" style="display:block;width:300px;height:80px;background:#e33;color:#fff">Install our extension - Download</a><button ${click(go)}>Continue to Download</button>` },
  { id: 'delayed-enable', note: 'disabled for 3 s with a countdown, then enabled', waitS: 8, body: (go) => `<div id="cd">Please wait <span id="n">3</span> seconds</div><button id="b" disabled ${click(go)}>Download</button><script>let n=3;const t=setInterval(()=>{n--;document.getElementById('n').textContent=n;if(n<=0){clearInterval(t);document.getElementById('b').disabled=false;document.getElementById('cd').remove();}},1000)</script>` },
  { id: 'two-step', note: 'a "Continue" button that reveals the download button', waitS: 8, body: (go) => `<button id="s1" onclick="this.remove();document.getElementById('s2').style.display='block'">Continue</button><div id="s2" style="display:none"><button ${click(go)}>Download</button></div>` },
  { id: 'tab-then-button', note: 'a "Free" tab to open before the button exists', waitS: 8, body: (go) => `<div id="tabs"><a href="javascript:void(0)" class="tab" onclick="document.getElementById('pane').innerHTML='<button id=&quot;dl&quot;>Download</button>';document.getElementById('dl').onclick=()=>{location.href='${go}'}">Free download</a></div><div id="pane"></div>` },
  { id: 'auto-redirect', note: 'no button at all: the page moves on by itself after a countdown', waitS: 8, body: (go) => `<p>Your download will start in <span id="n">3</span> seconds…</p><script>let n=3;setInterval(()=>{n--;document.getElementById('n').textContent=Math.max(n,0);if(n===0)location.href='${go}'},1000)</script>` },
  { id: 'shadow-dom', note: 'the button lives in an open shadow root', body: (go) => `<div id="host"></div><script>const r=document.getElementById('host').attachShadow({mode:'open'});r.innerHTML='<button>Download</button>';r.querySelector('button').onclick=()=>{location.href='${go}'}</script>` },
  { id: 'same-origin-iframe', note: 'the button sits in an iframe of the same site', body: (go) => `<iframe src="/frame?go=${encodeURIComponent(go)}" style="width:600px;height:200px;border:0"></iframe>` },
  { id: 'late-inserted', note: 'the button is created by script two seconds after load', waitS: 8, body: (go) => `<div id="slot">Loading…</div><script>setTimeout(()=>{document.getElementById('slot').innerHTML='<button id="x">Download</button>';document.getElementById('x').onclick=()=>{location.href='${go}'}},2000)</script>` },
];
