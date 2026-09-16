<h1>epubsite 规范 v1.2</h1>

<div align="center">
<b>零改写 EPUB → 静态单页阅读器</b><br>
<sub>把 EPUB 原封不动地放在静态托管上，用 htmx 叠加一层无刷新阅读体验，并保证每个可分享链接都落到阅读器而非裸页面上。</sub>
</div>

<blockquote>
<p><b>相对 v1.1 的修订</b>见文末附录 E。本次修订的主要内容：G2 不再要求逐字节一致（改为路径集合 + 字节长度等价）、放弃跨运行字节级可复现承诺、修正 htmx 产物文件名、把 <code>.epubsite-root</code> 纳入保留命名空间、补充宿主文件系统约束、<code>publication.json</code> 改为符合 W3C Publication Manifest REC 的扁平结构、<b>永久移除 <code>--book-dir</code>（子目录布局）</b>。</p>
</blockquote>

---

<h2>1. 概述</h2>

<h3>1.1 目标</h3>

<table>
<tr><th>#</th><th>目标</th><th>验收</th></tr>
<tr><td>G1</td><td>生成一个可静态托管的目录，双击任意章节都能阅读</td><td>基于 HTTP 服务，任意章节深链接可独立打开</td></tr>
<tr><td>G2</td><td><b>EPUB 内容零改写</b></td><td>排除保留命名空间后，站点上的条目路径集合与源 EPUB 中央目录一致，且每个文件与对应条目的<b>字节长度相同</b>（不要求逐字节一致）</td></tr>
<tr><td>G3</td><td>无刷新导航，侧边栏常驻</td><td>导航前后侧边栏 DOM 节点引用不变</td></tr>
<tr><td>G4</td><td>内容里的相对路径（图片、字体、样式、交叉链接）全部正确</td><td>端到端测试中<b>零 4xx</b></td></tr>
<tr><td>G5</td><td>分享链接落到阅读器，而非裸 EPUB 页面</td><td>分享按钮产出的 URL 打开后带侧边栏</td></tr>
<tr><td>G6</td><td>结构化数据：书籍级 + 章节级 JSON-LD，外加一份标准 Web Publication Manifest</td><td>两层 JSON-LD 通过 <code>@id</code> 互链成一张图；<code>publication.json</code> 通过规范校验</td></tr>
<tr><td>G7</td><td>产物可移植</td><td>换域名或换子路径部署无需重新构建（见 I4）</td></tr>
<tr><td>G8</td><td>可选：站内全文搜索</td><td><code>--search</code> 启用后，正文中的词可被检出并导航到对应章节</td></tr>
</table>

<h3>1.2 非目标</h3>

<table>
<tr><th>非目标</th><th>理由</th></tr>
<tr><td>支持 <code>file://</code> 直接打开</td><td>ES Module 与 XHR 在 <code>file://</code> 下受 CORS 限制。要求 HTTP 服务是明确前提</td></tr>
<tr><td>为每个章节生成独立可索引的 HTML 页面</td><td>与零改写冲突；且会破坏单一入口的 URL 模型</td></tr>
<tr><td>解密受 DRM 保护的 EPUB</td><td>检测到 <code>META-INF/encryption.xml</code> 即失败退出</td></tr>
<tr><td>固定版式（<code>pre-paginated</code>）EPUB 的 SPA 模式</td><td>固定像素视口与响应式壳不兼容；自动降级为多页模式</td></tr>
<tr><td>改写书的文件名或目录结构</td><td>零改写是硬约束。命名冲突一律<b>报错</b>（退出码 4），不靠改名，也不靠改变布局</td></tr>
<tr><td><b>把书放在站点子目录</b>（v1.1 曾预留的 <code>--book-dir</code>）</td><td>本方案的正确性建立在<b>站点根 = EPUB 根</b>这一条恒等式上（§3.1）。子目录布局会在三处同时打破它：<code>SITE_ROOT</code> 不再是书根（§5.2.2、I4）、404 引导的前缀剥离失去
唯一答案（§8.3 约束 2）、<code>?p=</code> 不再是站点相对路径（§8.2）。收益只是"站点根多一层"，代价是三处同时变复杂——不划算，因此<b>永久移除</b>，详见附录 E.9</td></tr>
<tr><td>同一个站点里放多本书</td><td>默认假设"一本书就是一个站点"。多书用部署路径（<code>/book-a/</code>、<code>/book-b/</code>）区分</td></tr>
</table>

<h3>1.3 术语</h3>

<table>
<tr><th>术语</th><th>定义</th></tr>
<tr><td><b>壳（shell）</b></td><td>生成的 <code>epubsite.html</code>：侧边栏 + 工具栏 + 内容容器，装载 htmx</td></tr>
<tr><td><b>章节文件</b></td><td>EPUB 内的 XHTML 文档（<code>spine</code> 中的项），原样复制到站点根</td></tr>
<tr><td><b>内容区</b></td><td><code>#epub-content</code>，唯一被 htmx 交换的节点</td></tr>
<tr><td><b>令牌路径</b></td><td>形如 <code>…/text/@ch3.xhtml</code> 的 URL：不对应任何真实文件，仅作为分享用的路由令牌</td></tr>
<tr><td><b>真实路径</b></td><td>形如 <code>…/text/ch3.xhtml</code> 的 URL：指向书里实际存在的文件</td></tr>
<tr><td><b>保留命名空间</b></td><td>站点根下由构建期独占的路径集合（§3.2）</td></tr>
<tr><td><b>文档基准</b></td><td>无 <code>&lt;base&gt;</code> 时的 <code>document.baseURI</code>，等于文档自身的 URL，每次访问时重新求值</td></tr>
</table>

---

<h2>2. 设计不变量</h2>

<p>整个系统可压缩为五条不变量。所有后续设计都是它们的推论；违反任意一条都会导致可观测的功能失效。</p>

<table>
<tr><th>#</th><th>不变量</th><th>违反的后果</th><th>保障手段</th></tr>
<tr><td><b>I1</b></td><td><b><code>location</code> 的目录部分必须等于当前章节文件的真实目录</b>（文件名可任意）</td><td>内容里所有相对 URL 解析错误 → 图片、字体、交叉链接全部失效</td><td>pushState 早于 swap；入口处 <code>replaceState</code></td></tr>
<tr><td><b>I2</b></td><td><b>壳自有 URL 一律绝对化</b>（对冻结的 <code>SITE_ROOT</code>）</td><td>侧边栏跳转后得到双层前缀路径 → 目录全灭；清单拉取 404 → 内容区空白</td><td>两条互补的路径：DOM 属性走 <code>data-shell</code> 标记 + 启动时一次性绝对化；<b>非属性的引用点</b>（<code>fetch</code>、<code>import</code>、<code>@import</code>、<code>htmx.ajax</code>）在其出现处直接 <code>new URL(…, SITE_ROOT)</code> 锚定</td></tr>
<tr><td><b>I3</b></td><td><b>禁止根相对路径（<code>/…</code>）</b>；允许由 <code>--base-url</code> 派生的完整绝对 URL</td><td>子路径部署（<code>/mybook/</code>）下全站 404</td><td>构建期校验 + 运行期对 <code>SITE_ROOT</code> 解析</td></tr>
<tr><td><b>I4</b></td><td><b>位置无关性只允许存在于 404 引导文件里</b>；壳必须始终被服务在它自己的位置上</td><td>壳失去 <code>SITE_ROOT</code> 的运行时来源 → 必须烘焙构建期 URL → 产物不可移植</td><td>架构约束（见 §8.2）</td></tr>
<tr><td><b>I5</b></td><td><b>内容区的每一次导航都必须 push URL</b></td><td>位置停在旧地址 → I1 失效</td><td>CI 断言（见 §13.1）</td></tr>
</table>

<h3>2.1 I1 为什么依赖 pushState</h3>

<p>htmx 的 <code>hx-boost</code> 导航顺序为：<mark>XHR 请求 → <code>pushState</code>(章节 URL) → 内容 swap → 浏览器解析新内容里的相对 URL</mark>。因为 URL 在 swap 之前就已更新，文档基准在解析发生时已指向章节文件所在目录，所以内容里的 <code>../Images/x.png</code>、<code>ch02.xhtml</code>、<code>#fn1</code> 全部自然正确。</p>

<p><b>推论：目录必须保留，只有文件名可以变。</b>这是令牌路径设计的硬约束：</p>

<pre><code>真实路径  /OEBPS/text/ch3.xhtml        目录 /OEBPS/text/
合法令牌  /OEBPS/text/@ch3.xhtml       ← 同目录，✓  ../Images/x.png → /OEBPS/Images/x.png
非法令牌  /OEBPS/@ch3.xhtml            ← 换了目录，✗  ../Images/x.png → /Images/x.png</code></pre>

<p>同理，令牌路径与真实路径之间必须是<b>路径的纯函数且互为双射</b>——因为 404 引导文件工作在任意深度、拿不到任何清单，只能靠字符串变换还原真实路径。</p>


---

<h2>3. 产物结构</h2>

<h3>3.1 站点根 = EPUB 根</h3>

<p><b>默认假设：一本书就是一个站点。</b>书直接铺在站点根，章节的真实 URL 就是它在书内的路径，不带任何前缀：</p>

<pre><code>https://mybook.surge.sh/OEBPS/text/ch03.xhtml      真实路径
https://mybook.surge.sh/OEBPS/text/@ch03.xhtml     令牌路径</code></pre>

<pre><code>dist/                              ← 站点根 = EPUB 根
├── epubsite.html                  壳（唯一入口，含静态书籍 JSON-LD）        ⟨保留⟩
├── index.html                     仅当书内无同名文件时生成：跳转到 epubsite.html  ⟨保留⟩
├── 404.html                       引导文件（自包含，零外部引用）            ⟨保留⟩
├── publication.json               Web Publication Manifest（附录 A.1）      ⟨保留⟩
├── _epubsite_assets/              壳的命名空间                              ⟨保留⟩
│   ├── htmx.esm.js                 htmx 2.0.10 ESM 构建（上游原件，未压缩）
│   ├── shell.js                   ES Module
│   ├── shell.css
│   ├── shell-data.json            壳的渲染数据（附录 A.2）
│   └── pagefind/                  可选：搜索索引（--search，附录 D）
├── _hosting/                      可选：托管平台配置片段
│   ├── netlify._redirects
│   ├── vercel.json
│   └── nginx.conf.snippet
├── mimetype                       ← 以下全部为 EPUB 原封不动（零改写）
├── META-INF/{container.xml, encryption.xml?}
└── OEBPS/
    ├── content.opf
    ├── nav.xhtml | toc.ncx
    ├── text/ch01.xhtml …
    ├── Images/…
    └── Styles/…</code></pre>

<table>
<tr><th>理由</th><th>说明</th></tr>
<tr><td>URL 无冗余前缀</td><td><code>book/</code> 这一层不携带信息——它就是"这本书"。省掉后托管规则、<code>--base-url</code>、令牌变换、搜索索引基准全部少一级</td></tr>
<tr><td>搜索索引天然对齐</td><td>Pagefind 的爬取根与结果 URL 基准都是站点根，与磁盘布局一致（附录 D）</td></tr>
<tr><td>404 根探测更可靠</td><td><code>/.epubsite-root</code> 落在书根，不与 <code>OEBPS/</code> 下的内容混淆（§8.3）</td></tr>
<tr><td>多书托管由部署层解决</td><td>需要同域多书时用部署路径而非构建期子目录，构建产物本身保持单书语义</td></tr>
</table>

<p><b>代价（必须明说）：</b>书里的 <code>mimetype</code>、<code>META-INF/</code> 会成为站点上可访问的普通文件。无害（内容固定），但属于"把打包元数据暴露到 Web 上"，如需遮蔽请用 §8.4 的托管规则。</p>

<h3>3.2 保留命名空间</h3>

<p>书占据了站点根，因此壳必须在一个<b>不可能与之碰撞</b>的命名空间里。以下路径由构建期独占，构建时逐项检测：</p>

