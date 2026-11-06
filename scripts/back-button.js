/*!
 * 所有内页左上角加「返回上一层」按钮：
 *   文章      → 分类总览 /categories/
 *   标签详情  → 标签总览
 *   分类/标签/归档总览、关于页 → 首页
 *   首页      → 不加
 *
 * 因为分类详情页已取消（scripts/no-category-pages.js），
 * 文章里指向 /categories/某某/ 的链接也一并改成分类总览，避免 404。
 */

const COLLECTION = /^(categories|tags|archives|about|search)\//;

function backTarget(path) {
  if (path === 'index.html' || /^index\/\d+\//.test(path)) return null; // 首页与分页不加

  if (/^tags\/.+\/index\.html$/.test(path)) return { href: '/tags/', label: '返回上一层' };

  if (/^(categories|tags|archives)\/index\.html$/.test(path)) return { href: '/', label: '返回上一层' };
  if (/^(about|search)\/index\.html$/.test(path)) return { href: '/', label: '返回上一层' };

  return { href: '/categories/', label: '返回分类' };
}

hexo.extend.filter.register('after_render:html', function (str, data) {
  const path = (data && data.path ? String(data.path) : '').replace(/^\/+/, '');
  if (!path || path.indexOf('page-back') !== -1) return str;

  const target = backTarget(path);
  if (!target) return str;

  // 文章页：把失效的分类详情链接改到分类总览
  if (!COLLECTION.test(path)) {
    str = str.replace(/href="\/categories\/[^"]+"/g, 'href="/categories/"');
  }

  const btn =
    `<a class="page-back" href="${target.href}">` +
    `<span class="page-back-arrow" aria-hidden="true">‹</span>${target.label}</a>`;

  // 分类/标签/归档这类集合页：插在小标题上方
  if (str.indexOf('<div class="collection-title">') !== -1) {
    return str.replace('<div class="collection-title">', btn + '<div class="collection-title">');
  }
  // 文章页 / 关于页：插在正文块最上方（主题会带 lang 等属性，用正则取整个开标签）
  if (str.indexOf('<div class="post-block"') !== -1) {
    return str.replace(/<div class="post-block"[^>]*>/, (tag) => tag + btn);
  }
  if (str.indexOf('<div class="post-content"') !== -1) {
    return str.replace(/<div class="post-content"[^>]*>/, (tag) => tag + btn);
  }
  return str;
});
