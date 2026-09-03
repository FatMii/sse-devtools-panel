export type Locale = "zh" | "en";

export type FaqItem =
  { question: string; answer: string } | { question: string; answerHtml: string };

export interface UI {
  meta: {
    title: string;
    description: string;
  };
  nav: {
    features: string;
    install: string;
    themeDark: string;
    themeLight: string;
    switchLang: string;
  };
  hero: {
    eyebrow: string;
    title: string;
    lead: string;
    ctaDemo: string;
    proofLabel: string;
    proofOpenSource: string;
    proofLocal: string;
    proofExtension: string;
  };
  heroDemo: {
    ariaLabel: string;
    windowUrl: string;
    imageAlt: string;
  };
  pain: {
    title: string;
    items: [
      { title: string; body: string },
      { title: string; body: string },
      { title: string; body: string },
    ];
  };
  features: {
    title: string;
    subtitle: string;
    tagsAria: (title: string) => string;
    items: [
      {
        num: string;
        title: string;
        description: string;
        image: string;
        alt: string;
        tags: string[];
      },
      {
        num: string;
        title: string;
        description: string;
        image: string;
        alt: string;
        tags: string[];
      },
      {
        num: string;
        title: string;
        description: string;
        image: string;
        alt: string;
        tags: string[];
      },
    ];
  };
  spotlight: {
    ariaLabel: string;
    items: Array<{
      title: string;
      description: string;
      image: string;
      alt: string;
      tags: string[];
    }>;
  };
  faq: {
    title: string;
    subtitle: string;
    footPrefix: string;
    footLink: string;
    items: [FaqItem, FaqItem, FaqItem, FaqItem];
  };
  install: {
    title: string;
    subtitle: string;
    storeTitle: string;
    storeBody: string;
    storeCta: string;
    offlineTitle: string;
    offlineBadge: string;
    offlineBody: string;
    offlineCta: (version: string) => string;
    footPrefix: string;
    footReleases: string;
    footSuffix: string;
  };
  footer: {
    readme: string;
  };
}
