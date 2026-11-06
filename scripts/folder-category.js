// 让文件夹结构决定分类：
//   _posts/技术/基础漏洞/sqli/sqlilab.md  →  分类「技术 > 基础漏洞 > sqli」
//   _posts/生活/hhh.md                   →  分类「生活」
//
// 规则（两条）：
//   1. 文章在 _posts 的子文件夹里 → 分类完全由文件夹路径决定，
//      头部写不写 categories 都无所谓（写了也会被文件夹覆盖）
//   2. 文章直接放在 _posts 根目录 → 分类仍由头部 categories 决定
//
// 层级任意深，文件夹套多少层就有多少层分类。
// 通过 Hexo 官方的 post.setCategories() 修改；挂在 before_generate 过滤器上，
// Hexo 会等它跑完才生成页面，保证首页/分类树/归档页拿到的都是最新分类。

hexo.extend.filter.register('before_generate', function () {
  const Post = hexo.model('Post');
  const RE = /^_posts\/(.+)\/[^/]+\.md$/;
  const jobs = [];

  Post.toArray().forEach((post) => {
    const m = RE.exec(post.source);
    if (!m) return; // 根目录的文章走 front-matter，不碰

    const names = m[1].split('/').filter(Boolean);
    if (!names.length) return;

    jobs.push(
      post.setCategories(names).then(() => {
        console.log('  folder-category: %s → %s', post.source, names.join(' > '));
      })
    );
  });

  return Promise.all(jobs);
});
