// The one media element the whole player plays through.
//
// It lives in a module of its own because two others need it and each needs the other: the player store drives it and tells the audio graph what to do, and the
// audio graph takes its sound from it. Defined in either of them, the two imported each other (a circular dependency that only worked because neither used the
// other while loading).

export const media: HTMLVideoElement = document.createElement('video');
media.preload = 'auto';
media.crossOrigin = 'anonymous';
media.playsInline = true;
