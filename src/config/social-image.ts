// Large (1200x630) social preview images, rendered once from the site's
// brand colours, fonts and official logo (public/assets/dajc-social-*.png).
// X, LinkedIn and Facebook show them as a large link card.
export type SocialImageKey = 'default' | 'news' | 'weekly';

export interface SocialImage {
  url: string;
  alt: string;
  width: number;
  height: number;
}

const ORIGIN = 'https://www.dajc.eu';

export const SOCIAL_IMAGES: Record<SocialImageKey, SocialImage> = {
  default: {
    url: `${ORIGIN}/assets/dajc-social-default.png`,
    alt: 'DAJC - Connecting European transport and vehicle assistance',
    width: 1200,
    height: 630,
  },
  news: {
    url: `${ORIGIN}/assets/dajc-social-news.png`,
    alt: 'DAJC News - EU Oversize Weekly briefings and DAJC Platform Updates',
    width: 1200,
    height: 630,
  },
  weekly: {
    url: `${ORIGIN}/assets/dajc-social-weekly.png`,
    alt: 'EU Oversize Weekly by DAJC - verified changes for heavy and oversize road transport across Europe',
    width: 1200,
    height: 630,
  },
};

/** Preview image for a news article, by its category label (newsCategoryLabel). */
export function socialImageForNews(categoryLabel: string): SocialImageKey {
  return categoryLabel === 'EU Oversize Weekly' ? 'weekly' : 'news';
}