<table>
<tr><th>保留路径</th><th>碰撞处理</th></tr>
<tr><td><code>epubsite.html</code></td><td><b>退出码 4</b>。它极不可能出现在书的顶层，出现了就是异常</td></tr>
<tr><td><code>index.html</code></td><td><b>不报错</b>。书内存在时原样保留，壳不生成中转页（见 §8.2 末）</td></tr>
<tr><td><code>404.html</code></td><td><b>退出码 4</b>，否则 404 引导机制整体失效</td></tr>
<tr><td><code>_epubsite_assets/**</code></td><td><b>退出码 4</b>。下划线前缀 + 品牌名，实际碰撞概率极低</td></tr>
<tr><td><code>publication.json</code></td><td><b>退出码 4</b></td></tr>
<tr><td><code>.epubsite-root</code></td><td><b>退出码 4</b>。§8.3 的根探测靠它，被书占了就失去位置无关性</td></tr>
<tr><td>任意 <code>@</code> 前缀的 basename</td><td><b>退出码 4</b>，令牌命名空间必须无冲突（§12）</td></tr>
</table>

---

<h2>4. 构建期</h2>

<h3>4.1 流水线</h3>

<pre><code>book.epub
   │
   ├─ 解压 ──────────────────→ dist/**（站点根，字节级原样）
   │        │                    碰撞检测：保留命名空间命中即退出码 4
   │        │
   │        └─ 无顶层 index.html → dist/index.html（跳转中转页）
   │
   ├─ META-INF/container.xml ─→ OPF 路径
   │        │
   │        ├─ &lt;metadata&gt; ──→ 书籍 JSON-LD（@id ← 规范化的 dc:identifier）
   │        ├─ &lt;manifest&gt; ──→ 章节清单 / 样式表引用 / cover-image
   │        └─ &lt;spine&gt; ─────→ 阅读顺序（唯一真相）
   │
   ├─ nav.xhtml 或 toc.ncx ──→ 导航树（label / href / 层级）
   │
   ├─ 逐章解析 head ─────────→ headStyles（外部 link + 内联 style）
   │
   ├─ 生成 404.html ─────────→ dist/404.html
   │
   ├─ 渲染壳 ────────────────→ dist/epubsite.html
   │
   ├─ 渲染清单 ──────────────→ dist/publication.json
   │
   └─ 生成资产 ─┬────────────→ dist/_epubsite_assets/{shell.js, shell.css, shell-data.json}
                ├────────────→ dist/_hosting/*（可选）
                └────────────→ 可选：运行 pagefind → dist/_epubsite_assets/pagefind/</code></pre>

<h3>4.2 EPUB 解析</h3>

<table>
<tr><th>步骤</th><th>要点</th></tr>
<tr><td>定位 OPF</td><td><code>META-INF/container.xml</code> → <code>rootfiles/rootfile/@full-path</code></td></tr>
<tr><td>元数据</td><td>EPUB3 的 <code>&lt;meta property&gt;</code> 与 EPUB2 的 <code>&lt;meta name/content&gt;</code> <b>双路解析</b>。EPUB3 的 <code>refines</code> 是判定作者／译者／绘者角色的唯一途径</td></tr>
<tr><td>spine</td><td><b>阅读顺序的唯一真相</b>。manifest 的顺序无意义</td></tr>
<tr><td>标识符选取</td><td>优先取 <code>&lt;package unique-identifier&gt;</code> 指向的那个（EPUB3 权威声明），其次 <code>opf:scheme="ISBN"</code>，最后第一个</td></tr>
<tr><td>加密检测</td><td>存在 <code>META-INF/encryption.xml</code> → 退出码 5</td></tr>
</table>

<h3>4.3 导航提取与 href 解析</h3>

<table>
<tr><th>格式</th><th>结构</th></tr>
<tr><td>EPUB3 <code>nav.xhtml</code></td><td><code>&lt;nav epub:type="toc"&gt;</code> 内的嵌套 <code>&lt;ol&gt;&lt;li&gt;&lt;a&gt;</code></td></tr>
<tr><td>EPUB2 <code>toc.ncx</code></td><td><code>&lt;navMap&gt;</code> 内嵌套的 <code>&lt;navPoint&gt;&lt;navLabel&gt;&lt;text&gt;</code> + <code>&lt;content src&gt;</code></td></tr>
</table>

<p>两者归一为同一棵树：<code>{ label, path, fragment, children[] }</code>。</p>

<p><b>href 解析的四条规则</b>——尤其第三条，不做则所有二级目录失效：</p>

<table>
<tr><th>href 形态</th><th>解析基准</th><th>说明</th></tr>
<tr><td><code>text/ch01.xhtml</code></td><td>导航文档所在目录</td><td>常规</td></tr>
<tr><td><code>../text/ch01.xhtml</code></td><td>导航文档所在目录</td><td>需折叠 <code>..</code></td></tr>
<tr><td><code>#s1</code>（纯片段）</td><td><b>上一个带路径的 href 所在文件</b></td><td>按 XML 规范它应相对导航文档，但那毫无意义。真实 EPUB 用它表示"同上一章内的锚点"</td></tr>
<tr><td>绝对 URL</td><td>原样</td><td>标记为外部，不参与 SPA</td></tr>
</table>

<p>不在 <code>spine</code> 中的导航项从主目录过滤掉（常见于封面、版权页），但保留为 landmarks 次级菜单。</p>

<h3>4.4 章节资产抽取</h3>

<p>构建期逐章解析 XHTML 的 <code>&lt;head&gt;</code>，抽出两类东西写入 <code>shell-data.json</code>：</p>

<table>
<tr><th>类型</th><th>抽取内容</th><th>运行期处理</th></tr>
<tr><td><code>linkStyles</code></td><td><code>&lt;link rel~="stylesheet"&gt;</code> 的 <code>href</code>（保持相对）</td><td>对 <code>SITE_ROOT</code> 绝对化后包成 <code>@import … layer(epub)</code></td></tr>
<tr><td><code>inlineStyles</code></td><td><code>&lt;style&gt;</code> 的文本内容</td><td>剥离顶层 <code>@import</code> 后包进 <code>@layer epub { … }</code></td></tr>
</table>

<p><b>为什么在构建期做：</b>把解析风险留在可单元测试的阶段，运行期只做查表。这也意味着运行期不需要解析任何 XHTML。</p>

<p><b>边界：</b>内联 <code>&lt;style&gt;</code> 若含顶层 <code>@import</code>，必须先摘出来转换为 <code>@import … layer(epub)</code>——<code>@import</code> 在 <code>@layer</code> 块内非法。</p>

<h3>4.5 结构化数据生成</h3>

<p>由一个函数同时产出三样东西，<b>保证同名属性天然一致</b>：</p>

<table>
<tr><th>产物</th><th>位置</th><th>见</th></tr>
<tr><td>书籍 JSON-LD</td><td><code>epubsite.html</code> 的 <code>&lt;head&gt;</code>（静态）</td><td>§7.2</td></tr>
<tr><td><code>metadata</code></td><td><code>publication.json</code></td><td>附录 A.1</td></tr>
<tr><td>章节节点</td><td><code>shell-data.json</code>，运行期注入</td><td>§7.3</td></tr>
</table>

<p><b>不要手工维护三份字段映射。</b>这是本设计最重要的一致性保证，详见 §7.1 与附录 C.7。</p>

<h3>4.6 壳渲染</h3>

<p>用 TypeScript 标签模板字面量 + 转义助手直接生成，不引入模板引擎——只产出两个文件，引擎带来的依赖与心智负担不划算。</p>

<h3>4.7 404 引导与 <code>index.html</code> 中转页</h3>

<p>两者都是自包含、无外部引用的纯入口文件（见 §8.3）。区别在于：404 引导位置无关，中转页固定在站点根。</p>

<h3>4.8 托管规则生成（可选）</h3>

<p>按书的实际路径与 <code>--base-url</code> 生成，见 §8.4。</p>

---

<h2>5. 运行期</h2>

<h3>5.1 壳结构</h3>

```html
<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>书名</title>
<link rel="canonical" href="…">                     <!-- 仅在 --base-url 为绝对形态时输出 -->
<script type="application/ld+json">{ … 书籍节点 … }</script>
<link rel="stylesheet" href="_epubsite_assets/shell.css">
<!-- 运行期槽位（由 shell.js 独占） -->
</head>

<body hx-boost="true"
      hx-target="#epub-content"
      hx-swap="innerHTML show:top"
      hx-indicator="#progress">

  <a class="skip-link" href="epubsite.html#epub-content" data-shell>跳到正文</a>

  <nav id="toc" aria-label="目录">
    <!-- 构建期生成的嵌套 <ol>；href 为文档相对，运行期绝对化 -->
    <ol><li><a href="OEBPS/text/ch01.xhtml" data-shell>第一章</a>…</li></ol>
  </nav>

  <div id="frame">
    <header id="toolbar">
      <button id="toc-toggle" aria-expanded="true" aria-controls="toc">目录</button>
      <span id="book-title">书名</span>
      <button id="search-open">搜索</button>              <!-- 仅 --search 时输出 -->
      <button id="share" data-shell-share>复制链接</button>
      <div id="progress" class="htmx-indicator">加载中…</div>
    </header>
    <main id="epub-content" tabindex="-1" aria-live="polite">…落地页…</main>
  </div>

  <script type="module" src="_epubsite_assets/shell.js"></script>
</body>
</html>
```

<table>
<tr><th>属性</th><th>作用与理由</th></tr>
<tr><td><code>hx-boost="true"</code>（在 body）</td><td>零改写前提下唯一能自动接管正文里成百上千条 EPUB 原生链接的机制，且可继承。<b>若不覆盖它的默认行为，侧边栏会被一起交换掉</b></td></tr>
<tr><td><code>hx-target="#epub-content"</code></td><td>覆盖 boost 的默认 target（<code>&lt;body&gt;</code>）。<b>侧边栏得以保留的全部原因</b>——它在 target 之外，htmx 从不触碰，滚动位置、展开状态、焦点自然保持</td></tr>
<tr><td><code>hx-swap="innerHTML"</code></td><td>用 <code>outerHTML</code> 会连 <code>#epub-content</code> 节点本身一起重建，挂在其上的状态每次都要重来</td></tr>
<tr><td><code>show:top</code></td><td>翻章后视口归顶；不加则长章节间跳转会停在随机位置</td></tr>
</table>

<p><b>禁止在壳的任何元素上加 <code>data-pagefind-body</code>。</b>该属性是全站级开关：站点上任何一页带它，没带的页面就不再被索引。壳上一放会让所有原文退出索引。构建期 lint 应断言它不存在（附录 D.2）。</p>

<h3>5.2 URL 与基准机制</h3>

<h4>5.2.1 为什么不需要 <code>&lt;base&gt;</code></h4>

<p>没有 <code>&lt;base&gt;</code> 时，文档基准 = <code>window.location</code>，且每次访问时重新求值。htmx 2.0.10 的 boost 顺序（先 push 后 swap）使 I1 自动成立，因此不需要任何属性级 URL 重写。</p>

<p>不使用 <code>&lt;base&gt;</code> 还额外避开一个陷阱：若用 <code>&lt;base href="…/text/"&gt;</code>（目录形式），纯片段链接 <code>&lt;a href="#fn1"&gt;</code> 会解析为 <code>…/text/#fn1</code>，与文档 URL 不等，浏览器会将其当作<b>跨文档导航整页跳走</b>。EPUB 的脚注体系几乎全靠纯片段链接，这会当场全灭。</p>

<h4>5.2.2 站点根的确定（I4）</h4>

<pre><code>const SITE_ROOT = new URL('.', location.href);   // ES Module 执行时冻结</code></pre>

<p>这行只有在<b>壳被服务在自己的位置上</b>时才正确。它成立的前提由 §8 的入口协议保证：404 引导总是把浏览器导航到 <code>{SITE_ROOT}epubsite.html?p=…</code>，因此壳加载时 <code>location</code> 就在站点根。</p>

<p><b>入口协议必须直指 <code>epubsite.html</code>，不得经过 <code>index.html</code> 中转</b>（§8.3 约束 5）。</p>

<p>冻结之后，任何后续的 <code>replaceState</code> 都影响不到它——这是子路径部署与入口跳转能同时正确的关键。</p>

<h4>5.2.3 重写托管下的站点根</h4>

<p>采用 <code>--hosting rewrite</code> 时壳会被服务在深路径上，<code>SITE_ROOT</code> 无法从 <code>location</code> 推导，改由构建期烘焙的 <code>data-site-root</code> 读取：</p>

<pre><code>const SITE_ROOT = new URL(
  document.documentElement.dataset.siteRoot || '.',
  location.href
);</code></pre>

<p>未烘焙时回落到 <code>'.'</code>，即 §5.2.2 的行为。<b>这个分支是 I4 的直接体现</b>：一旦依赖烘焙值，产物即失去可移植性（§8.4）。</p>

<h3>5.3 壳自有链接绝对化（I2）</h3>

<pre><code>function absolutizeShell() {
  for (const a of document.querySelectorAll('[data-shell][href]')) {
    if (a.dataset.abs) continue;                                  // 幂等
    a.setAttribute('href', new URL(a.getAttribute('href'), SITE_ROOT).href);
    a.dataset.abs = '1';
  }
}</code></pre>

<p>用 <code>data-shell</code> 显式标记而非靠 CSS 选择器猜——将来新增壳链接时不会漏。用 <code>setAttribute</code> 而非 <code>a.href =</code>，让 DOM 属性与 IDL 属性保持一致。</p>

<p><b>为什么必须做：</b>pushState 到嵌套路径后，文档里<i>任何</i>相对 URL 的解析基准都会变。侧边栏的 <code>OEBPS/text/ch01.xhtml</code> 会解析成 <code>…/text/OEBPS/text/ch01.xhtml</code>。这不是 htmx 的问题，是 pushState 改变路径的固有后果。</p>

<p><b>但标记法只覆盖 DOM 属性。</b><code>shell-data.json</code> 的拉取不是属性，逃过了它。I2 因此有第二条路径——见 §5.4。</p>

<h3>5.4 章节资产同步（head 槽位）</h3>

<h4>5.4.1 启动顺序</h4>

<p>启动阶段的语句顺序是<b>正确性的一部分</b>，不只是风格：</p>

<pre><code>1. 冻结 SITE_ROOT
2. 绝对化壳自有链接（DOM 属性）
3. 入口判定 → history.replaceState(真实路径或落地页)   ← 必须在任何内容解析之前
4. 拉取 shell-data.json（绝对 URL，见下）
5. 若入口带章节 → htmx.ajax 取章节；否则渲染落地页</code></pre>

<p><b>第 4 步必须用绝对 URL。</b>第 3 步已经把文档基准换成了章节目录，此时用相对路径 fetch 会请求到 <code>/OEBPS/text/_epubsite_assets/shell-data.json</code> → 404，内容区永久空白：</p>

<pre><code>const dataUrl = new URL('_epubsite_assets/shell-data.json', SITE_ROOT);
const DATA = await (await fetch(dataUrl)).json();</code></pre>

<p>不要依赖"module 是 defer 的、执行时 <code>location</code> 尚未被 replaceState"这一时序来侥幸通过——正确性会被挂死在语句顺序上，任何重构都可能无声破坏它。<b>显式锚定对时序免疫，是唯一可接受的写法。</b>这正是 I2 第二条路径的实例。</p>

<h4>5.4.2 <code>syncChapter</code></h4>

<p>章节相关的运行期状态有四项，键都是同一条章节相对路径，因此合并为一次调用：</p>

```js
function syncChapter(key) {
  const ch = DATA.byKey[key];
  if (!ch) return;
  syncStyles(ch.headStyles);     // §5.5
  syncJsonLd(ch.jsonld);         // §5.6
  syncBodyAttrs(ch);             // innerHTML swap 会丢 <body> 的 class/dir/lang
  highlightNav(ch.key);          // aria-current + 父级展开
}
```

<p>调用点：<code>htmx:afterSwap</code> 与 <code>htmx:historyRestore</code>。</p>

<h4>5.4.3 声明式槽位与构建期校验</h4>

<p>壳的 <code>&lt;head&gt;</code> 里标注槽位：</p>

```html
<link rel="stylesheet" href="_epubsite_assets/shell.css">
<!-- 运行期由 shell.js 独占 -->
```

<p>shell.js 维护两张注册表，按绝对 URL 或 <code>@id</code> 去重，只增删差集：</p>

```js
const styles = new Map();   // absUrl -> <style>
const lds    = new Map();   // @id    -> <script>
```

<p><b>构建期 lint：</b>断言壳的 <code>&lt;head&gt;</code> 里除静态壳元素外不含未声明的内容，并断言不存在 <code>data-pagefind-body</code>。用编译期检查替代运行期失败发现。</p>

<h3>5.5 样式与级联层</h3>

<pre><code>/* 外链样式 */
&lt;style&gt;@import url("https://…/Styles/style.css") layer(epub);&lt;/style&gt;

