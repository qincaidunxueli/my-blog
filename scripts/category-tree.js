/*!
 * 分类树：把 Hexo 的扁平分类还原成父子层级，生成分类总览页。
 * 位于 scripts/ 目录，构建时由 Hexo 自动加载。
 *
 * 为什么用生成器而不是文章里的 {% cat_tree %} 标签：
 * Hexo 会在归类之前把页面内容预渲染进缓存，标签会拿到旧分类；
 * 生成器在归类（before_generate）之后才运行，数据一定是新的。
 */

const esc = (s) =>
  String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

function buildTree(categories) {
  const all = categories.map((cat) => ({
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
  const sortKids = (n) => {
    n.children.sort(byCount);
    n.children.forEach(sortKids);
  };
  roots.forEach(sortKids);
  return { roots, all };
}

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

function renderTreeHTML(roots, all) {
  if (!all.length) {
    return '<p class="ct-empty">还没有分类。把文章放进 _posts 下的分类文件夹里，分类会自动出现。</p>';
  }

  const posts = roots.reduce((sum, c) => sum + c.count, 0);

  return (
    `<div class="ct-wrap">` +
    `<div class="ct-head">` +
    `<span><b>${all.length}</b> 个分类</span>` +
    `<span class="ct-sep">/</span>` +
    `<span><b>${posts}</b> 篇文章</span>` +
    `</div>` +
    `<ul class="ct-root">${roots.map((r) => renderNode(r, 1)).join('')}</ul>` +
    `</div>`
  );
}

hexo.extend.generator.register('categories_tree_page', function (locals) {
  const cats = locals.categories;
  const list = !cats ? [] : cats.toArray ? cats.toArray() : Array.from(cats);

  const { roots, all } = buildTree(list);
  const html = renderTreeHTML(roots, all);
  const now = new Date();

  return [
    {
      path: 'categories/index.html',
      data: {
        title: '分类',
        date: now,
        updated: now,
        content: html,
        comments: false,
      },
      layout: 'page',
    },
  ];
});
