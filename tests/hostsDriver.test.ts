import { describe, expect, it } from 'vitest';
import { LABEL_SCORER, PAGE_DRIVER } from '@core/hostsDriver';

// The scorer is plain JavaScript meant for the page; here it runs in Node, so the real function is what is tested.
const api = new Function(`${LABEL_SCORER}; return { scoreLabel, avoidLabel };`)() as { scoreLabel: (s: string) => number; avoidLabel: (s: string) => boolean };
const score = (s: string) => api.scoreLabel(s);

describe('reading the words on a download control', () => {
  it('knows the classic English wordings, strongest first', () => {
    expect(score('Start Download')).toBe(100);
    expect(score('Free Download')).toBeGreaterThan(score('Download'));
    expect(score('Slow download')).toBeGreaterThanOrEqual(90);
    expect(score('Continue to Download')).toBe(85);
    expect(score('Download')).toBeGreaterThan(score('Continue'));
    expect(score('Continue')).toBeGreaterThanOrEqual(40);
  });

  it.each([
    ['Spanish', 'Descargar gratis'], ['French', 'Télécharger le fichier'], ['German', 'Datei herunterladen'], ['Portuguese', 'Baixar arquivo'],
    ['Italian', 'Scarica ora'], ['Turkish', 'İndir'], ['Russian', 'Скачать файл'], ['Ukrainian', 'Завантажити'], ['Polish', 'Pobierz plik'],
    ['Indonesian', 'Unduh sekarang'], ['Vietnamese', 'Tải xuống ngay'], ['Dutch', 'Bestand downloaden'], ['Arabic', 'تحميل الملف'],
    ['Hindi', 'डाउनलोड करें'], ['Chinese', '免费下载'], ['Traditional Chinese', '立即下載'], ['Japanese', 'ダウンロード'], ['Korean', '다운로드'], ['Thai', 'ดาวน์โหลด'],
  ])('finds %s', (_lang, label) => {
    expect(score(label), label).toBeGreaterThanOrEqual(50);
  });

  it('finds "free" in other languages as the better choice', () => {
    for (const label of ['Descargar gratis', 'Kostenlos herunterladen', 'Télécharger gratuit', '免费下载', 'Скачать бесплатно']) {
      expect(score(label), label).toBeGreaterThanOrEqual(90);
    }
  });

  it('looks past a leading arrow, icon or capitals', () => {
    for (const label of ['⬇ DOWNLOAD', '↓ Download', '📥 Download now', '»  DOWNLOAD  «'.replace('»  ', '').replace('  «', '')]) {
      expect(score(label), label).toBeGreaterThanOrEqual(60);
    }
  });

  it('copes with a size or format after the word', () => {
    expect(score('Download [rar] 1.2 GB')).toBeGreaterThanOrEqual(60);
    expect(score('Download (45.2 MB)')).toBeGreaterThanOrEqual(60);
  });

  it('finds a sentence link, a little less strongly than a button', () => {
    const s = score('Click here to download');
    expect(s).toBeGreaterThanOrEqual(50);
    expect(s).toBeLessThan(score('Free Download'));
  });
});

describe('leaving the wrong controls alone', () => {
  it.each([
    'Fast Download (Premium)', 'Premium Download', 'High-speed download', 'Upgrade to download faster', 'Buy premium', 'Descarga rápida',
    'Schnell herunterladen', 'Скачать быстро', 'Install our extension - Download', 'Download our app', 'Download Manager', 'Download the VPN',
    'Download torrent', 'Sign up to download', 'Log in to download', 'Report abuse', 'Cancel', 'Close', 'Play online', 'Watch now', 'Share', 'Copy link',
  ])('scores %s as nothing', (label) => {
    expect(score(label), label).toBe(0);
    expect(api.avoidLabel(label), label).toBe(true);
  });

  it('does not mistake a word for one that merely contains it', () => {
    // "pro" is a decoy word, but "problem" and "improve" are not "pro"; "ad" is a decoy but "download" and "address" are not "ad".
    expect(score('Download – no problem')).toBeGreaterThanOrEqual(60);
    expect(score('Download to improve your address book')).toBeGreaterThan(0);
    expect(api.avoidLabel('Download')).toBe(false);
  });

  it('is zero for nothing, for a paragraph, and for words with no download in them', () => {
    expect(score('')).toBe(0);
    expect(score('   ')).toBe(0);
    expect(score('x'.repeat(200))).toBe(0);
    expect(score('Terms of service')).toBe(0);
    expect(score('About us')).toBe(0);
  });
});

describe('the page script', () => {
  it('is valid JavaScript, so a slip in it cannot reach a page', () => {
    expect(() => new Function(`return ${PAGE_DRIVER}`)).not.toThrow();
  });

  it('never touches the check itself: it only reports it', () => {
    // Guards the rule that a person solves a check. There is no code in the driver that clicks inside a captcha frame.
    expect(PAGE_DRIVER).not.toMatch(/turnstile[^\n]*\.click\(|recaptcha[^\n]*\.click\(|captchaEl\.click|captchaEl\.dispatchEvent/);
    expect(PAGE_DRIVER).toContain('if (best && !captcha');
  });
});

describe('scripts the accent folding must not damage', () => {
  it('reads Korean written without spaces', () => {
    expect(score('다운로드하기')).toBeGreaterThanOrEqual(50);
    expect(score('무료다운로드')).toBeGreaterThanOrEqual(90);
  });

  it('keeps Japanese voicing: "download" is not confused with an unrelated word that differs by a mark', () => {
    expect(score('ダウンロード')).toBeGreaterThanOrEqual(50);
    // Without the voicing mark this is "タウンロード", a different word; it must not read as a download.
    expect(score('タウンロード')).toBe(0);
  });

  it('still folds Latin accents and the Turkish capital dotted I', () => {
    expect(score('TÉLÉCHARGER')).toBeGreaterThanOrEqual(50);
    expect(score('İNDİR')).toBeGreaterThanOrEqual(50);
    expect(score('Descárgalo ya')).toBe(0);
  });
});
