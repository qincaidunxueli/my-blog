/*!
 * 取消分类详情页（/categories/技术/基础漏洞/ 这种纯列表页）。
 * 分类浏览统一在 /categories/ 的层级树里完成。
 *
 * 用同名 generator 覆盖 hexo-generator-category 的 'category'，让它不产出任何页面；
 * /categories/ 总览由 scripts/category-tree.js 另外生成，不受影响。
 */

hexo.extend.generator.register('category', function () {
  return [];
});

// 站点地图里也不能留下这些已经不存在的地址
// 注意：after_generate 触发时文件还没落盘，必须等命令结束（exit）再改
const fs = require('fs');
const pathFn = require('path');

hexo.on('exit', function () {
  const file = pathFn.join(hexo.public_dir, 'sitemap.xml');
  if (!fs.existsSync(file)) return;

  const before = fs.readFileSync(file, 'utf8');
  const after = before.replace(
    /<url>\s*<loc>[^<]*\/categories\/[^<]+<\/loc>[\s\S]*?<\/url>\s*/g,
    ''
  );
  if (after !== before) fs.writeFileSync(file, after);
});
