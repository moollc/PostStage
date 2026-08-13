const FALLBACK = [
  { id: 'x', label: 'X', name: 'You', handle: '@you', maxChars: 280, lengthSource: 'X 280 documented — free-tier compose limit (Premium tier raises this to 25,000, not modeled here)', media: ['image', 'video'], bestForm: 'Short claim + proof + one question', shape: 'timeline', accent: '#e7e9ea' },
  { id: 'instagram', label: 'Instagram', name: 'you', handle: '@you', maxChars: 2200, lengthSource: 'Instagram 2,200 documented — Meta-enforced caption field limit', media: ['image', 'video', 'carousel'], bestForm: 'Visual first, caption as a story with a save-worthy closer', shape: 'square', accent: '#e1306c' },
  { id: 'tiktok', label: 'TikTok', name: 'you', handle: '@you', maxChars: 4000, lengthSource: 'TikTok 4,000 documented — in-app caption limit (Content Posting API caps captions lower, at 2,200)', media: ['video'], bestForm: 'Hook in 1s, pattern interrupt, spoken CTA', shape: 'vertical', accent: '#fe2c55' },
  { id: 'youtube', label: 'YouTube', name: 'You', handle: '@you', maxChars: 5000, lengthSource: 'YouTube 5,000 documented — support.google.com/youtube/answer/12948449 (video description limit)', media: ['video'], bestForm: 'Title promise + thumbnail contrast + chaptered body', shape: 'landscape', accent: '#ff0000' },
  { id: 'linkedin', label: 'LinkedIn', name: 'You', handle: 'You', maxChars: 3000, lengthSource: 'LinkedIn 3,000 documented — linkedin.com/help/linkedin/answer/a528176 (raised from 1,300 in June 2023)', media: ['image', 'document'], bestForm: 'One lesson, short lines, ask for a lived example', shape: 'feed', accent: '#0a66c2' },
  { id: 'facebook', label: 'Facebook', name: 'You', handle: 'You', maxChars: 63206, lengthSource: 'Facebook 63,206 — legacy technical field limit, not an actively-published Meta policy page', media: ['image', 'video'], bestForm: 'Plain talk + photo + invite to share a story', shape: 'feed', accent: '#1877f2' }
];

let cache = FALLBACK;

export async function loadPlatforms() {
  try {
    const res = await fetch('/source/assets/data/platforms.json');
    const data = await res.json();
    if (Array.isArray(data.platforms) && data.platforms.length) cache = data.platforms;
  } catch {
    cache = FALLBACK;
  }
  return cache;
}

export function getPlatforms() {
  return cache;
}

export function getPlatform(id) {
  const found = cache.find((p) => p.id === id);
  const fb = FALLBACK.find((p) => p.id === id) || FALLBACK[0];
  return found ? { ...fb, ...found } : fb;
}
