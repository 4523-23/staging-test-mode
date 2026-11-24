export interface BrandConfiguration {
  brandName: string;
  studioPortalName: string;
  alternateBrandName: string;
  domain: string;
  websiteUrl: string;
  producerEmail: string;
  locationLabel: string;
  logoUrl: string;
  heroImageUrl: string;
  pageTitle: string;
  heroEyebrow: string;
  heroHeadline: string;
  heroDescription: string;
  footerSummary: string;
  licenseCreditText: string;
}

export const BRAND_CONFIG: BrandConfiguration = {
  brandName: 'Exvis Beatz',
  studioPortalName: 'Exvis Studios',
  alternateBrandName: 'Exvis Studios',
  domain: 'exvisbeatz.com',
  websiteUrl: 'https://exvisbeatz.com',
  producerEmail: 'enockgyamfi614@gmail.com',
  locationLabel: 'Accra & Worldwide',
  logoUrl: '/assets/aistudio/Exvix_Beatz_3c921262.jpg',
  heroImageUrl: '/assets/aistudio/Exvix_Beatz_3c921262.jpg',
  pageTitle: 'Exvis Beatz — Studio Beat Storefront & Instant Licensing',
  heroEyebrow: 'Exvis Beatz · Accra & Worldwide',
  heroHeadline: 'Studio-mastered beats built for chart records.',
  heroDescription:
    'Audition untagged Afrobeats, UK Drill, Trap, Hip-Hop, Amapiano, and R&B instrumentals. License in seconds with instant WAV, Trackout Stems, and Exclusive delivery.',
  footerSummary: 'Studio Production & Licensing',
  licenseCreditText: 'Prod. by Exvis Beatz',
};
