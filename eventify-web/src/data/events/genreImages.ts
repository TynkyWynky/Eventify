const GENRE_FALLBACK_IMAGES: Record<string, string> = {
  Techno:
    "https://images.unsplash.com/photo-1571266028243-0873a3c3f4a6?w=1600&q=80&auto=format&fit=crop",
  Electronic:
    "https://images.unsplash.com/photo-1470229722913-7c0e2dbbafd3?w=1600&q=80&auto=format&fit=crop",
  Rock:
    "https://images.unsplash.com/photo-1498038432885-c6f3f1b912ee?w=1600&q=80&auto=format&fit=crop",
  Indie:
    "https://images.unsplash.com/photo-1516450360452-9312f5e86fc7?w=1600&q=80&auto=format&fit=crop",
  Pop:
    "https://images.unsplash.com/photo-1493225457124-a3eb161ffa5f?w=1600&q=80&auto=format&fit=crop",
  "Hip-Hop":
    "https://images.unsplash.com/photo-1571604466107-ec97de577aff?w=1600&q=80&auto=format&fit=crop",
  Jazz:
    "https://images.unsplash.com/photo-1511192336575-5a79af67a629?w=1600&q=80&auto=format&fit=crop",
  House:
    "https://images.unsplash.com/photo-1516280440614-37939bbacd81?w=1600&q=80&auto=format&fit=crop",
  "Drum & Bass":
    "https://images.unsplash.com/photo-1578946956088-940c3b502864?w=1600&q=80&auto=format&fit=crop",
  "R&B":
    "https://images.unsplash.com/photo-1507874457470-272b3c8d8ee2?w=1600&q=80&auto=format&fit=crop",
  Metal:
    "https://images.unsplash.com/photo-1540039155733-5bb30b53aa14?w=1600&q=80&auto=format&fit=crop",
  All:
    "https://images.unsplash.com/photo-1501386761578-eac5c94b800a?w=1600&q=80&auto=format&fit=crop",
};

export function getGenreFallbackImage(style?: string | null) {
  if (!style) return GENRE_FALLBACK_IMAGES.All;
  return GENRE_FALLBACK_IMAGES[style] || GENRE_FALLBACK_IMAGES.Electronic;
}

