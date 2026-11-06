/*!
 * 结构化数据（JSON-LD）：帮助搜索引擎理解这是博客、文章和作者。
 * 输出到 <head>，由 source/_data/head.njk 调用。
 */

function stripHtml(html) {
  return String(html || '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function safeJson(obj) {
  return JSON.stringify(obj)
    .replace(/</g, '\\u003c')
    .replace(/>/g, '\\u003e')
    .replace(/&/g, '\\u0026');
}

hexo.extend.helper.register('seo_jsonld', function () {
  const config = this.config;
  const page = this.page || {};
  const base = String(config.url || '').replace(/\/$/, '');
  if (!base) return '';

  const siteName = config.title || '';
  const authorName = config.author || siteName;
  const logo = base + '/images/avatar.png';
  const blocks = [];

  const isPost = page.layout === 'post' || page.type === 'post';

  if (isPost) {
    const url = base + (page.path ? '/' + page.path.replace(/^\//, '').replace(/index\.html$/, '') : '/');
    const desc = stripHtml(page.description || page.excerpt || page.content).slice(0, 160);
    blocks.push({
      '@context': 'https://schema.org',
      '@type': 'BlogPosting',
      headline: page.title || '',
      description: desc,
      url,
      mainEntityOfPage: { '@type': 'WebPage', '@id': url },
      datePublished: page.date ? page.date.toISOString() : undefined,
      dateModified: page.updated ? page.updated.toISOString() : undefined,
      author: { '@type': 'Person', name: authorName, url: base + '/' },
      publisher: {
        '@type': 'Organization',
        name: siteName,
        logo: { '@type': 'ImageObject', url: logo },
      },
      image: logo,
      inLanguage: 'zh-CN',
      keywords: Array.isArray(page.tags)
        ? page.tags.map((t) => t.name).join(', ')
        : undefined,
    });
  } else {
    blocks.push({
      '@context': 'https://schema.org',
      '@type': 'WebSite',
      name: siteName,
      alternateName: config.subtitle || undefined,
      url: base + '/',
      description: config.description || undefined,
      inLanguage: 'zh-CN',
      author: { '@type': 'Person', name: authorName },
      potentialAction: {
        '@type': 'SearchAction',
        target: {
          '@type': 'EntryPoint',
          urlTemplate: base + '/search/?q={search_term_string}',
        },
        'query-input': 'required name=search_term_string',
      },
    });

    if (page.title) {
      blocks.push({
        '@context': 'https://schema.org',
        '@type': 'WebPage',
        name: page.title,
        url: base + '/' + String(page.path || '').replace(/index\.html$/, ''),
        isPartOf: { '@type': 'WebSite', name: siteName, url: base + '/' },
      });
    }
  }

  return blocks
    .map((b) => `<script type="application/ld+json">${safeJson(b)}</script>`)
    .join('\n');
});
