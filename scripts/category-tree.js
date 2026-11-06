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

const urlOf = (p) =>
  '/' +
  String(p)
    .split('/')
    .filter(Boolean)
    .map(encodeURIComponent)
    .join('/') +
  '/';

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

  return { roots, all };
}

function sortTree(nodes) {
  const byCount = (a, b) => b.count - a.count || a.name.localeCompare(b.name, 'zh-CN');
  nodes.sort(byCount);
  nodes.forEach((n) => sortTree(n.children));
}

/*
 * 两种统计口径：
 *  - allMap：分类自身 + 所有子孙分类下的文章，用于显示数量
 *  - directMap：只属于该分类本身的文章，用于悬停时列出来
 * 文章 post.categories 里会带上整条祖先链，所以要挑 path 最深的那一级算“直属”。
 */
function collectPosts(posts) {
  const allMap = new Map();
  const directMap = new Map();
  if (!posts) return { allMap, directMap };

  const list = posts.toArray ? posts.toArray() : Array.from(posts);
  list.forEach((post) => {
    if (post.published === false) return;
    const cats = post.categories
      ? post.categories.toArray
        ? post.categories.toArray()
        : Array.from(post.categories)
      : [];
    if (!cats.length) return;

    const item = {
      title: post.title || '(无标题)',
      path: post.path,
      date: post.date ? post.date.valueOf() : 0,
    };

    cats.forEach((cat) => {
      const key = cat._id || cat.name;
      if (!allMap.has(key)) allMap.set(key, []);
      allMap.get(key).push(item);
    });

    const deepest = cats.reduce((best, c) =>
      String(c.path || c.name).length > String(best.path || best.name).length ? c : best
    );
    const dkey = deepest._id || deepest.name;
    if (!directMap.has(dkey)) directMap.set(dkey, []);
    directMap.get(dkey).push(item);
  });

  const byDate = (a, b) => b.date - a.date;
  allMap.forEach((arr) => arr.sort(byDate));
  directMap.forEach((arr) => arr.sort(byDate));
  return { allMap, directMap };
}

// 用实际可见文章数覆盖 Hexo 的 length（length 会把未发布文章也算进去，且不含子分类）
function applyCounts(nodes, allMap) {
  nodes.forEach((n) => {
    n.count = (allMap.get(n.id) || []).length;
    applyCounts(n.children, allMap);
  });
  return nodes.reduce((sum, n) => sum + n.count, 0);
}

function renderLink(node, depth, expandable) {
  const caret = expandable ? '<span class="ct-caret" aria-hidden="true">›</span>' : '';
  // 分类本身不再跳转（分类详情页已取消），点击只负责展开/收起
  return (
    `<a class="ct-link ct-d${depth}" href="javascript:void(0)"` +
    ` data-cat="${esc(node.name)}" role="button" aria-expanded="false">` +
    `<span class="ct-name">${esc(node.name)}</span>` +
    `<span class="ct-count">${node.count}</span>${caret}</a>`
  );
}

function renderArticles(list) {
  return list
    .map(
      (p) =>
        `<li class="ct-node"><a class="ct-article" href="${urlOf(p.path)}">${esc(p.title)}</a></li>`
    )
    .join('');
}

function renderNode(node, depth, ctx) {
  const articles = ctx.directMap.get(node.id) || [];

  // 叶子分类：没有下一级分类，就把这个分类下的文章当作“下一层”列出来
  if (!node.children.length) {
    if (!articles.length) return `<li class="ct-node">${renderLink(node, depth, false)}</li>`;
    return (
      `<li class="ct-node ct-has-sub ct-has-articles">${renderLink(node, depth, true)}` +
      `<ul class="ct-articles">${renderArticles(articles)}</ul></li>`
    );
  }

  const kids = node.children.map((k) => renderNode(k, depth + 1, ctx)).join('');
  // 有子分类时，自己也有的文章挂在子分类后面一起展开
  const own = articles.length ? renderArticles(articles) : '';

  return (
    `<li class="ct-node ct-has-sub">${renderLink(node, depth, true)}` +
    `<ul class="ct-sub">${kids}${own}</ul></li>`
  );
}

function renderTreeHTML(roots, all, total, ctx) {
  if (!all.length) {
    return '<p class="ct-empty">还没有分类。把文章放进 _posts 下的分类文件夹里，分类会自动出现。</p>';
  }

  return (
    `<div class="ct-wrap">` +
    `<div class="ct-head">` +
    `<span><b>${all.length}</b> 个分类</span>` +
    `<span class="ct-sep">/</span>` +
    `<span><b>${total}</b> 篇文章</span>` +
    `</div>` +
    `<ul class="ct-root">${roots.map((r) => renderNode(r, 1, ctx)).join('')}</ul>` +
    `</div>` +
    // 交互脚本：一级分类默认展开第二层，其余层级都要点击才展开
    `<script>(function(){` +
    `var roots=document.querySelectorAll('.ct-root > .ct-node.ct-has-sub:not(.ct-has-articles)');` +
    `Array.prototype.forEach.call(roots,function(n){n.classList.add('ct-open');` +
    `var l=n.querySelector('.ct-link');if(l)l.setAttribute('aria-expanded','true');});` +
    `var nodes=document.querySelectorAll('.ct-node.ct-has-sub');` +
    `Array.prototype.forEach.call(nodes,function(node){` +
    `var link=node.querySelector('.ct-link');if(!link)return;` +
    `link.addEventListener('click',function(e){e.preventDefault();e.stopPropagation();` +
    `var open=node.classList.toggle('ct-open');` +
    `link.setAttribute('aria-expanded',open?'true':'false');});` +
    `});})();</script>`
  );
}

hexo.extend.generator.register('categories_tree_page', function (locals) {
  const cats = locals.categories;
  const list = !cats ? [] : cats.toArray ? cats.toArray() : Array.from(cats);

  const { roots, all } = buildTree(list);
  const { allMap, directMap } = collectPosts(locals.posts);
  const total = applyCounts(roots, allMap);
  sortTree(roots);

  const html = renderTreeHTML(roots, all, total, { directMap });
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