/* 内联样式（顶层 @import 已摘出） */
&lt;style&gt;@layer epub { /* 原内联内容 */ }&lt;/style&gt;</code></pre>

<p>三个要点：</p>

<table>
<tr><th>#</th><th>要点</th><th>理由</th></tr>
<tr><td>1</td><td>入口 URL 必须是绝对 URL</td><td>内联 <code>&lt;style&gt;</code> 里 <code>@import</code> 的基准是<b>文档基准</b>，而文档基准每章都在变。这不是优化，是正确性要求——I2 第二条路径的又一实例</td></tr>
<tr><td>2</td><td>外链 CSS 内部的 <code>url()</code> 无需处理</td><td>它以 CSS 文件自身为基准，只要入口 URL 正确，它引用的一切都正确</td></tr>
<tr><td>3</td><td>包进 <code>layer(epub)</code></td><td>在 <code>shell.css</code> 顶部声明 <code>@layer epub, shell;</code> 即可让壳样式在冲突时胜出，保护布局不被 EPUB 的全局规则（<code>html{}</code>、<code>body{}</code>）破坏</td></tr>
</table>

<p>作为纵深防御，<code>shell.css</code> 对布局关键属性（<code>html, body</code> 的 <code>display/margin/padding/overflow/height</code>）使用高特异性 + <code>!important</code>。</p>

<h3>5.6 章节 JSON-LD 的注入</h3>

```js
function syncJsonLd(node) {
  for (const el of lds.values()) el.remove();
  lds.clear();
  if (!node) return;
  const s = document.createElement('script');
  s.type = 'application/ld+json';
  s.dataset.epubLd = '';
  s.textContent = JSON.stringify(node).replace(/</g, '\\u003c');
  document.head.appendChild(s);
  lds.set(node['@id'], s);
}
```

<p><b>为什么注入 <code>&lt;head&gt;</code> 而不是让它随内容一起 swap：</b>因为 <code>htmx.config.allowScriptTags = false</code>（§10）会让 htmx 在插入内容时丢弃所有 <code>&lt;script&gt;</code> 标签，包括 <code>type="application/ld+json"</code>。而由我们自己 <code>createElement</code> 的元素不受该配置约束（它只管 htmx 插入的内容），安全与元数据两得。</p>

<p><b>清理时只删 <code>[data-epub-ld]</code></b>——书籍级 JSON-LD 是静态的、不带该标记，永远不被触碰。</p>

<h3>5.7 导航交互</h3>

<table>
<tr><th>项</th><th>做法</th><th>理由</th></tr>
<tr><td>同章片段短路</td><td><code>htmx:beforeRequest</code> 里比较解析后的 pathname，相同则 <code>preventDefault()</code> 并直接设 <code>location.hash</code></td><td>EPUB 目录里大量 <code>./ch01.xhtml#sec3</code> 形式的链接；不短路会重新请求并重绘同一章</td></tr>
<tr><td>跨章脚注</td><td><code>afterSettle</code> 读 <code>location.hash</code> → <code>scrollIntoView()</code> + 短暂高亮</td><td>片段不参与 swap，浏览器不会自动滚动</td></tr>
<tr><td>同章脚注</td><td>不干预</td><td>htmx 的 boost 会跳过纯 <code>#</code> 链接，浏览器原生处理</td></tr>
<tr><td>侧边栏高亮</td><td>按 <code>location.pathname</code> 查 <code>shell-data.json</code> → 更新 <code>aria-current="page"</code> 与父级展开</td><td>侧边栏在 swap 范围之外，htmx 不会帮你同步</td></tr>
<tr><td>焦点</td><td>swap 后 <code>#epub-content.focus()</code>（已有 <code>tabindex="-1"</code>）</td><td>否则键盘／读屏用户点目录后焦点留在侧边栏，Tab 会走回头路</td></tr>
</table>

<h3>5.8 分享</h3>

<p>分享按钮把当前章节的真实路径转换为<b>令牌路径</b>，再对 <code>SITE_ROOT</code> 绝对化后写入剪贴板：</p>

```js
function toToken(realAbsUrl) {
  const u = new URL(realAbsUrl);
  const i = u.pathname.lastIndexOf('/');
  u.pathname = u.pathname.slice(0, i + 1) + '@' + u.pathname.slice(i + 1);
  return u.href;                              // 保留 fragment
}
```

<p><code>@</code> 是<b>路由令牌，不是地址</b>：它只在分享字符串里出现，一旦被访问就执行完使命，随即被入口协议替换为真实路径（§8.2）。</p>

<p><b>这是令牌路径在整个系统中的唯一用途。</b>它不出现在 <code>publication.json</code> 的 <code>readingOrder</code>、不出现 canonical、不出现在 Open Graph。理由见 §8.5 与附录 C.7。</p>

---

<h2>6. Head 管理策略 · 决策记录</h2>

<h3>6.1 结论</h3>

<p align="center"><b>不使用 htmx 的 <code>head-support</code> 扩展。改用 §5.4 的声明式槽位 + 构建期 lint。</b></p>

<h3>6.2 为什么不使用 head-support</h3>

<p>该扩展在 boosted 请求下走 merge 算法：当前 head 里存在、而新 head 里没有的元素会被<b>删除</b>。这本身可以用 <code>hx-preserve="true"</code> 化解，但以下四点使其净值转负（以下依据来自对其 2.0.5 源码的审阅）：</p>

<table>
<tr><th>#</th><th>问题</th><th>源码依据 / 后果</th></tr>
<tr><td>1</td><td><b>合并策略不可切换。</b>策略由 <code>evt.detail.boosted ? "merge" : "append"</code> 决定，而 <code>hx-head</code> 属性只能写在<b>响应</b>的 head 上。章节是零改写的，我们改不了它</td><td>永远被锁死在破坏性的 merge 模式，<code>append</code> 这条退路不存在</td></tr>
<tr><td>2</td><td><b>安全回归。</b>扩展全文不检查 <code>config.allowScriptTags</code>，对章节 head 里的一切无条件 <code>appendChild</code>；且插入用的是 <code>document.createRange().createContextualFragment()</code></td><td>与 <code>innerHTML</code> 的关键差异正在于它会执行脚本（这也是它被列为 Trusted Types 危险接收器的原因）。EPUB 是不可信输入，这绕过了我们唯一的脚本防线</td></tr>
<tr><td>3</td><td><b>层包装会丢失。</b>扩展原样插入 <code>&lt;link&gt;</code> / <code>&lt;style&gt;</code></td><td>EPUB 的全局规则（<code>html{}</code>、<code>body{}</code>）将无法被 <code>@layer</code> 隔离</td></tr>
<tr><td>4</td><td><b>历史恢复冲突。</b>它在 <code>htmx:historyItemCreated</code> 里保存 <code>document.head.outerHTML</code>，其中<b>包含我们动态注入的槽位内容</b>；<code>historyRestore</code> 时会把它们 merge 回来</td><td>与 §5.4 的注册表重复添加，需要额外的 veto 逻辑</td></tr>
</table>

<h3>6.3 决定性论证</h3>

<p>上述每个问题都有对应的钩子（<code>htmx:beforeHeadMerge</code> 可取消整次合并、<code>htmx:addingHeadElement</code> / <code>htmx:removingHeadElement</code> 可 <code>preventDefault()</code>），但一旦启用这些钩子去否决 <code>&lt;meta&gt;</code>／<code>&lt;script&gt;</code>、把 <code>&lt;link&gt;</code> 改写成 layer 包装版本，<b>就等于把 §5.4 的注册表重写了一遍</b>——而且多了一个第三方扩展依赖、一份需要逐元素维护的 <code>hx-preserve="true"</code> 清单（注意：该属性必须写成字符串 <code>"true"</code>，布尔形式静默失效），以及历史恢复的重复注入问题。</p>

<p>补充两个实现细节，说明这条路比看起来更滑：<code>htmx:addingHeadElement</code> 的 <code>detail.headElement</code> 是 <code>DocumentFragment</code>，而 <code>htmx:removingHeadElement</code> 的是 <code>Element</code>——两者不对称；merge 分支的元素还会被 <code>removingHeadElement</code> 触发<b>两次</b>。</p>

<h3>6.4 判断规则</h3>

<p><b>取决于 head 内容在构建期是否可知。</b></p>

<table>
<tr><th>场景</th><th>正确工具</th></tr>
<tr><td><b>EPUB → 静态站</b></td><td>构建期逐个解析章节 head，抽成 <code>shell-data.json</code> 条目。<b>内容完全可知，扩展的前提不成立</b></td></tr>
<tr><td>任意 HTML 站点 → SPA（head 由服务端渲染、构建期未知）</td><td>head-support 才是对的工具</td></tr>
</table>

<p>另有一个额外条件让它更不划算：我们真正需要的 head 能力，htmx 核心已经免费提供——它会从响应中提取 <code>&lt;title&gt;</code> 并更新 <code>document.title</code>。剩下只有"样式 + JSON-LD"两件事，而 JSON-LD 本来就<b>不能</b>走它（我们要构造自己的节点，不是搬运章节里的 meta），所以注册表无论如何都得有。</p>

---

<h2>7. JSON-LD 图模型</h2>

<h3>7.1 两层一图，外加一份清单</h3>

<p>两层不是两份数据，而是同一张图的两个片段，靠共享的 <code>@id</code> 合并：</p>

