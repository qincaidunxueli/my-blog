/*!
 * 所有内页左上角加「返回上一层」按钮，按页面层级往回走：
 *   文章      → 它所属的最深分类（没有分类就回首页）
 *   分类详情  → 父分类（一级分类回分类总览）
 *   标签详情  → 标签总览
 *   归档/标签/关于/搜索等 → 首页
 */

const norm = (p) =>
  String(p || '')
    .replace(/^\/+/, '')
    .replace(/index\.html$/, '')
    .replace(/\/+$/, '') + '/';

const catUrl = (catPath) =>
  '/' +
  String(catPath)
    .split('/')
    .filter(Boolean)
    .map(encodeURIComponent)
    .join('/') +
  '/';

let postIndex = null;

function findPost(path) {
  if (!postIndex) {
    postIndex = new Map();
    const posts = hexo.locals.get('posts');
    if (posts && posts.forEach) {
      posts.forEach((post) => postIndex.set(norm(post.path), post));
    }
  }
  return postIndex.get(norm(path));
}

function backTarget(path) {
  if (path === 'index.html' || /^index\/\d+\//.test(path)) return null; // 首页与分页不加

  // 分类详情页
  const cat = /^categories\/(.+)\/index\.html$/.exec(path);
  if (cat) {
    const segs = cat[1].split('/').filter(Boolean);
    segs.pop();
    return {
      href: '/categories/' + (segs.length ? segs.map(encodeURIComponent).join('/') + '/' : ''),
      label: '返回上一层',
    };
  }

  // 标签详情页
  if (/^tags\/.+\/index\.html$/.test(path)) return { href: '/tags/', label: '返回上一层' };

  // 分类/标签/归档总览、关于页、搜索页等 → 首页
  if (/^(categories|tags|archives)\/index\.html$/.test(path)) return { href: '/', label: '返回上一层' };
  if (/^(about|search)\/index\.html$/.test(path)) return { href: '/', label: '返回上一层' };

  // 其余当文章处理：回它所属的最深分类
  const post = findPost(path);
  const cats = post && post.categories ? post.categories.toArray() : [];
  if (cats.length) {
    const deepest = cats.reduce((a, b) =>
      String(b.path || '').length > String(a.path || '').length ? b : a
    );
    return { href: catUrl(deepest.path), label: '返回上一层' };
  }
  return { href: '/', label: '返回上一层' };
}

hexo.extend.filter.register('after_render:html', function (str, data) {
  const path = (data && data.path ? String(data.path) : '').replace(/^\/+/, '');
  if (!path || path.indexOf('page-back') !== -1) return str;

  const target = backTarget(path);
  if (!target) return str;

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
