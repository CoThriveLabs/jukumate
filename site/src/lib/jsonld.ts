// site/src/lib/jsonld.ts
// JukuMate LP 用 Schema.org JSON-LD ビルダー
// FAQPage は FAQ.astro の faqs 配列と一字一句整合させること（差分発生時は FAQ.astro 側を正本とする）

export type FaqItem = { q: string; a: string | string[] };

const ORG_NAME = 'Co-Thrive Labs';
const SERVICE_NAME = 'JukuMate';

export function organizationJsonLd(siteUrl: string) {
  return {
    '@context': 'https://schema.org',
    '@type': 'Organization',
    name: ORG_NAME,
    url: siteUrl,
    logo: `${siteUrl}/favicon.svg`,
    contactPoint: [
      {
        '@type': 'ContactPoint',
        contactType: 'customer support',
        availableLanguage: ['ja'],
      },
    ],
  };
}

export function websiteJsonLd(siteUrl: string) {
  return {
    '@context': 'https://schema.org',
    '@type': 'WebSite',
    name: SERVICE_NAME,
    url: siteUrl,
    inLanguage: 'ja',
  };
}

export function serviceJsonLd(siteUrl: string) {
  return {
    '@context': 'https://schema.org',
    '@type': 'Service',
    serviceType: '学習塾向け業務支援ソフト',
    name: SERVICE_NAME,
    provider: { '@type': 'Organization', name: ORG_NAME },
    areaServed: 'JP',
    url: siteUrl,
  };
}

/** 質問文中の SP 改行用 <br> など HTML タグを除去（JSON-LD は純テキスト推奨） */
function stripHtml(s: string): string {
  return s.replace(/<[^>]+>/g, '');
}

export function faqPageJsonLd(faqs: FaqItem[]) {
  return {
    '@context': 'https://schema.org',
    '@type': 'FAQPage',
    mainEntity: faqs.map((f) => ({
      '@type': 'Question',
      name: stripHtml(f.q),
      acceptedAnswer: {
        '@type': 'Answer',
        text: Array.isArray(f.a) ? f.a.join('\n\n') : f.a,
      },
    })),
  };
}