<pre><code>epubsite.html &lt;head&gt;（静态）             运行期注入 &lt;head&gt;（动态，仅当前章）
┌────────────────────────────┐           ┌─────────────────────────────┐
│ Book  @id = urn:isbn:…     │◄──────────┤ Chapter @id = bookId#ch-3    │
│   hasPart: [               │  isPartOf │   name / position /          │
│     {@id: bookId#ch-1, …}, │           │   articleSection / url / …   │
│     {@id: bookId#ch-2, …}, │           └─────────────────────────────┘
│     …                      │
│   ]                        │
└────────────────────────────┘
       ↑ 不执行 JS 的爬虫看到的完整图        ↑ JS 消费者看到的当前章</code></pre>

<p><b>书籍节点的同一份数据还充当 <code>publication.json</code> 的 <code>metadata</code>。</b>三者由同一个构建期函数产出，同名属性天然一致，合并无矛盾。这是本设计最重要的一致性保证：不要手工维护三份字段映射。</p>

<h3>7.2 书籍节点</h3>

```json
{
  "@context": "https://schema.org",
  "@type": "Book",
  "@id": "urn:isbn:9780000000000",
  "url": "https://example.com/mybook/epubsite.html",
  "name": "书名",
  "alternateName": "副标题",
  "author": [{ "@type": "Person", "name": "作者" }],
  "translator": [{ "@type": "Person", "name": "译者" }],
  "publisher": { "@type": "Organization", "name": "出版社" },
  "isbn": "9780000000000",
  "identifier": "urn:uuid:…",
  "inLanguage": "zh-CN",
  "datePublished": "2024-01-01",
  "dateModified": "2026-01-01T00:00:00Z",
  "bookFormat": "https://schema.org/EBook",
  "abstract": "…",
  "image": "https://example.com/mybook/OEBPS/Images/cover.jpg",
  "keywords": ["…"],
  "hasPart": [
    {
      "@type": ["Chapter", "Article"],
      "@id": "urn:isbn:9780000000000#ch-1",
      "name": "第一章 …",
      "url": "https://example.com/mybook/OEBPS/text/ch01.xhtml",
      "position": 1,
      "articleSection": "第一卷"
    }
  ]
}
```

<h3>7.3 章节节点</h3>

```json
{
  "@context": "https://schema.org",
  "@type": ["Chapter", "Article"],
  "@id": "urn:isbn:9780000000000#ch-3",
  "url": "https://example.com/mybook/OEBPS/text/ch03.xhtml",
  "name": "第三章 …",
  "headline": "第三章 …",
  "position": 3,
  "articleSection": "第一卷",
  "inLanguage": "zh-CN",
  "isPartOf": {
    "@type": "Book",
    "@id": "urn:isbn:9780000000000"
  }
}
```

<h3>7.4 决策：<code>@id</code> 用标识符而非 URL</h3>

<p><code>@id</code> 的语义是<b>身份</b>，<code>url</code> 的语义是<b>位置</b>。分开之后：</p>

<table>
<tr><th>好处</th><th>说明</th></tr>
<tr><td>站点迁移不断链</td><td>换域名、换子路径，图结构不变</td></tr>
<tr><td>多部署实例指向同一节点</td><td>同一本书的多个镜像可以共用一个 <code>@id</code></td></tr>
<tr><td><b>与 URL 方案解耦</b></td><td>令牌路径、托管重写等 URL 层决策无论怎么改，都不影响身份</td></tr>
</table>

<p><b>规范化规则</b>（<code>dc:identifier</code> 不保证是合法 IRI）：</p>

<table>
<tr><th>OPF 中的形态</th><th>产出的 <code>@id</code></th></tr>
<tr><td><code>urn:isbn:…</code> / <code>urn:uuid:…</code></td><td>原样</td></tr>
<tr><td><code>9780000000000</code> / <code>0-00-000000-0</code></td><td><code>urn:isbn:</code> + 去连字符规范化</td></tr>
<tr><td>裸 UUID</td><td><code>urn:uuid:</code> + 小写化</td></tr>
<tr><td>无法解析的自由文本</td><td><code>urn:epubsite:</code> + 该串 sha256 前 16 位（并告警）</td></tr>
</table>

<p>章节身份同样派生：<code>@id = {bookId}#ch-{spine 序号}</code>（URN 的 fragment 成分，RFC 8141 允许）。</p>

<h3>7.5 字段映射</h3>

<table>
<tr><th>JSON-LD 字段</th><th>来源</th></tr>
<tr><td><code>@id</code>（书 / 章）</td><td>规范化的 <code>dc:identifier</code> / 派生 <code>{bookId}#ch-N</code></td></tr>
<tr><td><code>url</code></td><td><b>仅在 <code>--base-url</code> 为绝对形态时输出</b>，值为 <code>{base}epubsite.html</code>（书）或 <code>{base}{章节真实路径}</code>；否则<b>整个字段省略</b>（相对 URL 在 JSON-LD 中语义很弱）</td></tr>
<tr><td><code>name</code></td><td><code>dc:title</code>（<code>title-type=main</code>）；章节取 nav label</td></tr>
<tr><td><code>author[]</code> / <code>translator[]</code></td><td><code>dc:creator</code>/<code>dc:contributor</code> + <code>refines role</code>（EPUB3）或 <code>opf:role</code>（EPUB2）</td></tr>
<tr><td><code>isbn</code> / <code>identifier</code></td><td><code>dc:identifier</code> 按 <code>opf:scheme</code> 分流；剥离 <code>urn:isbn:</code> 前缀得到 <code>isbn</code></td></tr>
<tr><td><code>abstract</code></td><td><code>dc:description</code>，<b>必须剥离 HTML 标签并转义</b></td></tr>
<tr><td><code>image</code></td><td>manifest 中 <code>properties="cover-image"</code> 的项。<b>与 <code>url</code> 同规则</b>：仅在 <code>--base-url</code> 为绝对形态时输出</td></tr>
<tr><td><code>position</code></td><td>spine 序号（1-based）</td></tr>
<tr><td><code>articleSection</code></td><td>nav 树中该节点的直接父节点 label；顶层章节省略</td></tr>
<tr><td><code>isPartOf</code></td><td><b>书籍节点本身</b>。v1.1 曾写作"嵌套目录时为祖先链数组"，本次修正为单节点，理由见 E.11</td></tr>
</table>

<h3>7.6 为什么 <code>@type</code> 是数组</h3>

<p>schema.org 没有通用的 <code>section</code> 属性。想表达"属于哪一卷／栏目"，标准做法是 <code>articleSection</code>——但它定义在 <code>Article</code> 上，而 <code>Chapter</code> 并非 <code>Article</code> 的子类。用多类型 <code>["Chapter", "Article"]</code> 让 <code>Chapter</code> 作为主类型的同时获得 <code>articleSection</code>，是合法且不引入私有属性的解法。</p>

<table>
<tr><th>想表达</th><th>属性</th></tr>
<tr><td>所属卷／栏目</td><td><code>articleSection</code>（需同时声明 <code>Article</code>）</td></tr>
<tr><td>完整祖先链</td><td><code>isPartOf</code>（单节点）；祖先链形式已否决，见 E.11</td></tr>
<tr><td>下级子节</td><td><code>hasPart</code></td></tr>
<tr><td>章节标题</td><td><code>name</code> + <code>headline</code></td></tr>
<tr><td>阅读顺序</td><td><code>position</code></td></tr>
</table>

<h3>7.7 局限（必须明说）</h3>

<table>
<tr><th>局限</th><th>后果</th><th>缓解</th></tr>
<tr><td>动态注入的章节节点只对<b>执行 JS</b> 的消费方可见</td><td>非 JS 爬虫看不到"某一章页面"的 JSON-LD</td><td>书籍节点的静态 <code>hasPart</code> 已含全部章节的 <code>name</code>/<code>url</code>/<code>position</code>——信息没丢，只是挂在 Book 节点下。此外 <code>publication.json</code> 的 <code>readingOrder</code> 提供了第二条不依赖 JS 的通路</td></tr>
<tr><td>直接访问章节文件（刷新、分享真实路径）时没有壳</td><td>该请求完全没有 JSON-LD</td><td>零改写的必然结果</td></tr>
<tr><td>章节 <code>url</code> 在纯 404 托管下返回 404 状态码</td><td>该 URL 不可被索引</td><td>这类 URL 只作分享用；需要索引则启用 §8.4 的托管重写</td></tr>
</table>

---

<h2>8. URL 与入口 · 决策记录</h2>

<h3>8.1 问题</h3>

<p>若不做任何处理，htmx 会把地址栏 push 成章节的<b>真实路径</b>。用户从这里复制链接分享出去，接收方打开它时，浏览器会直接加载那个 XHTML 文件——<b>一个没有侧边栏、没有导航、没有 JSON-LD 的裸页面</b>。</p>

<h3>8.2 方案：令牌路径 + 404 引导</h3>

<p>引入一个不承载任何文件的<b>令牌命名空间</b>，作为"阅读器视角下的章节地址"：</p>

<pre><code>真实路径   /OEBPS/text/ch03.xhtml      ← 文件存在，直接访问得到裸页面
令牌路径   /OEBPS/text/@ch03.xhtml     ← 文件不存在，404 → 引导 → 壳</code></pre>

<p><b>令牌路径与真实路径只在 basename 上相差一个 <code>@</code></b>，目录完全一致。这不是美学选择，是 I1 的硬要求（§2.1）：目录若不同，壳里内容的相对 URL 会全部解析错。同时这个变换是纯函数且互为双射，使工作在任意深度、拿不到清单的 404 引导文件可以还原真实路径。</p>

<h4>入口流程</h4>

<pre><code>用户打开  /OEBPS/text/@ch03.xhtml#fn1
     │
     │  该路径不存在
     ↓
  404.html（自包含引导，位置无关）
     │  校验 basename 以 @ 开头 → 剥掉 @ 得真实路径
     │  location.replace('{SITE_ROOT}epubsite.html?p=OEBPS/text/ch03.xhtml&h=fn1')
     │                                                        ↑ 直指壳，不经过 index.html
     ↓
  壳加载于自己的位置  ← 关键：SITE_ROOT 可由 location 推导（I4）
     │
     ├─ 冻结 SITE_ROOT
     ├─ 绝对化壳自有链接
     ├─ history.replaceState('/OEBPS/text/ch03.xhtml')       ← 必须在 swap 之前
     ├─ 拉取 shell-data.json（绝对 URL）
     └─ htmx.ajax 取章节（绝对 URL）；若有 h → 滚动到锚点
     ↓
  #epub-content 更新，侧边栏不动</code></pre>

<h4>入口协议必须绕开 <code>index.html</code></h4>

<p>站点根多了 <code>index.html</code> 这个文件，它的职责与入口协议<b>完全分离</b>，两者不得交叉：</p>

<table>
<tr><th>文件</th><th>职责</th><th>携带参数</th></tr>
<tr><td><code>epubsite.html</code></td><td>壳。承载<b>全部</b>入口判定（§8.4）</td><td><code>?p=</code> / <code>?h=</code> / <code>@</code>-basename</td></tr>
<tr><td><code>index.html</code></td><td><b>仅</b>处理"裸访问站点根"这一种情形，跳转到 <code>epubsite.html</code></td><td><b>无</b></td></tr>
</table>

<p>把带 <code>?p=</code> 的入口送过中转页，是<b>唯一会静默打断整条令牌链路</b>的写法：中转页若不显式转发 <code>location.search</code>，<code>?p=</code> 与 <code>?h=</code> 当场丢失，令牌深链接退化为落地页，G5 与 §13.2 的深链接用例一并失效。因此规范强制 404 引导直指 <code>epubsite.html</code>，并在 §8.3 约束 5 为中转页本身加上转发要求作为纵深防御。</p>

<p><b>为什么 <code>replaceState</code> 不是美化而是必需：</b>壳加载在 <code>/epubsite.html?p=…</code> 上时，文档基准的目录是 <code>/</code>，内容里的 <code>../Images/x.png</code> 会解析到 <code>/Images/x.png</code>——全错。必须先换基准再 swap。这与 htmx 把 push 提前到 swap 之前是同一个道理：<b>基准的切换必须发生在消费方解析之前。</b></p>

<p><b>为什么 <code>replaceState</code> 的目标是真实路径而非令牌路径：</b>地址栏应始终指向实际被阅读的那一章。用令牌路径会让地址栏长期停在一个不对应任何文件的 URL 上；而因为 htmx 在 SPA 内导航时 push 的就是真实路径，令牌形式只会在入口那一刻短暂存在、随后立刻与其余导航保持一致。文档化的代价是：在真实路径上刷新会得到裸页面。</p>

<p><b>当书的顶层已存在 <code>index.html</code> 时，壳不生成中转页</b>（§3.2）。此时站点根打开的是书自己的那个文档——<b>没有侧边栏的裸页面</b>。这是扁平布局的已知代价，无法在不改名用户文件的前提下消除。它被<b>接受</b>而不是绕开：唯一的绕法是子目录布局，而子目录布局会同时打破 §3.1 的恒等式（见 §1.2 与附录 E.9）。需要站点根就是阅读器时，把书内那个 <code>index.html</code> 改成别的名字——那是书作者的决定，不是构建期的。</p>

<h3>8.3 入口文件的约束</h3>

<p>站点上有两个纯入口文件：<code>404.html</code>（约束 1–4）与 <code>index.html</code> 中转页（约束 5）。前者位置无关，后者固定在站点根，因此二者的约束不完全相同。</p>

<table>
<tr><th>#</th><th>约束</th><th>违反的后果</th></tr>
<tr><td>1</td><td><b>完全自包含、零外部引用</b>。它被服务在<b>缺失的那个路径上</b>，内部任何相对 URL 都以那个深路径为基准解析</td><td><code>&lt;script src="_epubsite_assets/x.js"&gt;</code> 会去请求 <code>/OEBPS/text/_epubsite_assets/x.js</code>，再次 404</td></tr>
<tr><td>2</td><td><b>必须知道站点根。</b>它在任意深度被服务，靠 <code>../../../</code> 推算在子路径部署下必然算错</td><td>重定向到错误位置。方案见下</td></tr>
<tr><td>3</td><td><b>只对匹配 <code>@</code> 模式的路径重定向</b></td><td>缺失的图片／字体也会被劫持去加载壳，把资源缺失伪装成"章节加载中"，排查成本极高</td></tr>
<tr><td>4</td><td><b>用 <code>location.replace()</code> 而非赋值 <code>location.href</code></b></td><td>用户按后退会回到 404 页，形成退不出去的死循环</td></tr>
<tr><td>5</td><td><b><code>index.html</code> 中转页必须转发 <code>location.search</code> 与 <code>location.hash</code>，并用 <code>location.replace()</code> + 相对 URL</b>：<br><code>location.replace('epubsite.html' + location.search + location.hash)</code></td><td>不转发则 <code>?p=</code>／<code>?h=</code> 丢失（令牌深链接退化为落地页）；用 <code>location.href</code> 或 <code>&lt;meta http-equiv="refresh"&gt;</code> 则产生历史记录项，后退落到中转页又被弹走，形成死循环——与约束 4 同源</td></tr>
</table>

<p><b>约束 2 的两种实现：</b></p>

<table>
<tr><th>做法</th><th>可移植性</th><th>成本</th></tr>
<tr><td>构建期把 <code>--base-url</code> 的路径形态写入引导文件</td><td>绑定，但仅限这一个十几行的文件；换域名时重新生成即可</td><td>零</td></tr>
<tr><td>并行探测根标记：对 <code>'../'.repeat(n)</code>（n = 1…路径深度）同时发 HEAD，取第一个 200</td><td><b>完全可移植，零配置</b></td><td>冷启动多一次往返</td></tr>
</table>

<p>探测方案必须使用<b>唯一命名的标记文件</b>（如 <code>/.epubsite-root</code>），不能用 <code>index.html</code>——EPUB 内部经常自带 <code>index.html</code>，会误判。</p>

<p><b>约束 2 也是 I4 的体现</b>：引导文件位置无关是 404 机制的固有代价，且很便宜；但壳必须留在自己的位置上，否则 <code>SITE_ROOT</code> 失去运行时来源，产物不可移植。</p>

<h3>8.4 可选：托管重写规则</h3>

<p>若托管平台支持重写，令牌路径可以返回 <b>200</b> 而不是 404，从而让分享 URL 可被索引。规则由构建期按书的实际路径与 <code>--base-url</code> 生成。</p>

<table>
<tr><th>平台</th><th>形式</th></tr>
<tr><td>Netlify / Cloudflare Pages</td><td><code>_redirects</code>：<code>/*/@*  /epubsite.html  200</code></td></tr>
<tr><td>Vercel</td><td><code>vercel.json</code> 的 <code>rewrites</code></td></tr>
<tr><td>nginx</td><td><code>location ~ /@[^/]+\.(x?html)$ { try_files /epubsite.html =404; }</code></td></tr>
<tr><td>（可选）站点根 301</td><td>有真实 301 能力时，用 <code>/  /epubsite.html  301</code> 取代 JS 中转页——SEO 语义更干净，且不需要 <code>index.html</code> 这个文件</td></tr>
</table>

<p><b>重写目标不得携带查询参数。</b>重写保持 URL 不变，因此 <code>location.pathname</code> 已经是令牌路径，<code>SITE_ROOT</code> 与文档基准天然正确；写成 <code>/epubsite.html?p=…</code> 会把文档基准挪到 <code>/</code>，反而逼出一次本不需要的修复。同理，shell 的入口解析应同时接受两种信号来源：</p>

<pre><code>入口判定（顺序敏感，只在 epubsite.html 里执行）：
  1. query.p 存在            → 404 引导入口；真实路径 = query.p，锚点 = query.h
  2. basename 以 @ 开头      → 重写入口；真实路径 = 去掉 @ 的 pathname，锚点 = location.hash
  3. 其余                    → 落地页（书籍元数据 + 致谢）

注意：index.html 中转页<b>不参与</b>上述判定，它只做无参数跳转（§8.3 约束 5）。</code></pre>

<p>采用重写方案时，壳会被服务在深路径上，<code>SITE_ROOT</code> 无法从 <code>location</code> 推导，因此<b>必须</b>由 <code>--base-url</code> 的路径形态烘焙进壳（<code>data-site-root</code>），产物随之失去可移植性。这是一次明确的能力交换：<b>用可移植性换正确的状态码</b>。纯 404 托管下不需要这项交换。</p>

<h3>8.5 被否决的替代方案</h3>

<table>
<tr><th>方案</th><th>否决理由</th></tr>
<tr><td>用 <code>&lt;base&gt;</code> 动态切换基准</td><td>纯片段链接会变成跨文档导航，EPUB 脚注体系全灭（§5.2.1）</td></tr>
<tr><td>运行期遍历 DOM 重写每个相对 URL 属性</td><td>无法覆盖 <code>loading="lazy"</code> 与 <code>srcset</code> 的<b>二次解析</b>——它们在元素插入之后才解析，重写只能覆盖插入那一刻</td></tr>
<tr><td>接管 history，把每次 push 都改写成令牌形式</td><td>htmx 内部以未转换的路径作历史缓存键，篡改后每次后退都会被判定为缓存未命中并回源到令牌路径，把壳的 HTML 塞进内容区。只能连带关闭 <code>htmx.config.historyEnabled</code> 自行实现快照与恢复</td></tr>
<tr><td>让 404 引导直接充当壳</td><td>壳被服务在深路径 → <code>SITE_ROOT</code> 失去运行时来源 → 侧边栏绝对化全部算错；唯一的补救是烘焙构建期根路径，即违反 I4</td></tr>
<tr><td>让 <code>canonical</code> 指向令牌路径</td><td>纯 404 托管下该 URL 返回 404 状态码，指向它是害了 SEO。<code>canonical</code> 应指向书籍落地页 <code>{base}epubsite.html</code></td></tr>
<tr><td>把 <code>canonical</code> 指向 <code>{base}</code>（站点根）</td><td>站点根是重定向源而非落地页，指向一个 301 源同样有害。除非采用 §8.4 的站点根 301 规则并确认无 JS 中转页</td></tr>
<tr><td>把令牌路径写进 Open Graph</td><td>社交爬虫不执行 JS，只读 <code>epubsite.html</code> 里的静态标签。章节级 OG 不可能生效，OG 保持书籍级静态</td></tr>
<tr><td>把令牌路径写进 <code>publication.json</code> 的 <code>readingOrder</code></td><td>与上面两条同源。令牌路径的唯一用途是分享按钮（§5.8）</td></tr>
</table>

---

<h2>9. CLI</h2>

<pre><code>epubsite &lt;book.epub&gt; [options]

  -o, --out &lt;dir&gt;          输出目录（默认 ./dist）
      --name &lt;file&gt;        壳文件名（默认 epubsite.html）。<b>不得为 index.html</b>
      --base-url &lt;url&gt;     站点部署根。接受两种形态，语义不同：
                             "/" 或 "/sub/"        路径形态（默认 "/"）。
                                        声明部署位置。启用：重写模式的
                                        data-site-root 烘焙、托管规则生成
                             "https://host/sub/"   绝对形态。额外启用需要
                                        origin 的输出：canonical、
                                        JSON-LD url、og:image
      --hosting &lt;mode&gt;     none | 404 | rewrite | all（默认 404）
      --json-ld &lt;mode&gt;     full | thin | none —— hasPart 详细度（默认 full）
      --no-json-ld
      --search             生成 Pagefind 搜索索引（可选依赖，见附录 D）
      --no-spa             仅生成多页站，不注入 htmx
      --theme &lt;t&gt;          auto | light | dark
      --clean / --force / --dry-run / --verbose

  epubsite serve [dir]    本地开发服务器</code></pre>

<h3>9.1 子命令 <code>serve</code></h3>

<p>必须自带，因为本地通用静态服务器（如 <code>python -m http.server</code>）<b>不实现自定义 404 语义</b>，令牌路径与 <code>epubsite serve</code> 之外无法本地测试。该服务需实现：</p>

<table>
<tr><th>要求</th><th>说明</th></tr>
<tr><td>自定义 404</td><td>以 404 状态返回 <code>404.html</code> 的正文，<b>保持请求 URL 不变</b></td></tr>
<tr><td>可选重写</td><td>模拟 <code>--hosting rewrite</code> 的行为，便于对比测试</td></tr>
<tr><td>MIME</td><td><code>.xhtml</code> 映射为 <code>application/xhtml+xml</code></td></tr>
</table>

<h3>9.2 退出码</h3>

<p><code>0</code> 成功 · <code>2</code> 参数错误 · <code>3</code> 非法 EPUB · <code>4</code> 输出冲突 · <code>5</code> 加密内容。</p>

<p><code>4</code> 覆盖两类情况：目标文件已存在（要求显式 <code>--force</code>，静默覆盖用户文件是不可接受的副作用），以及 §3.2 的保留命名空间碰撞。</p>

<p><b>关于可复现构建（v1.2 起放宽）：</b>不承诺同输入两次运行产出逐字节一致的产物。构建仍<b>按确定性顺序</b>迭代与序列化（键序、清单顺序显式排序，并发解析结果按 spine 序号回填，构建机绝对路径不进产物），目的是让两次构建的 diff 可读、可审阅，而<b>不是</b>把字节相等作为契约。任何依赖字节相等的断言都不应写进测试。</p>

<h3>9.3 库与 CLI 的分层</h3>

<p>CLI 是薄壳。程序化 API 与流的纪律见附录 C.3，核心约定是：<b>库层不调用 <code>process.exit</code></b>，只抛带 <code>exitCode</code> 字段的类型化错误；CLI 捕获后映射为 §9.2 的退出码。这是让退出码可被单元测试、也让库能嵌进别的工具链的前提。</p>

---

<h2>10. 安全</h2>

<p>EPUB 是不可信输入。三道防线，全部在运行期 DOM 层实施（不触碰文件）：</p>

<table>
<tr><th>#</th><th>措施</th><th>理由</th></tr>
<tr><td>1</td><td><code>htmx.config.allowScriptTags = false</code></td><td>最重要的一条。htmx 插入内容时会丢弃所有 <code>&lt;script&gt;</code> 标签，包括书籍里藏的</td></tr>
<tr><td>2</td><td>把 <code>javascript:</code> 协议的 <code>href</code> 置为 <code>#</code>；移除 <code>&lt;iframe&gt;</code>／<code>&lt;object&gt;</code>／<code>&lt;embed&gt;</code></td><td>这些元素能加载外部内容，EPUB 里几乎不会合法出现</td></tr>
<tr><td>3</td><td><code>htmx.config.selfRequestsOnly</code> 保持默认 <code>true</code></td><td>杜绝书籍内容把请求引向第三方</td></tr>
<tr><td>4</td><td>JSON-LD 序列化后把 <code>&lt;</code> 替换为 <code>\u003c</code></td><td>防止元数据里的恶意字符串逃逸出 <code>&lt;script&gt;</code> 块</td></tr>
</table>

<p>另有来自架构本身的保障：因为不使用 <code>head-support</code>（§6），章节 head 里的脚本没有第二条进入文档的通道。</p>

<p><b>构建期另有一道输入校验：</b>ZIP 解包必须拒绝路径穿越条目（<code>../</code>、绝对路径、盘符），否则恶意 EPUB 可以写到输出目录之外。这属于解包库的职责，选型时须确认其自带该项检查（附录 C.2）。</p>

---

<h2>11. 无障碍与响应式</h2>

<h3>11.1 无障碍</h3>

<table>
<tr><th>项</th><th>做法</th></tr>
<tr><td>目录语义</td><td><code>&lt;nav aria-label="目录"&gt;</code> + 嵌套 <code>&lt;ol&gt;</code></td></tr>
<tr><td>当前位置</td><td><code>aria-current="page"</code>，随导航更新</td></tr>
<tr><td>抽屉开关</td><td><code>aria-expanded</code> + <code>aria-controls</code></td></tr>
<tr><td>跳到正文</td><td>skip-link，指向 <code>#epub-content</code></td></tr>
<tr><td>焦点管理</td><td>swap 后 <code>#epub-content.focus()</code></td></tr>
<tr><td>内容替换播报</td><td><code>aria-live="polite"</code></td></tr>
<tr><td>搜索</td><td>启用搜索时，模态框需焦点陷阱与 Esc 关闭；Pagefind 1.5+ 的 Component UI 已提供（附录 D.1）</td></tr>
</table>

<h3>11.2 响应式</h3>

<pre><code>宽屏：  grid-template-columns: minmax(240px, 300px) 1fr;
窄屏：  单列 + 侧边栏收入抽屉（原生 &lt;dialog&gt; 或 popover，无需 JS 库）
正文：  max-width: 65ch; line-height: 1.7
主题：  prefers-color-scheme + 用户可切换
字号：  CSS 自定义属性挂在 :root，章节内容继承</code></pre>

---

<h2>12. 边界情况</h2>

<table>
<tr><th>情况</th><th>处理</th></tr>
<tr><td>加密 / DRM（<code>encryption.xml</code>）</td><td>退出码 5，不产出坏站</td></tr>
<tr><td>固定版式（<code>pre-paginated</code>）</td><td>自动切换 <code>--no-spa</code>，并在落地页说明</td></tr>
<tr><td>无 nav 文档</td><td>降级：spine + 各章 <code>&lt;title&gt;</code>/<code>&lt;h1&gt;</code> 生成扁平目录；<code>articleSection</code> 省略</td></tr>
<tr><td>nav 中非 spine 项</td><td>过滤出主目录；保留为 landmarks 次级菜单</td></tr>
<tr><td>章节标题为空</td><td>回退链：nav label → <code>&lt;title&gt;</code> → 首个 <code>&lt;h1&gt;</code> → <code>第 N 章</code></td></tr>
<tr><td><b>书内已存在保留命名空间中的路径</b></td><td>按 §3.2 逐项处理：<code>epubsite.html</code>／<code>404.html</code>／<code>_epubsite_assets/</code>／<code>publication.json</code>／<code>@</code>-basename → 退出码 4；顶层 <code>index.html</code> → 保留书的文件，不生成中转页</td></tr>
<tr><td>RTL / 竖排（<code>page-progression-direction=rtl</code>）</td><td><code>&lt;html dir="rtl"&gt;</code>，侧边栏与上一章／下一章顺序反转</td></tr>
<tr><td>外部网络资源</td><td>绝对 URL 天然不受 <code>location</code> 影响，原样保留；构建期报告单独列出</td></tr>
<tr><td>指向仓库外的相对链接</td><td>构建期静态扫描产出报告；运行期监听 <code>htmx:responseError</code> 兜底</td></tr>
<tr><td>极大章节</td><td>历史快照默认缓存 10 项，每项是整个内容区 DOM；调小 <code>historyCacheSize</code> 或对大章加 <code>hx-history="false"</code></td></tr>
<tr><td>超大 EPUB（数千章）</td><td><code>hasPart</code> 用 <code>--json-ld thin</code>；侧边栏超约 500 项时考虑虚拟滚动；<code>shell-data.json</code> 的大小需实测</td></tr>
<tr><td>资源 404 被引导劫持</td><td>引导文件按模式判断，非令牌路径不重定向；壳也按同一模式判断，不启动章节加载</td></tr>
<tr><td>托管平台开启目录列举</td><td>书会变成一份可浏览的文件清单。用 §8.4 的托管规则关闭，或在部署文档中提示</td></tr>
<tr><td><b>宿主机无法表示的条目名</b></td><td>分两类，退出码不同：OCF §4.2.3 禁止的字符（<code>" * : &lt; &gt; ? \ | </code>、控制字符、私用区、末尾点）与规范化/大小写折叠后重名 → <b>退出码 3</b>（书本身非法）；末尾空格、Windows 保留设备名（<code>CON</code>、<code>NUL</code>、<code>COM1</code>…）、条目路径过长 → <b>退出码 4</b>（输出侧冲突）。判定<b>不依赖 <code>process.platform</code></b>：同一本书在 Windows 上构建成功、在 Linux 上失败（或反之）会让"两份构建等价"失去意义</td></tr>
<tr><td>ZIP 条目名以 <code>/</code> 开头或带盘符</td><td><b>退出码 3</b>。注意与命名的区别：<b>清单 href</b> 以 <code>/</code> 开头是合法的容器根引用，必须翻译为条目路径；<b>ZIP 条目名</b> 以 <code>/</code> 开头是 zip-slip，必须拒绝。同一个字符串、两种来源、相反的处置，因此判定必须发生在两者各自的入口处（见附录 E.7）</td></tr>
</table>

---

<h2>13. 测试</h2>

<h3>13.1 四条差旅线</h3>

<p>本方案的正确性依赖若干容易静默失效的前提，以下断言是唯一能在 CI 中立刻报警的手段：</p>

<table>
<tr><th>断言</th><th>做法</th><th>探测什么</th></tr>
<tr><td><b>零 4xx</b></td><td>端到端测试监听 <code>response</code> 事件，任何 <code>status ≥ 400</code> 即失败</td><td>I1／I2／样式注入路径——所有 URL 基准类问题的统一判据</td></tr>
<tr><td><b>push 已发生</b></td><td><code>afterSwap</code> 后断言 <code>location.pathname</code> 与 <code>evt.detail.pathInfo.responsePath</code> 一致</td><td>I5 被某个 <code>hx-push-url="false"</code> 破坏</td></tr>
<tr><td><b>内容零改写</b></td><td>构建期断言：（a）排除保留命名空间后，站点上的条目路径集合与源 EPUB 中央目录的条目集合<b>完全相同</b>；（b）每个被复制的文件与其源条目的<b>字节长度相等</b>。不做逐字节比对</td><td>捕获截断、重编码、遗漏或凭空多出的文件——这些才是"改写了内容"的可观测形态。逐字节比对既脆弱又昂贵，且它想防的正是长度比对能防的那几类事故</td></tr>
<tr><td><b>令牌变换双射</b></td><td><code>fromToken(toToken(p)) === p</code>，对全部章节路径</td><td>404 引导能正确还原真实路径</td></tr>
</table>

<h3>13.2 端到端用例</h3>

<table>
<tr><th>用例</th><th>断言</th></tr>
<tr><td>跨目录章节的图片</td><td>无 404 且 <code>naturalWidth &gt; 0</code>（仅查 404 会漏掉 lazy 未触发的情况）</td></tr>
<tr><td><code>loading="lazy"</code> 图片</td><td>进入章节后滚动，延迟加载的图片仍正确</td></tr>
<tr><td>同章脚注 <code>#fn1</code></td><td>URL 的 path 部分<b>不变</b>，页面滚动到目标</td></tr>
<tr><td>同章目录跳转 <code>./ch01.xhtml#sec3</code></td><td>未发起新请求（短路生效）</td></tr>
<tr><td>跨章脚注</td><td>内容替换 + 滚动到目标</td></tr>
<tr><td><b>令牌深链接入口</b></td><td>经 404 引导进入后：地址栏为真实路径、内容正确、<b>零 404 且图片正确渲染</b></td></tr>
<tr><td><b>带参数的入口不丢参数</b></td><td>直接请求 <code>epubsite.html?p=…&amp;h=…</code>，与经 404 引导进入的结果一致。这条是 §8.3 约束 5 的探针</td></tr>
<tr><td><b>站点根中转</b></td><td>请求 <code>/</code> 后落到 <code>epubsite.html</code> 的落地页，且<b>按后退不回到中转页</b>（历史里没有它）</td></tr>
<tr><td><b>侧边栏在入口后可用</b></td><td>经令牌入口进入后点击侧边栏任一项，目标正确（<code>SITE_ROOT</code> 未被污染）</td></tr>
<tr><td><b>清单拉取不被基准污染</b></td><td>经令牌入口进入后，<code>shell-data.json</code> 的请求 URL 是站点根下的绝对路径，不是 <code>/OEBPS/text/_epubsite_assets/…</code>。这条是 §5.4.1 与 I2 第二条路径的探针</td></tr>
<tr><td>侧边栏节点身份</td><td>导航前后 <code>elementHandle</code> 引用相同</td></tr>
<tr><td>后退 / 前进</td><td>内容、URL、JSON-LD 三者同步</td></tr>
<tr><td>章节 JSON-LD</td><td>导航后 head 中有且仅有一块 <code>[data-epub-ld]</code>，<code>@id</code> 等于该章派生 ID，<code>isPartOf.@id</code> 等于书籍 ID；<b>书籍级那块仍在</b></td></tr>
<tr><td><code>publication.json</code></td><td>存在、可解析、<code>readingOrder</code> 非空、每项 url 指向真实路径且实际存在</td></tr>
<tr><td>保留命名空间</td><td>构造一本含 <code>epubsite.html</code> 的 EPUB，构建以退出码 4 失败；含顶层 <code>index.html</code> 的 EPUB 构建成功且该文件字节不变</td></tr>
<tr><td>子路径部署</td><td>把 <code>dist/</code> 挂在 <code>/sub/mybook/</code> 下跑全套</td></tr>
<tr><td>资源 404 不被劫持</td><td>请求一个不存在的图片，不产生任何章节加载</td></tr>
</table>

<h3>13.3 单元测试</h3>

<p>container→OPF 定位 · EPUB2/3 元数据双路解析 · <code>refines</code> 角色归属 · 标识符规范化 · nav/NCX 树构建 · <b>纯片段 href 的"沿用上一文件"启发式</b> · 路径归一化 · 令牌变换双射 · <b>三方一致性（书籍 JSON-LD、<code>publication.json</code> 的 <code>metadata</code>、章节节点，同名属性必须相等）</b> · JSON-LD 转义 · 内联样式顶层 <code>@import</code> 摘除 · 章节→样式表映射 · 保留命名空间碰撞检测 · ZIP 路径穿越拒绝。</p>

---

<h2>14. 实施阶段</h2>

<table>
<tr><th>阶段</th><th>内容</th><th>验收</th></tr>
<tr><td><b>P0</b></td><td><b>两页手写实验</b>：<code>/epubsite.html</code> 与 <code>/sub/deep/page.html</code>，含相对图片、<code>loading="lazy"</code> 图片、<code>#anchor</code>；htmx 2.0.10 boost 进入</td><td><b>确认 I1 成立</b>——这是整个方案的单一依赖点，且由上游行为而非我们的代码保证。不通过则必须重新引入 <code>&lt;base&gt;</code> 或显式重定基</td></tr>
<tr><td>P1</td><td>CLI 骨架 + 解压（含碰撞检测）+ OPF 解析 + 最小壳（纯链接，多页可用）</td><td>任意章节可独立打开；排除保留路径后哈希一致；碰撞以退出码 4 失败</td></tr>
<tr><td>P2</td><td>导航提取 + 侧边栏 + htmx 接入 + <code>hx-target</code> 覆盖 + 壳绝对化</td><td>零 404；侧边栏点击后不消失</td></tr>
<tr><td>P3</td><td><code>shell-data.json</code> 槽位 + 启动顺序（含绝对 URL 锚定）+ body 属性 + 高亮 + 焦点 + 脚注滚动 + 同章短路</td><td>端到端全绿，含"清单拉取不被基准污染"</td></tr>
<tr><td>P4</td><td>令牌路径 + 404 引导 + <code>index.html</code> 中转 + 入口协议 + 分享按钮</td><td>深链接用例通过，含"带参数的入口不丢参数"与"站点根中转"</td></tr>
<tr><td>P5</td><td>JSON-LD 两层 + <code>publication.json</code> + 三方一致性测试</td><td>§13.2 的 JSON-LD 与清单用例</td></tr>
<tr><td>P6</td><td>可选托管规则 + <code>serve</code> 子命令</td><td>重写模式与 404 模式各跑一遍</td></tr>
<tr><td>P7</td><td>边界情况（加密／固定版式／无 nav／RTL）+ 无障碍 + 主题</td><td>多本真实 EPUB 冒烟</td></tr>
<tr><td>P8</td><td>可选：<code>--search</code> + Pagefind 集成</td><td>附录 D.5 的验收表全绿</td></tr>
</table>

<p><b>P0 必须最先做。</b>I1 是整个方案的单点依赖，而它由 htmx 的上游行为而非我们的代码保证。两小时的实验能把"要不要 <code>&lt;base&gt;</code>"这个问题一次性钉死。</p>

---

<h2>附录 A · publication.json 与 shell-data.json</h2>

<p>清单被拆成两份，<b>因为它们的读者完全不同</b>：一份面向外部世界，一份只服务壳。混在一起会让爬虫拉到渲染指令、让壳拉到大而无用的资源清单。分工的论证见 C.7。</p>

<h3>A.1 <code>publication.json</code>（站点根，面向外部）</h3>

<p>Web Publication Manifest。放在站点根，因此它的 URL 不携带任何前缀。<b>零私有字段</b>——shell 不读它。</p>

<blockquote>
<p><b>v1.2 修正：下列示例的顶层结构已作废，以 W3C Publication Manifest REC（2020-11-10）为准。</b>v1.1 把它写成 <code>{ "@context": "https://schema.org", "type": "Book", "metadata": {…}, "readingOrder": […], "links": [{ "rel": "cover" }] }</code>，与它自己引用的规范相矛盾：</p>
<ul>
<li>REC <b>没有</b>嵌套的 <code>metadata</code> 对象。描述性属性（<code>name</code>、<code>author</code>、<code>publisher</code>、<code>inLanguage</code>、<code>datePublished</code>…）全部在<b>顶层</b>。</li>
<li><code>@context</code> <b>必须</b>是 <code>["https://schema.org", "https://www.w3.org/ns/pub-context"]</code>，顺序固定。不满足即 fatal error（REC §7.4 步骤 3）。单写 <code>"https://schema.org"</code> 不合法。</li>
<li><code>conformsTo</code> 是<b>必需</b>属性。</li>
<li><code>rel</code> 为 <code>contents</code>／<code>pagelist</code>／<code>cover</code> 的资源必须列在 <code>resources</code>，<b>不得</b>出现在 <code>links</code>（REC §7.4.2 步骤 12d 会把它们从 <code>links</code> 里删掉）。</li>
<li><code>readingOrder</code> 不得为空，且各项 URL 必须唯一；封面若 <code>encodingFormat</code> 为 <code>image/*</code> 则必须有 <code>name</code>。</li>
</ul>
<p><b>不影响"三方一致"保证（§4.5 / C.7）：</b>书籍 JSON-LD、本清单的描述性属性、章节节点仍然由同一个构建期函数产出，同名属性天然相等。变的只是序列化位置。清单的 <code>readingOrder</code> 仍用<b>真实路径</b>，理由见 C.7。</p>
</blockquote>

```jsonc
{
  "@context": "https://schema.org",
  "type": "Book",
  "metadata": { /* 与 §7.2 的书籍 JSON-LD 同源，见 C.7 */ },
  "readingOrder": [
    { "type": "LinkedResource",
      "url": "OEBPS/text/ch01.xhtml",          // 真实路径；理由见 C.7
      "encodingFormat": "application/xhtml+xml",
      "name": "第一章 …" }
  ],
  "resources": [ /* 图片、样式、字体；不含 readingOrder 已列项 */ ],
  "links": [
    { "rel": "contents", "url": "OEBPS/nav.xhtml" },
    { "rel": "cover",    "url": "OEBPS/Images/cover.jpg" }
  ]
}
```

<p><b>实现前须对照规范 §4（顶层结构）与 §6（清单发现）逐字段核对</b>，特别是媒体类型注册名与 <code>links</code> 的 rel 取值表。本文档只固定结构轮廓与本文档特有的决策（<code>readingOrder</code> 用真实路径、<code>metadata</code> 与 JSON-LD 同源）。</p>

<h3>A.2 <code>_epubsite_assets/shell-data.json</code>（壳专用）</h3>

<p>壳的渲染数据。<b>只被 shell.js 读取</b>，且<b>必须</b>用 <code>new URL('_epubsite_assets/shell-data.json', SITE_ROOT)</code> 获取（§5.4.1）。</p>

```jsonc
{
  "book": {
    "@id": "urn:isbn:9780000000000",
    "url": "https://example.com/mybook/epubsite.html"   // 仅绝对形态的 --base-url 下输出
  },
  "byKey": {
    "OEBPS/text/ch03.xhtml": {
      "key": "OEBPS/text/ch03.xhtml",
      "title": "第三章 …",
      "section": "第一卷",
      "position": 3,
      "bodyClass": "calibre",
      "dir": "ltr",
      "headStyles": {
        "links": ["OEBPS/Styles/style.css"],   // 相对，运行期对 SITE_ROOT 绝对化
        "inline": ["p { text-indent: 2em; }"]
      },
      "jsonld": { /* §7.3 章节节点 */ }
    }
  },
  "nav": [ /* 嵌套树，供侧边栏渲染与高亮 */ ]
}
```

---

<h2>附录 B · 关键流程图汇总</h2>

<h3>B.1 运行期导航</h3>

<pre><code>点击正文里的 &lt;a href="ch04.xhtml"&gt;
     │
     ├─ 纯片段 #fn2 ────→ boost 跳过 → 浏览器原生处理
     │
     ├─ 同章带片段 ─────→ beforeRequest 短路 → 直接设 location.hash
     │
     └─ 跨文件 ─────────→ htmx boost
              ├─ 解析 href（基准 = 当前章节 URL，由 §2.1 保证）
              ├─ XHR 取回 XHTML
              ├─ pushState(章节 URL)            ← 早于 swap
              └─ swap body 内容进 #epub-content  ← 侧边栏不在 target 内，不受影响
                       │
                       └─ afterSwap → syncChapter()
                             ├─ 样式槽位（差集增删）
                             ├─ JSON-LD 槽位（全量替换）
                             ├─ body 属性镜像
                             └─ 侧边栏高亮（aria-current）</code></pre>

<h3>B.2 令牌入口</h3>

<pre><code>分享链接 /OEBPS/text/@ch03.xhtml#fn1
     │
     ├─ 有重写规则 ─→ 返回壳，200，URL 不变 ─┐
     │                                      │
     └─ 无规则 ─→ 404.html 正文，404 ───────┤
                    │                        │
                    └─ location.replace →    │
                       /epubsite.html?p=…&h=fn1
                                             ↓
                        壳加载 → 冻结 SITE_ROOT
                                             ↓
                        入口判定：query.p 优先，否则看 @ basename
                                             ↓
                        replaceState(真实路径)   ← 必须在 swap 之前
                                             ↓
                        拉取 shell-data.json（绝对 URL）→ 取章节
                                             ↓
                        插入 #epub-content → 滚动到锚点</code></pre>

<h3>B.3 站点根入口</h3>

<pre><code>用户打开 /
     │
     └─ /index.html（自包含中转页，仅在书内无顶层同名文件时生成）
             │
             └─ location.replace('epubsite.html' + location.search + location.hash)
                        │                  ↑ 转发是防御性的：入口协议本身不经此处
                        ↓
                   epubsite.html → 入口判定第 3 条 → 落地页

用户打开 /index.html?p=…   ← 非本系统产出的链接
     │
     └─ 同一中转页 → 参数被转发 → 与经 404 引导等价</code></pre>

<h3>B.4 站点根来源与可移植性（I4）</h3>

<pre><code>纯 404 托管                       重写托管
─────────────                     ─────────────
壳被服务在 /epubsite.html          壳被服务在 /…/@ch03.xhtml
SITE_ROOT ← location ✓            SITE_ROOT ← location ✗
                                  SITE_ROOT ← data-site-root（构建期烘焙）
产物可移植 ✓                       产物可移植 ✗
令牌 URL 状态码 404                令牌 URL 状态码 200 ✓
                                  （仅此项交换了可移植性）</code></pre>

---

<h2>附录 C · 实现细节与依赖选型</h2>

<p>本附录是<b>决策记录</b>，不是实现手册。每条给出选型、理由与被否决项；正文的不变量不因这里的选型而改变，选型过期时可以整体替换。</p>

<h3>C.1 模块划分与依赖边界</h3>

<table>
<tr><th>层</th><th>位置</th><th>可用依赖</th><th>说明</th></tr>
<tr><td><b>构建期</b></td><td><code>src/build/**</code>、<code>src/bin/**</code></td><td><code>yauzl</code>、<code>htmlparser2</code>、<code>node:*</code></td><td>解包、解析、渲染、写盘</td></tr>
<tr><td><b>运行期</b></td><td><code>src/runtime/**</code> → <code>dist/_epubsite_assets/shell.js</code></td><td><b>无</b>（运行时只有 vendored 的 htmx）</td><td>纯浏览器 ES Module</td></tr>
<tr><td><b>共享</b></td><td><code>src/shared/**</code></td><td><b>无</b>——不得 import <code>node:*</code> 或任何第三方包</td><td>令牌变换等，同时被构建期与运行期引用（见 C.4）</td></tr>
</table>

<p><b>边界规则：<code>src/shared/</code> 的任何 <code>node:</code> 引用都会被打进 <code>shell.js</code> 并在浏览器里当场炸掉。</b>用 lint 规则（<code>no-restricted-imports</code>）把这条钉死，而不是靠自觉。</p>

<h3>C.2 依赖选型</h3>

<table>
<tr><th>用途</th><th>选型</th><th>理由</th><th>被否决项及否决理由</th></tr>
<tr><td><b>ZIP 读取</b></td><td><code>yauzl</code></td><td>只读<b>中央目录</b>（符合 OCF，而非信任 local file header）；逐 entry 返回 <code>Readable</code>，可对未解包的条目直接算哈希；<code>validateFileName()</code> 自带 zip-slip 防护；不把整包读进内存</td><td><code>adm-zip</code>（全量解压进内存，超大书直接爆）；<code>extract-zip</code>（只能落地到磁盘，而我们需要在不落地的情况下读 <code>container.xml</code>）；<code>fflate</code>（push 式流模型，随机访问单个条目很别扭）</td></tr>
<tr><td><b>XML / XHTML 解析</b></td><td><code>htmlparser2</code>（<code>xmlMode: true</code>）</td><td>真实 EPUB 大量非 well-formed，严格解析器会直接抛；<code>xmlMode</code> 下正确识别自闭合标签与 CDATA，恰好是 XHTML 需要的；比 <code>saxes</code> 快一个数量级</td><td><code>saxes</code>／原生 XML 解析器（draconian，遇脏书即失败）；<code>parse5</code>（HTML5 树构造语义，与 XHTML 不符且慢约 4×）</td></tr>
<tr><td><b>CLI 参数解析</b></td><td><code>node:util</code> 的 <code>parseArgs</code></td><td>Node 20+ 内置，零依赖；flag 面很小，与"拒绝模板引擎"同一取向</td><td><code>commander</code>／<code>yargs</code>（依赖树与自动 help 的收益不成比例）</td></tr>
<tr><td><b>开发服务器</b></td><td><code>node:http</code> + <code>node:fs/promises</code></td><td>§9.1 要求"以 404 状态返回 <code>404.html</code> 正文且<b>保持 URL 不变</b>"并模拟重写——框架的默认 404 行为反倒要绕开</td><td><code>sirv</code>／<code>hono</code>／<code>polka</code>（在自定义 404 语义下省不了多少代码）</td></tr>
<tr><td>哈希</td><td><code>node:crypto</code></td><td>§13.1 的递归哈希</td><td>—</td></tr>
<tr><td>测试 / 打包</td><td><code>vitest</code> + Playwright / <code>tsup</code></td><td>§13 已定型；tsup 出两个入口（bin 与 <code>shell.js</code>）</td><td>—</td></tr>
<tr><td><b>搜索索引</b><br><sub>仅 <code>--search</code></sub></td><td><code>pagefind</code>（<b>可选依赖</b>）</td><td>构建期 shell out 到其二进制；自带中文分词与无障碍 UI；索引分块懒加载。集成细节与三个坑见附录 D</td><td>自研倒排索引（分词、增量索引、索引压缩都要自己扛）；<code>lunr</code>／<code>flexsearch</code>（需把全文读进浏览器，与"零改写 + 大书"相冲）</td></tr>
</table>

<p><b>决定：不复用现成的 EPUB 解析库。</b><code>@lingo-reader/epub-parser</code>、<code>booqs-epub</code>、<code>pub-soup</code> 均可用且维护活跃，但它们全部内置了<b>章节内容与路径的处理</b>（blob URL 改写、<code>epub:</code> 前缀方案、DOM 净化）。本方案要的恰恰是它们的反面——字节原样复制，且 §4.2 的角色归属、§4.3 的四条 href 规则都不会被它们替代。§13.3 的单元测试清单因此<b>直接就是实现清单</b>。</p>

<p><b><code>pagefind</code> 不得进入 <code>dependencies</code>。</b>它只在 <code>--search</code> 时被调用，未启用时构建路径上不应有任何它的痕迹——包括 npm 安装阶段（其包会拉取平台专属二进制）。</p>

<h3>C.3 程序化 API 与 CLI 调用约定</h3>

<h4>C.3.1 分层：CLI 是薄壳</h4>

<pre><code>argv ──parseArgs──→ BuildOptions ──build()──→ BuildResult
                       (纯数据)                  (抛类型化错误，不碰 process)</code></pre>

<pre><code>export interface BuildOptions { /* 与 §9 的 flag 一一对应 */ }

export interface BuildResult {
  outDir: string;
  diagnostics: Diagnostics;
  stats: { chapters: number; resources: number; bytes: number };
}

export function build(epubPath: string, options?: Partial&lt;BuildOptions&gt;): Promise&lt;BuildResult&gt;;</code></pre>

<p><b>库层不调用 <code>process.exit</code>，只抛 <code>EpubSiteError</code>（带 <code>exitCode</code> 字段）。</b>CLI 捕获后映射为 §9.2 的退出码。</p>

<h4>C.3.2 三条流纪律</h4>

<table>
<tr><th>流</th><th>放什么</th><th>理由</th></tr>
<tr><td><code>stdout</code></td><td><b>只放结果</b>。默认一行人类可读摘要；<code>--json</code> 时放一条诊断 JSON</td><td>否则 <code>--json</code> 无法被管道消费</td></tr>
<tr><td><code>stderr</code></td><td>进度、警告、<code>--verbose</code> 细节</td><td>结果与噪音分离</td></tr>
<tr><td>退出码</td><td>§9.2 的 0/2/3/4/5</td><td>由 <code>EpubSiteError.exitCode</code> 决定，CLI 不自行判断</td></tr>
</table>

<h4>C.3.3 诊断报告的形状（补 §12 的留白）</h4>

<pre><code>interface Diagnostics {
  externalResources: string[];   // 绝对 URL 的外部资源（§12）
  outOfTreeLinks: string[];       // 指向仓库外的相对链接（§12）
  warnings: { code: string; message: string; where?: string }[];
}</code></pre>

<p><code>--json</code> 输出 <code>BuildResult</code> 的可序列化子集。<code>warnings[].code</code> 用稳定字符串而非自然语言，便于 CI 断言。</p>

<h4>C.3.4 CLI 解析</h4>

<p>用 <code>node:util</code> 的 <code>parseArgs</code>：长名 + 短名别名，严格模式（未知 flag → 退出码 2），<code>--help</code> 手写文本块并与 §9 的清单同源。<code>serve</code> 作为 positionals 首项判定，不引入子命令框架。</p>

<h3>C.4 运行期代码的产出方式</h3>

<h4>C.4.1 <code>shell.js</code> 由独立 tsup 入口编译</h4>

<pre><code>src/runtime/shell.ts ──tsup(esm)──→ dist/_epubsite_assets/shell.js</code></pre>

<p>理由：能让运行期代码享受类型检查与 §13.3 的单元测试。<b>不要手写一份不受检的 JS。</b></p>

<h4>C.4.2 令牌变换必须单源三用</h4>

<table>
<tr><th>使用点</th><th>形式</th></tr>
<tr><td>构建期</td><td>直接 import，用于 §13.1 的"令牌变换双射"断言</td></tr>
<tr><td><code>shell.js</code></td><td>同一模块打进 shell bundle，供 §5.8 的分享按钮使用</td></tr>
<tr><td><code>404.html</code></td><td>编译后<b>内联</b>进 <code>&lt;script&gt;</code>——§8.3 约束 1 禁止任何外部引用</td></tr>
</table>

<p>做法：<code>src/shared/token.ts</code> 写成零依赖纯函数，构建期用 esbuild 单独打成一个 IIFE 字符串，插值进 <code>404.html</code> 模板。<b>不要在 <code>404.html</code> 里手抄第二份</b>——那会让 §13.1 的双射测试失去意义。</p>

<h4>C.4.3 htmx 的 vendoring</h4>

<p><code>htmx.esm.js</code> 从 <code>node_modules</code> 复制，并在文件头部加上带版本号的 banner，便于事后确认线上跑的是哪一版。</p>

<p><b>v1.2 修正：</b>v1.1 写的 <code>htmx.esm.min.js</code> 在上游并不存在。htmx 2.0.10 的 <code>dist/</code> 只有 <code>htmx.esm.js</code>（未压缩 ESM）、<code>htmx.min.js</code>（压缩 UMD）、<code>htmx.cjs.js</code> 与 <code>htmx.amd.js</code>，<b>没有</b>压缩过的 ESM 构建。规范因此把文件名改为上游真实存在的那个：宁可多传 ~169 KB，也不要一个名字与内容不符、且无法用 <code>import</code> 默认导出的产物。</p>

<h4>C.4.4 壳 head 的槽位注释是构建期 lint 的锚点</h4>

<p>§5.4.3 的 lint 依赖壳 <code>&lt;head&gt;</code> 里的注释标记定位可写区间。注释即契约：改注释文本等于改 lint 行为，编辑它时需同步改检查器。同一处 lint 还负责断言 <code>data-pagefind-body</code> 不存在（附录 D.2）。</p>

<h3>C.5 确定性与 diff 稳定性</h3>

<p>v1.1 曾要求"同输入两次运行产出字节一致（除时间戳）"。<b>v1.2 不再做这个承诺</b>：它把字节相等当成契约，而它想买到的其实只是审阅上的便利。保留下来的是一组<b>顺序纪律</b>——目的是让两次构建的 diff 可读、可审，而不是让哈希相等：</p>

<table>
<tr><th>约束</th><th>理由</th></tr>
<tr><td>一切集合迭代前<b>显式排序</b></td><td>键序、清单顺序若不排序，会随 V8 内部状态漂移</td></tr>
<tr><td>禁止 <code>Date.now()</code> / <code>Math.random()</code> 进入产物</td><td><code>dateModified</code> 之类只取 EPUB 元数据</td></tr>
<tr><td>JSON 序列化使用统一的稳定键序</td><td>否则 <code>shell-data.json</code> 与 <code>publication.json</code> 每次 diff 全红</td></tr>
<tr><td>并发解析章节 head 用<b>有界池</b>，结果<b>按 spine 序号回填</b></td><td>完成顺序不得决定输出顺序</td></tr>
<tr><td>构建机的绝对路径不得进产物</td><td>临时路径泄漏会同时破坏可复现性与隐私</td></tr>
</table>

<p><b>验证方式：</b>不比对字节。凡是以"两次构建字节一致"为形式的断言都不应写进测试——它与 §13.1 的"内容零改写"本来就是两个独立命题，现在两个都不是字节命题。</p>

<h3>C.6 两处规范补漏</h3>

<h4>C.6.1 重写模式下，壳的<b>全部</b>静态引用都会断（§8.4）</h4>

<p>§8.4 只说"必须由 <code>--base-url</code> 烘焙 <code>data-site-root</code>"。但在重写模式下壳被服务在深路径上，<code>epubsite.html</code> 里的 <code>&lt;link href="_epubsite_assets/shell.css"&gt;</code>、<code>&lt;script src="_epubsite_assets/shell.js"&gt;</code>、<code>&lt;link rel="canonical"&gt;</code> 同样是文档相对，会解析到 <code>/OEBPS/text/_epubsite_assets/…</code> → 404，<b>直接违反 G4</b>。</p>

<p>因此 <code>--hosting rewrite</code> 下，壳的<b>全部</b>静态引用都必须在构建期按 <code>--base-url</code> 绝对化，<code>data-site-root</code> 只是其中一项。这与 §8.4 已接受的"用可移植性换正确状态码"是同一笔交易，不必追加代价。</p>

<h4>C.6.2 <code>shell-data.json</code> 的获取必须显式锚定 <code>SITE_ROOT</code>（§5.4.1）</h4>

<p>启动顺序中 <code>replaceState</code> 早于数据拉取，因此相对路径 fetch 会落到章节目录下。两条出路：</p>

<table>
<tr><th>做法</th><th>评价</th></tr>
<tr><td>靠"module 是 defer 的、执行时 location 尚未被 replaceState"这一时序</td><td><b>不可采用</b>。正确性挂在 shell.js 内部的语句顺序上，任何重构都可能无声破坏</td></tr>
<tr><td>显式用 <code>new URL('_epubsite_assets/shell-data.json', SITE_ROOT)</code></td><td><b>强制</b>。对时序免疫</td></tr>
</table>

<p><b>这条把 I2 的表述暴露得不完整。</b>标记法只覆盖 <b>DOM 属性</b>；<code>shell-data.json</code> 是 fetch 目标，逃过了它。§10 的 <code>@import … layer(epub)</code> 与 §5.8 的分享链接本来就已经遵守"引用点显式锚定"这条通则，只是当时没写出来。补上之后，<code>shell-data.json</code> 只是第三个实例。</p>

<h3>C.7 为什么清单拆成两份</h3>

<p>Web Publication Manifest 的 <code>metadata</code> 是一个 schema.org <code>Book</code>，<b>与 §7.2 的书籍 JSON-LD 是同一份数据</b>。因此 §4.5 的"由一个函数同时产出"是<b>三方一致</b>：书籍 JSON-LD、<code>publication.json</code> 的 <code>metadata</code>、章节节点，全部出自同一个构建期函数。</p>

<p>但壳需要的渲染数据<b>不该</b>塞进去：</p>

<table>
<tr><th>理由</th><th>说明</th></tr>
<tr><td>不是出版物描述</td><td><code>headStyles</code> / <code>bodyClass</code> / <code>dir</code> 是<b>渲染指令</b>，不是 schema.org 词汇。塞进去要发明私有词汇，而 webpub 是 JSON-LD，扩展需要词汇表</td></tr>
<tr><td>会把清单撑大</td><td><code>resources</code> 在大书上可达数百 KB，而壳每次冷启动都要拉这份数据</td></tr>
<tr><td>污染外部消费者</td><td>爬虫与第三方阅读系统会拉到一份含渲染指令的清单</td></tr>
<tr><td>I2 的适用性下降</td><td>让壳去读一份"面向世界"的文件，会把它的 URL 变成需要绝对化的壳自有资源——职责混在一起</td></tr>
</table>

<p>因此分工：<code>publication.json</code> 面向外部、零私有字段、壳不读；<code>shell-data.json</code> 面向壳、可自由演化、由 C.6.2 的规则锚定。</p>

<h4><code>readingOrder[].url</code> 用真实路径</h4>

<p>Webpub 的 <code>readingOrder</code> 列出的是<b>资源</b>，不是"阅读器视角下的地址"。真实路径正是那个文件所在处；令牌路径在纯 404 托管下返回 404 状态码，把它写进清单会让第三方消费者直接放弃这本书。这与 §8.5 已否决"canonical 指向令牌路径"是<b>同一条推理</b>，不应两处给出不同答案。</p>

<p><b>且只收 <code>linear</code> 项</b>（E.11）：清单没有表达 EPUB <code>linear="no"</code> 的词汇，而导航文档通常正是这样标记的。这类条目改列 <code>resources</code> 并带 <code>rel="contents"</code>，才不会让消费者把目录当正文读。阅读器侧边栏仍列出全部 spine 项——那是阅读器的选择，与"什么是阅读顺序"是两回事。</p>

<p>令牌路径的适用范围因此收敛为<b>唯一一处：分享按钮产生的 URL</b>（§5.8）。</p>

---

<h2>附录 D · 搜索（可选）</h2>

<p>由 <code>--search</code> 启用。这是<b>正交扩展</b>：不启用时构建路径、产物结构、五条不变量全部不变；启用时只新增一个目录与一个 UI 入口。</p>

<h3>D.1 为什么是 Pagefind</h3>

<table>
<tr><th>特性</th><th>说明</th></tr>
<tr><td><b>中文可用</b></td><td>zh/ja/ko 属 specialized languages，需 extended release——<code>npx pagefind</code> <b>默认即是</b>。无 stemming，但有<b>分词</b>：<code>每個月都</code> 索引为 <code>每個</code>／<code>月</code>／<code>都</code>，逐词查询与整串查询都能命中</td></tr>
<tr><td>索引分块</td><td>只下载命中所需的片段，不是整份倒排表。这是它能用在"数千章"规模的原因</td></tr>
<tr><td>无障碍 UI</td><td>1.5.0 起提供 Component UI（取代旧的 <code>PagefindUI</code>），自带搜索模态框与键盘支持，与 §11 一致</td></tr>
<tr><td>零服务端</td><td>纯静态产物，与 G1 的静态托管前提相容</td></tr>
</table>

<p>被否决项：自研倒排索引（分词、增量、压缩全部自己扛）；<code>lunr</code>／<code>flexsearch</code>（需把全文读进浏览器，与"零改写 + 大书"相冲）。</p>

<h3>D.2 三个会静默失败的坑</h3>

<p>这三条都必须写进构建期逻辑，靠"配错了会报错"是不成立的——它们的失败形态都是<b>能跑、但索引是空的或范围是错的</b>。</p>

<table>
<tr><th>#</th><th>坑</th><th>正确做法</th></tr>
<tr><td>1</td><td><b>默认 glob 是 <code>**/*.{html}</code>，不含 <code>.xhtml</code></b>。EPUB3 章节是 <code>.xhtml</code></td><td>默认配置下<b>一条正文都索引不到</b>，只有壳本身被索引。必须由构建期按书的实际路径生成 glob。见 D.5 的验收项</td></tr>
<tr><td>2</td><td><b><code>data-pagefind-body</code> 是<b>全站级</b>开关</b>：站点上任何一页带它，没带的页面就<b>不再被索引</b></td><td>壳上一放（看起来非常合理！）所有原始 XHTML 立刻退出索引。<b>规范层面禁止在壳的任何元素上加这个属性</b>，并在构建期 lint 中断言它不存在（§5.4.3）</td></tr>
<tr><td>3</td><td>Pagefind 默认输出到 <code>&lt;site&gt;/pagefind/</code></td><td>站点根现在住着书（§3.1）。必须 <code>--output-path _epubsite_assets/pagefind</code>，把它纳入保留命名空间</td></tr>
</table>

<h3>D.3 构建期集成</h3>

<table>
<tr><th>项</th><th>做法</th></tr>
<tr><td>位置</td><td>在写完全部产物<b>之后</b>运行，作为最后一步。此时书已经铺在站点根，Pagefind 的爬取根与站点根天然一致</td></tr>
<tr><td>调用方式</td><td>shell out 到 <code>pagefind</code> 二进制。参数由构建期算好：<code>--site &lt;out&gt;</code>、<code>--output-path _epubsite_assets/pagefind</code>、按实际路径生成的 <code>--glob</code></td></tr>
<tr><td>失败处理</td><td><b>不阻断主流程</b>。搜索是正交扩展，索引失败不应让一份本来可用的产物作废——降级为警告并继续，退出码仍为 0</td></tr>
<tr><td>依赖</td><td>可选依赖，不得进入 <code>dependencies</code>（C.2）</td></tr>
<tr><td>禁止</td><td>不要把搜索放进 <code>404.html</code>——§8.3 约束 1 要求它零外部引用</td></tr>
</table>

<h3>D.4 运行期</h3>

<table>
<tr><th>项</th><th>做法</th><th>理由</th></tr>
<tr><td><b>结果点击走 SPA 内部导航</b></td><td>拦截点击，从结果 URL 还原真实路径，复用 htmx 的页面内导航</td><td>Pagefind 返回的是它爬到的<b>真实路径</b>。若改写成令牌路径再跳转，会触发<b>整页重载 + 走 404 网关</b>——把一次 SPA 内导航降级成冷启动，直接消解 G3</td></tr>
<tr><td>结果标题用自己的数据覆盖</td><td>从 <code>shell-data.json</code> 的 nav 树取权威 label</td><td>Pagefind 取 <code>&lt;title&gt;</code>／<code>&lt;h1&gt;</code>，而 EPUB 里这两者常是空的或文件名。权威标题在 nav label（§4.3）</td></tr>
<tr><td>索引不进首屏</td><td>首次打开搜索时才 <code>await import()</code></td><td>单入口 SPA 不应为从未使用的功能付启动代价——与 §12 的 <code>historyCacheSize</code> 同一类考量</td></tr>
<tr><td>子路径部署</td><td>设 <code>baseUrl</code>（结果 URL 前缀）与 <code>basePath</code>（bundle 位置）</td><td><code>basePath</code> 通常能从 import 的 URL 自动推断，失败时才需显式指定</td></tr>
<tr><td>UI 位置</td><td>放进 <code>#toolbar</code>（§5.1）</td><td>与目录开关、分享同级</td></tr>
</table>

<h3>D.5 验收</h3>

<table>
<tr><th>断言</th><th>探测什么</th></tr>
<tr><td><b>索引里真的有正文</b></td><td>用一个确定出现在某章正文里的词检索，命中该章。这条必须在 CI 里跑——<b>它是坑 1（<code>.xhtml</code> 不被默认 glob 匹配）的唯一探针</b>，配错时索引为空却不会有任何报错</td></tr>
<tr><td>壳的 UI 文案不在索引里</td><td>检索"打开目录"／"复制链接"等壳字符串，零命中</td></tr>
<tr><td>点击结果不产生整页加载</td><td>与 §13.1 的"push 已发生"同一手法：断言是 SPA 内导航而非 document 级别的载入</td></tr>
<tr><td>零 4xx</td><td>套用 §13.1 的统一判据；搜索路径（bundle、索引片段）不得产生 404</td></tr>
<tr><td>子路径部署</td><td>在 <code>/sub/mybook/</code> 下重跑检索与点击</td></tr>
</table>

<h3>D.6 已知局限</h3>

<table>
<tr><th>局限</th><th>后果</th><th>缓解</th></tr>
<tr><td>中文无 stemming</td><td>「的／了／是」等高频虚词会进入索引，可能影响排序质量</td><td>用 Pagefind 的 stopword／权重建模能力在测试中调优；必要时用 <code>--force-language</code> 固定分词语言</td></tr>
<tr><td>索引体积随正文字数增长</td><td>中文分词后条目数显著高于西文</td><td>分块懒加载已缓解首屏；大书可在规范中约定是否默认关闭</td></tr>
<tr><td>原始 XHTML 出现的重复内容</td><td>若 EPUB 内含多个 <code>nav.xhtml</code>／封面页，会被一并索引</td><td><code>--glob</code> 由构建期按 spine 生成，只覆盖 <code>spine</code> 中的章节</td></tr>
</table>

---

---

<h2>附录 E · 相对 v1.1 的修订记录</h2>

<p>v1.1 冻结，不再修改。以下修订逐条记录<b>为什么改</b>，因为每一条都是实现过程中被事实推翻的假设，而不是风格偏好。</p>

<table>
<tr><th>#</th><th>修订</th><th>理由</th></tr>
<tr><td>E.1</td><td><b>G2 不再要求逐字节一致</b>，改为<b>路径集合 + 字节长度等价</b>（§1.1、§13.1）</td><td>逐字节比对既脆弱又昂贵，而它想防的事故——截断、重编码、遗漏文件、凭空多出文件——全部表现为路径集合或长度异常。保留比对长度就保住了全部探测能力，去掉了那份脆弱</td></tr>
<tr><td>E.2</td><td><b>放弃跨运行字节级可复现承诺</b>（§9.2、C.5）</td><td>它想买到的只是审阅便利。保留下来的是一组<b>顺序纪律</b>（显式排序、按 spine 序号回填、不把构建机绝对路径写进产物），目的是让 diff 可读——而不是让哈希相等。任何\"两次构建字节一致\"形式的断言都不应写进测试</td></tr>
<tr><td>E.3</td><td><code>htmx.esm.min.js</code> → <code>htmx.esm.js</code>（§3.1、C.4.3）</td><td>上游 htmx 2.0.10 不发布压缩过的 ESM 构建。规范原本指着一个不存在的文件；改为上游真实存在的那个，而不是自己压一份名字对不上的产物</td></tr>
<tr><td>E.4</td><td><code>.epubsite-root</code> 纳入保留命名空间（§3.2）</td><td>§8.3 要求探测它，但 v1.1 的 §3.2 表里没有它——书一旦占用该名字，位置无关性就静默失效</td></tr>
<tr><td>E.5</td><td>新增<b>宿主机约束</b>与条目名来源的区别（§12）</td><td>v1.1 假定书内路径都能落到磁盘上。实际不是：末尾空格与 Windows 保留设备名无法落盘，且判定不能依赖平台，否则同一本书在两台机器上结论不同</td></tr>
<tr><td>E.6</td><td><code>publication.json</code> 改为 W3C REC 的扁平结构（A.1）</td><td>v1.1 的示例与它自己引用的规范（§4／§6）相矛盾：REC 没有嵌套 <code>metadata</code>，<code>@context</code> 必须是二元数组，<code>conformsTo</code> 必需，结构性 <code>rel</code> 不得出现在 <code>links</code> 里。照 v1.1 写出的清单<b>过不了校验</b></td></tr>
<tr><td>E.7</td><td>新增规则：<b>同一个以 <code>/</code> 开头的字符串，来源不同则处置相反</b>（§12）</td><td>实现中发现：清单 href 的 <code>/OEBPS/x.xhtml</code> 是合法的容器根引用，必须<b>翻译</b>成条目路径 <code>OEBPS/x.xhtml</code>；ZIP 条目名的 <code>/etc/passwd</code> 是 zip-slip，必须<b>拒绝</b>。若两者共用一条\"去掉前导斜杠\"的路径，zip-slip 就被静默洗白了。判定必须发生在两者各自的入口处</td></tr>
<tr><td>E.8</td><td>RTL 的\"反转\"明确为<b>呈现层</b>职责（§12）</td><td><code>readingOrder</code> 与每章的 <code>position</code> 都派生自 spine 序号（§7.5）。在解析层反转 spine 会同时污染两者，而且产物看上去是正常的——只有读屏与搜索引擎会察觉</td></tr>
<tr><td>E.9</td><td><b>永久移除 <code>--book-dir</code>（子目录布局）</b>（§1.2、§8.2）</td><td>v1.1 把它当作命名冲突与 <code>index.html</code> 遮蔽的出口，却又没在 §9 的 CLI 清单里定义它——一个被引用了两处、却从未被规范的口子。补全它需要在三处同时改模型：<code>SITE_ROOT</code> 不再等于书根（I4 失去运行时来源）、404 引导的前缀剥离没有唯一解（§8.3 约束 2）、<code>?p=</code> 不再是站点相对路径（§8.2）。而它买到的只是"站点根多一层"。这是一次只赔不赚的复杂度交易，因此不是"暂不实现"，而是<b>从规范中删除</b>：§1.2 将它列为非目标，§8.2 的代价改为明言接受，E.10 待办表中移除</td></tr>
<tr><td>E.10</td><td><b>移除 <code>numberOfPages</code> 与 <code>pagination</code></b>（§7.2、§7.5）</td><td>两者都依赖对 page-list 导航文档的解析，而<b>分页不是本方案的任何需求</b>：可重排 EPUB 本就没有固定分页，字段对大多数书就是缺失的，对剩下的书也是可疑的。一个取自不存在的数据源的字段，正确的读法是<b>不输出</b>，而不是输出一个看起来像样但没依据的数字</td></tr>
<tr><td>E.11</td><td><b>清单的 <code>readingOrder</code> 只收 <code>linear</code> 项；<code>isPartOf</code> 改为单节点</b>（§7.5、§7.6、C.7）</td><td>两点都是实现中暴露的模型错位。其一：EPUB 的 <code>linear="no"</code> 标记的是“不在线性阅读序列里”的内容——封面、版权页、以及<b>导航文档自身</b>——而 Publication Manifest <b>没有表达该标记的词汇</b>，把它放进 <code>readingOrder</code> 等于叫消费者把目录当正文读；那些条目改列 <code>resources</code> 并带 <code>rel="contents"</code>（阅读器侧边栏不受影响，它展示的是书自己的目录，与“什么是阅读顺序”是两个问题）。其二：<code>isPartOf</code> 的祖先链形式需要祖先节点具备身份，而 nav 树只给出祖先的 <i>label</i>；要拼出链条就得为书中从未命名的节点编造 <code>@id</code>——一张看起来更丰富、实际断言更多的图。链条本想承载的信息已经由 <code>articleSection</code>（父级）与 <code>position</code>（阅读顺序）给出</td></tr>
<tr><td>E.12</td><td><code>shell-data.json</code> 不再重复书籍节点（A.2）</td><td>A.2 原本把完整书籍节点也列进去。但该节点已经是壳 <code>&lt;head&gt;</code> 里的静态内容，而 <code>syncJsonLd</code> 只处理章节节点——书籍那块不带 <code>data-epub-ld</code> 标记，永远不会被移除（§5.6）。把它再拷一份到一个启动时拉取的文件里，是为一个不存在的读者重复最大的一块数据</td></tr>
</table>

<h3>E.13 未决项</h3>

<table>
<tr><th>项</th><th>状态</th></tr>
<tr><td><code>--hosting rewrite</code></td><td>本次实现按约定<b>不实现</b>，源码中留报错桩（退出码 2），桩的注释里写明完整契约。连带后果已在 §8.4 与 C.6.1 记录：路径形态的 <code>--base-url</code> 会被校验但不对产物产生任何影响</td></tr>
<tr><td>路径穿透的最终防线归属</td><td>目前委托给解包库（yauzl 的 <code>validateFileName</code>），并以测试钉住该行为，而非再加一道永远跑不到的守卫。若换解包库，必须重新验证这两条断言</td></tr>
</table>

<div align="center">
<sub>规范结束 · v1.2</sub>
</div>
