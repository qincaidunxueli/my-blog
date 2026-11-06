/*!
 * 分类树：把 Hexo 的扁平分类还原成父子层级，输出可悬停展开的 HTML。
 * 位于 scripts/ 目录，构建时由 Hexo 自动加载。
 * 用法：在任意页面 md 正文里写一行 {% cat_tree %}
 */

function buildTree(categories) {
  const all = categories.toArray().map((cat) => ({
    id: cat._id || cat.name,
    name: cat.name,
    path: cat.path,
    count: cat.length,
    parent: cat.parent || '',
  }));

  const byId = new Map();
  all.forEach((c) => byId.set(c.id, Object.assign({}, c, { children: [] })));

  const roots = [];
  all.forEach((c) => {
    const node = byId.get(c.id);
    const parent = node.parent && byId.get(node.parent);
    if (parent && parent !== node) parent.children.push(node);
    else roots.push(node);
  });

  const byCount = (a, b) => b.count - a.count || a.name.localeCompare(b.name, 'zh-CN');
  roots.sort(byCount);
  roots.forEach((r) => r.children.sort(byCount));
  return { roots, all };
}

const esc = (s) =>
  String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

function renderNode(node, depth) {
  const href =
    '/' +
    String(node.path)
      .split('/')
      .filter(Boolean)
      .map(encodeURIComponent)
      .join('/') +
    '/';
  const caret = node.children.length
    ? '<span class="ct-caret" aria-hidden="true">›</span>'
    : '';
  const link =
    `<a class="ct-link ct-d${depth}" href="${href}">` +
    `<span class="ct-name">${esc(node.name)}</span>` +
    `<span class="ct-count">${node.count}</span>${caret}</a>`;

  if (!node.children.length) return `<li class="ct-node">${link}</li>`;

  const kids = node.children.map((k) => renderNode(k, depth + 1)).join('');
  return (
    `<li class="ct-node ct-has-sub">${link}` +
    `<ul class="ct-sub">${kids}</ul></li>`
  );
}

function renderCategoryTree() {
  const categories = hexo.locals.get('categories');
  if (!categories) return '';

  const { roots, all } = buildTree(categories);
  if (!all.length) return '<p class="ct-empty">还没有分类，写文章时加上 categories 就会出现。</p>';

  const posts = roots.reduce((sum, c) => sum + c.count, 0);

  return (
    `<div class="ct-wrap">` +
    `<div class="ct-head">` +
    `<span><b>${all.length}</b> 个分类</span>` +
    `<span class="ct-sep">/</span>` +
    `<span><b>${posts}</b> 篇文章</span>` +
    `</div>` +
    `<ul class="ct-root">${roots.map((r) => renderNode(r, 1)).join('')}</ul>` +
    `<p class="ct-tip">把鼠标移到带 <span class="ct-caret ct-caret-demo">›</span> 的分类上，可以看到它的下一层</p>` +
    `</div>`
  );
}

hexo.extend.tag.register('cat_tree', function () {
  return renderCategoryTree();
});
