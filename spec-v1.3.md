<h1>epubsite 规范 v1.3</h1>

<div align="center">
<b>零改写 EPUB → 静态单页阅读器</b><br>
<sub>把 EPUB 原封不动地放在静态托管上，用 htmx 叠加一层无刷新阅读体验，并保证每个可分享链接都落到阅读器而非裸页面上。</sub>
</div>

<blockquote>
<p><b>本版是一次重写，不是增补。</b>v1.1 与 v1.2 从此冻结。v1.2 把改动记在文末附录 E 里，导致读者必须把正文和补丁表叠着读才能知道系统到底是什么样；v1.3 把 E.1–E.12 全部并入正文，并补齐了 v1.2 完全没写的那一类事实——<b>布局</b>：壳是一个两面板视口，它的正确性有自己的一组不变量，而这些不变量在实现中逐条以缺陷的形式暴露过。</p>
<p>§1–§14 与附录 A–D 的<b>编号保持不变</b>，因为源码与测试里有大量形如「§5.4.3」「§8.2」「§D.2」的引用。新增内容一律追加到所在章的末尾（§1.4、§4.9、§5.9、§5.10、§5.11、§11.3），不改动既有编号。附录 E 保留为 v1.2 的历史记录，本版的修订记在附录 F。</p>
<p><b>唯一例外：</b>章节节点的 <code>url</code> 改为数组之后，§5.8、§7.3、§7.5、§8.5 里原来说「令牌路径只用于剪贴板」的那几处断言不再成立，因此在<b>原地改写</b>。编号未动，改的是内容——把一段已被推翻的话留在原处，比改动它更糟。此后另有三处按同一条规则就地改写：<b>canonical 只属于落地页</b>（§4.6、§5.4、§5.6、§7.5、§8.5、§9）、<b>工具栏的首页控件与符号化的目录开关</b>（§5.1、§5.7、§5.11、§11.1），以及<b>落地页末尾的致谢行</b>（§4.6、§5.1、§11.1、§13.2）。三处都记在附录 F。</p>
<p><b>词汇约定：</b>「必须」= 违反即为缺陷；「应当」= 有正当理由可偏离，但须在代码里说明；「可以」= 实现自由。</p>
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
<tr><td>G8</td><td>站内全文搜索</td><td><code>--search</code> 启用后，正文中的词可被检出、高亮并导航到对应章节，且点击结果<b>留在阅读器里</b>。搜索不可用时构建<b>警告并继续</b>（§D.3）</td></tr>
</table>

<h3>1.2 非目标</h3>

<table>
<tr><th>非目标</th><th>理由</th></tr>
<tr><td>支持 <code>file://</code> 直接打开</td><td>ES Module 与 XHR 在 <code>file://</code> 下受 CORS 限制。要求 HTTP 服务是明确前提</td></tr>
<tr><td>为每个章节生成独立可索引的 HTML 页面</td><td>与零改写冲突；且会破坏单一入口的 URL 模型。<b>注意区分</b>：章节文件本身就是独立的可索引页面（它们是书里的真实文件），这里拒绝的是「另外生成一份」</td></tr>
<tr><td>解密受 DRM 保护的 EPUB</td><td>检测到 <code>META-INF/encryption.xml</code> 即失败退出（退出码 5）</td></tr>
<tr><td>固定版式（<code>pre-paginated</code>）EPUB 的 SPA 模式</td><td>固定像素视口与响应式壳不兼容。<b>自动降级</b>为多页模式，并在落地页说明原因（§4.6、§12）</td></tr>
<tr><td>改写书的文件名或目录结构</td><td>零改写是硬约束。命名冲突一律<b>报错</b>（退出码 4），不靠改名，也不靠改变布局</td></tr>
<tr><td><b>把书放在站点子目录</b>（v1.1 曾预留的 <code>--book-dir</code>）</td><td>本方案的正确性建立在<b>站点根 = EPUB 根</b>这一条恒等式上（§3.1）。子目录布局会在三处同时打破它：<code>SITE_ROOT</code> 不再是书根（§5.2、I4）、404 引导的前缀剥离失去唯一答案（§8.3 约束 2）、<code>?p=</code> 不再是站点相对路径（§8.2）。收益只是「站点根多一层」，代价是三处同时变复杂——<b>永久移除</b>，详见 E.9</td></tr>
<tr><td>同一个站点里放多本书</td><td>默认假设「一本书就是一个站点」。多书用部署路径（<code>/book-a/</code>、<code>/book-b/</code>）区分</td></tr>
<tr><td><b>分页（<code>numberOfPages</code>、<code>pagination</code>）</b></td><td>可重排 EPUB 本就没有固定分页。一个取自不存在数据源的字段，正确的读法是<b>不输出</b>，而不是输出一个看起来像样但没依据的数字，详见 E.10</td></tr>
<tr><td>为书的内容<b>重新排版</b>（重写字号、重排章节、重新分页）</td><td>壳只做两件事：约束视口、叠加级联层（§5.5）。它<b>不</b>接管书的排版。<b>唯一例外</b>是 I6 要求的可断行（§2）——那是让内容能待在列里所必需的，且只在原本就会溢出的长令牌上生效</td></tr>
</table>

<h3>1.3 术语</h3>

<table>
<tr><th>术语</th><th>定义</th></tr>
<tr><td><b>壳（shell）</b></td><td>生成的 <code>epubsite.html</code>：侧边栏 + 工具栏 + 内容容器，装载 htmx</td></tr>
<tr><td><b>章节文件</b></td><td>EPUB 内的 XHTML 文档（<code>spine</code> 中的项），原样复制到站点根</td></tr>
<tr><td><b>内容区</b></td><td><code>#epub-content</code>，唯一被 htmx 交换的节点</td></tr>
<tr><td><b>面板（pane）</b></td><td>壳里各自独立滚动的两个区域：<code>#toc</code> 与 <code>#epub-content</code>（§5.10）</td></tr>
<tr><td><b>令牌路径</b></td><td>形如 <code>…/text/@ch3.xhtml</code> 的 URL：不对应任何真实文件，作为分享与无障碍入口用的路由令牌。它也只在这一个意义上出现——不进 canonical，但会进运行期章节节点的 <code>url</code>（§7.3、§8.5）</td></tr>
<tr><td><b>真实路径</b></td><td>形如 <code>…/text/ch3.xhtml</code> 的 URL：指向书里实际存在的文件</td></tr>
<tr><td><b>保留命名空间</b></td><td>站点根下由构建期独占的路径集合（§3.2）</td></tr>
<tr><td><b>文档基准</b></td><td>无 <code>&lt;base&gt;</code> 时的 <code>document.baseURI</code>，等于文档自身的 URL，每次访问时重新求值</td></tr>
<tr><td><b>不可断令牌</b></td><td>不含空格、连字符等断行机会的字符串。CSS 只在空格与连字符处断行，<b>不在 <code>.</code>、<code>_</code>、<code>/</code> 处断</b>，所以 <code>a_b.c</code> 与长路径都是原子词（I6）</td></tr>
<tr><td><b>降级（degrade）</b></td><td>功能缺席时<b>继续工作并说明原因</b>，而不是抛错或假装成功。搜索不可用、固定版式、htmx 未加载都走这条路</td></tr>
</table>

<h3>1.4 实现状态</h3>

<p>规范描述的是<b>目标状态</b>。这一节说明当前实现与它的距离，以免读者把未实现的行为当作既定事实。</p>

<table>
<tr><th>能力</th><th>状态</th></tr>
<tr><td>构建（零改写、导航、壳、令牌、结构化数据、审计）</td><td><b>已实现</b></td></tr>
<tr><td><code>--search</code>（Pagefind 索引 + 组件化检索 UI）</td><td><b>已实现</b>（附录 D）</td></tr>
<tr><td><code>--theme</code>、固定版式自动降级、<code>icon.svg</code></td><td><b>已实现</b></td></tr>
<tr><td><code>serve</code>（本地预览）</td><td><b>已实现</b></td></tr>
<tr><td><code>--hosting rewrite</code> 与 <code>all</code></td><td><b>未实现</b>。按约定留报错桩，退出码 2，桩的注释里写明完整契约（§8.4、C.6.1）</td></tr>
<tr><td>CLI 暴露 <code>--host</code></td><td><b>未实现</b>。<code>startServer</code> 接受 <code>host</code>，但 <code>args.ts</code> 的选项表里没有它，命令行传了会报 usage 错。记在附录 F 未决项</td></tr>
</table>

<p>真机验证：IDPF EPUB 3 样本五种（<code>accessible_epub_3</code>、<code>cc-shared-culture</code>、<code>childrens-literature</code>、<code>moby-dick</code>、<code>page-blanche</code>）与一份商用技术书（Apress，27 章，含固定版式外的全部边界情形）全部构建通过。</p>

---

<h2>2. 设计不变量</h2>

<p>整个系统可压缩为七条不变量。所有后续设计都是它们的推论；违反任意一条都会导致可观测的功能失效。</p>

<table>
<tr><th>#</th><th>不变量</th><th>违反的后果</th><th>保障手段</th></tr>
<tr><td><b>I1</b></td><td><b><code>location</code> 的目录部分必须等于当前章节文件的真实目录</b>（文件名可任意）</td><td>内容里所有相对 URL 解析错误 → 图片、字体、交叉链接全部失效</td><td>pushState 早于 swap；入口处 <code>replaceState</code></td></tr>
<tr><td><b>I2</b></td><td><b>壳自有 URL 一律绝对化</b>（对冻结的 <code>SITE_ROOT</code>）</td><td>侧边栏跳转后得到双层前缀路径 → 目录全灭；清单拉取 404 → 内容区空白</td><td>两条互补的路径：DOM 属性走 <code>data-shell</code> 标记 + 启动时一次性绝对化；<b>非属性的引用点</b>（<code>fetch</code>、<code>import</code>、<code>@import</code>、<code>htmx.ajax</code>）在其出现处直接 <code>new URL(…, SITE_ROOT)</code> 锚定。凡是在壳的 URL 上被「重新解析」的东西都算 DOM 属性（§5.3）</td></tr>
<tr><td><b>I3</b></td><td><b>禁止根相对路径（<code>/…</code>）</b>；允许由 <code>--base-url</code> 派生的完整绝对 URL</td><td>子路径部署（<code>/mybook/</code>）下全站 404</td><td>构建期校验 + 运行期对 <code>SITE_ROOT</code> 解析</td></tr>
<tr><td><b>I4</b></td><td><b>位置无关性只允许存在于 404 引导文件里</b>；壳必须始终被服务在它自己的位置上</td><td>壳失去 <code>SITE_ROOT</code> 的运行时来源 → 必须烘焙构建期 URL → 产物不可移植</td><td>架构约束（见 §8.2）</td></tr>
<tr><td><b>I5</b></td><td><b>内容区的每一次导航都必须 push URL</b></td><td>位置停在旧地址 → I1 失效</td><td>CI 断言（见 §13.1）</td></tr>
<tr><td><b>I6</b></td><td><b>文档本身永不滚动；滚动是每个面板各自的职责</b>，且固定宽的列里文本必须可断行</td><td>整章把页面撑长 → 工具栏被推出视口、两面板滚动耦合、章节被裁掉且无法滚动；一个不可断令牌即产生横向滚动条，右内边距（读者的右边距）被推出屏幕</td><td>CSS 结构约束（§5.10）：<b>每条承载内容的网格轨道都声明 <code>minmax(0, …)</code></b>；每个面板 <code>min-height: 0</code> + 自己的 <code>overflow</code>；<code>html</code>/<code>body</code> 用 <code>overflow: clip</code>；<code>:root</code> 上 <code>overflow-wrap: break-word</code></td></tr>
<tr><td><b>I7</b></td><td><b>第三方组件的内部状态由其自己的 API 独占</b>，外壳不得绕过它直接操作其 DOM</td><td>组件的内部控制静默失效：本方案的 Pagefind 模态曾因直接调用 <code>showModal()</code> 而使其自带的关闭按钮毫无反应（§5.9）</td><td>只用组件公开的 <code>open()</code>/<code>close()</code>；把绕过写成测试断言（§13.2）</td></tr>
</table>

<h3>2.1 I1 为什么依赖 pushState</h3>

<p>htmx 的 <code>hx-boost</code> 导航顺序为：<mark>XHR 请求 → <code>pushState</code>(章节 URL) → 内容 swap → 浏览器解析新内容里的相对 URL</mark>。因为 URL 在 swap 之前就已更新，文档基准在解析发生时已指向章节文件所在目录，所以内容里的 <code>../Images/x.png</code>、<code>ch02.xhtml</code>、<code>#fn1</code> 全部自然正确。</p>

<p><b>推论：目录必须保留，只有文件名可以变。</b>这是令牌路径设计的硬约束：</p>

<pre><code>真实路径  /OEBPS/text/ch3.xhtml        目录 /OEBPS/text/
合法令牌  /OEBPS/text/@ch3.xhtml       ← 同目录，✓  ../Images/x.png → /OEBPS/Images/x.png
非法令牌  /OEBPS/@ch3.xhtml            ← 换了目录，✗  ../Images/x.png → /Images/x.png</code></pre>

<p>同理，令牌路径与真实路径之间必须是<b>路径的纯函数且互为双射</b>——因为 404 引导文件工作在任意深度、拿不到任何清单，只能靠字符串变换还原真实路径。</p>

<h3>2.2 I2 的适用范围：凡是会被「重新解析」的都算</h3>

<p>I2 常被理解成「链接要绝对化」，这不够。I2 管的是<b>一切会在文档基准改变后被浏览器重新解析的 URL</b>。v1.3 补进了两类此前漏掉的成员，都来自实测：</p>

<table>
<tr><th>成员</th><th>为什么要重解析</th></tr>
<tr><td>被 htmx 在启动后程序化取用的 URL（<code>fetch</code>、动态 <code>import</code>、<code>@import</code>、<code>htmx.ajax</code>）</td><td>它们求值发生在 <code>pushState</code> 之后，相对写法会解析到章节目录下</td></tr>
<tr><td><b>favicon（<code>&lt;link rel="icon"&gt;</code>）</b></td><td>浏览器在文档 URL 变化后会<b>按当前基准重新解析</b> favicon 的 <code>href</code>。相对写法因此在导航后请求 <code>/OEBPS/text/_epubsite_assets/icon.svg</code> 而 404——并且<b>静默</b>：favicon 404 不报错，只是图标不显示，没人会注意到（§5.3）</td></tr>
</table>

<p>样式表 <code>&lt;link rel="stylesheet"&gt;</code> <b>不必</b>标记：它只在解析期取一次，基准此后变化不影响已加载的样式表。这是规则「按会不会重解析来判」的直接后果，而不是随意豁免。</p>

---

<h2>3. 产物结构</h2>

<h3>3.1 站点根 = EPUB 根</h3>

<p><b>默认假设：一本书就是一个站点。</b>书直接铺在站点根，章节的真实 URL 就是它在书内的路径，不带任何前缀：</p>

<pre><code>https://mybook.surge.sh/OEBPS/text/ch03.xhtml      真实路径
https://mybook.surge.sh/OEBPS/text/@ch03.xhtml     令牌路径</code></pre>

<pre><code>dist/                              ← 站点根 = EPUB 根
├── epubsite.html                  壳（唯一入口，含静态书籍 JSON-LD）        ⟨保留⟩
├── index.html                     仅当书内无同名文件时生成：跳转到 epubsite.html  ⟨保留⟩
├── 404.html                       令牌引导 + 深链接恢复                    ⟨保留⟩
├── publication.json               站点的公开清单                           ⟨保留⟩
├── .epubsite-root                 根标记，供 404.html 探测站点根            ⟨保留⟩
├── _epubsite_assets/              壳的运行期资产                          ⟨保留⟩
│   ├── shell.js                   壳的运行期模块
│   ├── shell.css                  壳样式（含 @layer 声明）
│   ├── htmx.esm.js                vendored htmx（SPA 模式才有）
│   ├── shell-data.json            壳专用数据（SPA 模式才有）
│   ├── icon.svg                   站点图标
│   └── pagefind/                  `--search` 的索引与组件（可选）
├── OEBPS/                         ← 以下全部来自书，逐字节原样
│   ├── package.opf
│   ├── text/ch03.xhtml
│   └── …
└── META-INF/container.xml
</code></pre>

<p><b>为什么 <code>dist/</code> 里的东西和书可以混在一起：</b>因为保留命名空间（§3.2）是一个<b>可判定的前缀集合</b>——<code>epubsite.html</code>、<code>404.html</code>、<code>index.html</code>、<code>publication.json</code>、<code>.epubsite-root</code> 五个文件名，加上 <code>_epubsite_assets/</code>、<code>_hosting/</code> 两个目录前缀。构建期在写盘前检查书里有没有撞上它们，撞上即退出码 4（§3.2）。</p>

<h3>3.2 保留命名空间</h3>

<table>
<tr><th>路径</th><th>用途</th><th>书占用时</th></tr>
<tr><td><code>epubsite.html</code></td><td>壳。可用 <code>--name</code> 改名（但不得为 <code>index.html</code>）</td><td>退出码 4</td></tr>
<tr><td><code>index.html</code></td><td>站点根中转页。仅当书内无同名文件时生成</td><td><b>让位</b>，不生成中转页</td></tr>
<tr><td><code>404.html</code></td><td>令牌引导 + 深链接恢复</td><td>退出码 4</td></tr>
<tr><td><code>publication.json</code></td><td>Web Publication Manifest</td><td>退出码 4</td></tr>
<tr><td><code>.epubsite-root</code></td><td>根标记；404 引导靠它定位站点根（§8.3）</td><td>退出码 4</td></tr>
<tr><td><code>_epubsite_assets/</code></td><td>壳的全部运行期资产（见 §3.1 目录树）</td><td>退出码 4</td></tr>
<tr><td><code>_hosting/</code></td><td>托管规则（<code>--hosting rewrite</code>，尚未实现）</td><td>退出码 4</td></tr>
<tr><td><code>@</code> 开头的文件名</td><td>令牌命名空间（§8.2）。书占用即与令牌路径产生二义</td><td>退出码 4</td></tr>
</table>

<p><code>.epubsite-root</code> 是 v1.2 补进这张表的（E.4）：§8.3 要求探测它，而 v1.1 的表里没有它，书一旦占用该名字，位置无关性就静默失效。</p>

<p><b>检查发生在写盘之前，且检查的是书的条目路径而非磁盘。</b>先写一半再发现冲突，会留下一个既不是书也不是站点的目录。</p>

---

<h2>4. 构建期</h2>

<h3>4.1 流水线</h3>

<pre><code>解析选项 → 保留命名空间检查 → 打开 ZIP
  → 加密检查（encryption.xml → 退出 5）
  → container.xml → OPF → 导航（nav 优先，NCX 回退）→ 各章 &lt;head&gt;
  → 书籍模型 → 结构化数据（JSON-LD + 清单）
  → 固定版式判定 → SPA 判定（--spa && 非固定版式）
  → 逐条抽取书内文件（verbatim）→ 生成壳与资产
  → 零改写校验（§13.1）
  → [--search] 构建检索索引（最后一件事，§4.9）
</code></pre>

<p><code>--dry-run</code> 在前三步之后、写盘之前返回，仍然报告全部诊断。搜索索引<b>必须最后做</b>：它索引的是构建产物，此后写入的任何文件对它都不可见。</p>

<h3>4.2 EPUB 解析</h3>

<p>只用 <code>yauzl</code> 读中央目录，不信任任何未经验证的路径。容器根引用（以 <code>/</code> 开头）<b>翻译</b>为条目路径；ZIP 条目名以 <code>/</code> 开头则是 zip-slip，<b>拒绝</b>。同一个前缀在两者入口处的处置相反，判定必须发生在各自入口（E.7）。</p>

<p>宿主机文件名约束（E.5）：末尾空格与 Windows 保留设备名（<code>CON</code>、<code>NUL</code>、<code>COM1</code>…）无法落盘，且判定<b>不得依赖平台</b>，否则同一本书在两台机器上结论不同。</p>

<h3>4.3 导航提取与 href 解析</h3>

<p>优先 EPUB 3 <code>nav</code> 文档，回退 NCX，都没有则用 spine 合成目录。四条 href 规则覆盖裸片段继承、相对路径、根相对路径与外部 URL。解析时<b>父项 href 必须先于子项解析</b>：游标是文档序的，先解析子项会让每一层嵌套都继承错文件。</p>

<p>页列表（<code>page-list</code>）<b>不解析</b>：分页不是本方案的需求（§1.2、E.10）。</p>

<p>RTL 的「反转」是<b>呈现层</b>职责（E.8）：<code>readingOrder</code> 与每章 <code>position</code> 都派生自 spine 序号，在解析层反转 spine 会同时污染两者，而产物看上去正常——只有读屏与搜索引擎会察觉。</p>

<h3>4.4 章节资产抽取</h3>

<p>每章的 <code>&lt;head&gt;</code> 被解析成槽位数据（外链样式、<code>@import</code>、内联 <code>&lt;style&gt;</code>、<code>body</code> 的 class/dir/lang、<code>&lt;title&gt;</code>、首个 <code>&lt;h1&gt;</code>），写进 <code>shell-data.json</code>，由运行期在导航时逐章应用（§5.4）。</p>

<p><code>url()</code> <b>不重写</b>：改写它需要理解每一处引用的相对基准，而零改写承诺不允许我们猜。外链样式经 <code>@import url(…绝对…) layer(epub)</code> 引入，<code>@import</code> 的 URL 在注入时已锚定到站点根。</p>

<h3>4.5 结构化数据生成</h3>

<p>一个 <code>describe()</code> 同时产出书籍节点、章节节点与清单，避免同一条元数据有三份互相漂移的推导。详见 §7。</p>

<h3>4.6 壳渲染</h3>

<p>标签模板，无模板引擎。壳的 <code>&lt;head&gt;</code> <b>完整服务端渲染</b>：标题、描述、canonical、书籍 JSON-LD 全部静态，所以不执行 JavaScript 的抓取器得到的是一个完整可用的文档。<b>其中 canonical 只对落地页成立</b>——它断言「本文档住在这里」，而这句话对章节是假的，因此读者进入章节后由运行期移除、回到落地页时恢复（§5.4）。</p>

<p>落地页的标记同样服务端渲染，末尾一行是<b>对本项目的致谢</b>：<code>&lt;footer class="credit"&gt;Built with &lt;a href="…"&gt;epubsite&lt;/a&gt;&lt;/footer&gt;</code>。它写在 <code>#epub-content</code> <b>里面</b>，于是「只属于落地页」是位置的结果而不是一条需要维护的条件：章节打开时整个面板被书的标记替换，致谢随之离开，首页控件把这一段换回来时它也一并回来（§5.7）。从令牌路径或 <code>?p=</code> 直接进入章节的读者从未看到它。它不上 404 引导页，也不上中转页——那两个文件不是壳。</p>

<p>三个属性是「这是阅读器而不是一页链接」的全部依据，各自都有一个看似合理的错误替代：<code>hx-boost="true"</code> 在 <code>&lt;body&gt;</code> 上（唯一零改写地接管书内成百上千个普通链接的办法）、<code>hx-target="#epub-content"</code>（覆盖 boost 默认的 <code>&lt;body&gt;</code>；侧边栏能在导航中存活<b>完全</b>靠它——它在目标之外，htmx 从不触碰它）、<code>hx-swap="innerHTML show:top"</code>。</p>

<p><code>--no-spa</code> 不输出这三个属性，也不输出运行期模块，于是同一份标记就是一份普通的多页站点。这不是「降级模式」，而是 SPA 层所增强的基线。</p>

<p><b>固定版式自动降级</b>：<code>pre-paginated</code> 的书无法被壳重排，所以构建把 <code>spa</code> 关闭并在落地页写明原因。假装能重排的结果比诚实说明更差。</p>

<h3>4.7 404 引导与 <code>index.html</code> 中转页</h3>

<p>引导页是 I4 里唯一允许位置无关的产物：它工作在任意部署深度，靠 <code>.epubsite-root</code> 向上探测站点根（§8.3）。中转页把站点根访问转移到壳，并且<b>不留在历史记录里</b>——读者按「后退」应当离开站点，而不是在两页之间摆动。</p>

<h3>4.8 托管规则生成（<code>--hosting</code>）</h3>

<table>
<tr><th>模式</th><th>行为</th></tr>
<tr><td><code>none</code></td><td>只出文件，不生成任何托管配置</td></tr>
<tr><td><code>404</code>（默认）</td><td>生成 <code>404.html</code>。这是令牌协议在 GitHub Pages / Netlify / Cloudflare Pages 上生效的方式</td></tr>
<tr><td><code>rewrite</code> / <code>all</code></td><td><b>未实现</b>：报错桩，退出码 2，消息里写明原因。连带后果见 C.6.1：路径形态的 <code>--base-url</code> 会被校验但对产物不产生任何影响</td></tr>
</table>

<h3>4.9 检索索引构建</h3>

<p>由 <code>--search</code> 启用，是构建的<b>最后一步</b>。三个决定值得记录：</p>

<table>
<tr><th>决定</th><th>理由</th></tr>
<tr><td>索引范围由 <b>spine</b> 派生</td><td>Pagefind 默认递归通吃所有 <code>.html</code>，那会把壳、中转页与 404 引导一并索引——它们是<i>关于</i>书的文档，不是书的内容。排除它们最顺手的工具 <code>data-pagefind-body</code> 被<b>禁用</b>：它是全站开关，放到壳上就等于把每一章从索引里去掉（§5.1）</td></tr>
<tr><td>失败一律<b>警告并继续</b>，退出 0</td><td>站点的其余部分是完整正确的；为一个可选能力让整个产物构建失败，是把可选当成必需（§D.3）</td></tr>
<tr><td>Pagefind <b>不是任何形式的依赖</b></td><td>连可选依赖都不是。它只是被发现的<b>外部工具</b>：显式 <code>--pagefind</code> → 向上找 <code>node_modules/.bin</code> → <code>npx --no-install</code> → <code>npx --yes</code>。发布的包里没有它</td></tr>
</table>

<p>索引在临时工作目录里生成，配置以 <code>pagefind.yml</code> 写入该目录，命令以该目录为 cwd 运行，<b>与调用者的 cwd 隔离</b>。<code>GLOB_LIMIT = 8000</code> 是兜底：书大到让模式串本身不合理时，退化为递归 glob 并发 <code>W_SEARCH_GLOB_FALLBACK</code>，而不是拼出一个几兆的路径列表。</p>

---

<h2>5. 运行期</h2>

<h3>5.1 壳结构</h3>

<pre><code>&lt;body hx-boost="true" hx-target="#epub-content" hx-swap="innerHTML show:top" hx-indicator="#progress"&gt;
  &lt;a class="skip-link" data-shell&gt;          ← 跳过导航，名字必须带壳文件名（§5.2）
  &lt;nav id="toc" aria-label="Table of contents"&gt;   侧边栏（面板 1）
  &lt;div id="frame"&gt;
    &lt;header id="toolbar"&gt;                   ← 目录开关（符号）/ 首页 / 书名 / 搜索 / 折叠 / 分享 / 进度
    &lt;main id="epub-content" tabindex="-1" aria-live="polite"&gt;   内容（面板 2；落地页末尾为致谢行）
  &lt;/div&gt;
&lt;/body&gt;</code></pre>

<p><code>#epub-content</code> 是唯一被交换的节点；<code>#toc</code> 与 <code>#toolbar</code> 都在它之外，这是侧边栏 DOM 节点引用不变的全部原因（G3）。<b>落地页末尾的致谢行也在它里面，因此共享同一命运</b>：它是落地页的一部分，不是阅读器永久 chrome 的一部分。</p>

<p><strong>禁止在壳的任何元素上加 <code>data-pagefind-body</code></strong>。它是全站开关：标在壳上，索引里就只剩下壳。</p>

<h3>5.2 URL 与基准机制</h3>

<p>站点根在启动时读取一次并<b>冻结</b>（<code>SITE_ROOT</code>），来源是 <code>&lt;html data-site-root&gt;</code>，缺省为 <code>.</code>。冻结是关键：导航会改变文档基准，如果 <code>SITE_ROOT</code> 是「当前基准的某处」，它就会在每次导航后漂移，而 I2 要求它是一个不动点。</p>

<p>跳过链接在 SPA 模式下必须写明壳文件名：<code>pushState</code> 之后裸 <code>#epub-content</code> 会对着章节目录解析，把读者带离阅读器。</p>

<h3>5.3 壳自有链接绝对化（I2）</h3>

<p>两条互补路径，缺一不可：</p>

<ol>
<li><b>DOM 属性</b>：凡是带 <code>data-shell</code> 且有 <code>href</code> 的元素，启动时一次性绝对化（<code>data-abs</code> 保证幂等，因此壳的 DOM 变化后可以再跑一次）。用 <code>setAttribute</code> 而不是 <code>a.href =</code>，让内容属性与 IDL 属性保持同步。</li>
<li><b>非属性引用点</b>：<code>fetch</code>、动态 <code>import</code>、<code>@import</code>、<code>htmx.ajax</code> 在各自出现处直接 <code>new URL(…, SITE_ROOT)</code>。给它们加标记没有意义——标记是给「浏览器会读属性」这件事用的。</li>
</ol>

<p>标在 <code>data-shell</code> 上的选择本身有理由：用选择器（如 <code>#toc a</code>）挑选会<b>静默漏掉</b>下一个被加进壳的链接，而失败只在导航之后、在没人测的页面上出现。</p>

<p><b>favicon 属于第 1 类</b>（§2.2）：它是 DOM 属性，而且会被重新解析。</p>

<h3>5.4 章节资产同步（head 槽位）</h3>

<p><code>syncChapter()</code> 一次做完五件事——样式、<b>落地页的 canonical 链接</b>、<code>body</code> 属性、侧边栏高亮、文档标题——因为它们由同一个 key 驱动，拆成多个监听器就是它们开始互相漂移的方式：一个在 <code>afterSwap</code> 触发、另一个在 <code>afterSettle</code>，页面会有若干帧停在一个没人设计过的状态里。</p>

<p>为什么要同步 <code>body</code> 属性：htmx 交换的是章节的 <b>body 内容</b>，不是它的 <code>&lt;body&gt;</code> 元素，所以 <code>class</code>、<code>dir</code>、<code>lang</code> 会静默丢失。一本在 body 上写 <code>class="calibre"</code> 的书会在第二章丢掉它、在第一章保留它——这类缺陷会长时间伪装成样式问题。</p>

<p>回到落地页时必须<b>清除</b>书的样式，否则落地页会用上一章的字体重排。</p>

<p><b>canonical 槽位是其中唯一一个必须在两个方向上都正确的槽位。</b>进入章节时它必须消失：那个标签描述的是落地页，而读者此刻看的是章节，留着它就等于宣称每一章都是落地页的副本——canonical 能说出的最伤的一句假话。回到落地页时它必须回来：只删不还的实现能通过「进入章节」的检查，却会把标签永久留在删除状态，而读者按「后退」时<b>没有任何东西</b>会重新断言 <code>&lt;head&gt;</code> 的状态（htmx 的历史缓存只存 body、标题与滚动位置）。恢复的是<b>原节点本身、插回它当时的前一个后继兄弟之前</b>，而不是重新创建一个再追加到 <code>&lt;head&gt;</code> 末尾：后者会让头部结构随运行期槽位的增减而漂移，而前者还原的正是构建期写下的那份结构。</p>

<h3>5.5 样式与级联层</h3>

<p><code>shell.css</code> 的第一行 <code>@layer epub, shell;</code> 是承重的，不是装饰。它固定整个文档的层序，于是书贡献的每一条规则（运行期注入时都裹在 <code>@layer epub</code> 里）都输给壳的每一条规则，<b>与选择器特异性和源序无关</b>。</p>

<p>但层序只解决<b>冲突</b>。壳没声明的属性，书仍然生效——这是 I6 那类缺陷的温床：书若在某处设了 <code>white-space</code>，壳自有的元素也会被影响，因为壳没表态。规则：<b>决定壳自身布局的属性，壳必须自己声明</b>（§5.10）。</p>

<h3>5.6 章节 JSON-LD 的注入</h3>

<p>运行期只注入<b>章节</b>节点（带 <code>data-epub-ld</code> 标记），书籍节点是壳 <code>&lt;head&gt;</code> 里的静态内容、不带标记，因此永远不会被移除。这是两层一图能同时服务「执行 JS」与「不执行 JS」两批消费者的原因。</p>

<p>落地页的 canonical 链接是第二个带标记的 head 槽位，标记为 <code>data-epub-canonical</code>（§5.4）。标记的含义与上面一致：这个节点归运行期管。差别在于它是唯一一个<b>必须被移除</b>才算正确的静态标签——其余槽位都是「按需注入」。</p>

<h3>5.7 导航交互</h3>

<p><code>hx-boost</code> 接管链接，两个<b>刻意</b>的例外：</p>

<ul>
<li><b>同章节内的片段链接</b>：htmx 的 <code>shouldCancel</code> 会取消任何原始 href 不匹配 <code>/^#.+/</code> 的链接的默认行为，所以这类链接必须由我们<b>自己执行跳转</b>（<code>window.location.hash</code> + scroll），否则读者点了目录项却什么也不会发生。</li>
<li><b>外部链接</b>：标 <code>hx-boost="false"</code>。没有这个退出开关，boost 会拦截点击、<code>selfRequestsOnly</code> 会拒绝请求，链接彻底失效——比不 boost 更糟。</li>
</ul>

<p><b>返回落地页的控件</b>是壳里唯一一个 href 指向壳自身的链接，它靠两个属性成立。<code>data-shell</code> 让它在 <code>pushState</code> 之后仍指向站点根（§5.3）——相对写法会指向章节目录，而 §8.2 的引导页<b>不会</b>救它，因为那里只重定向 <code>@</code> 形状的路径。<code>hx-select="#epub-content &gt; *"</code> 把它变成一次普通的交换请求：落地页不是片段，它就是壳文档，所以增强导航请求回来的是一整份壳；而 htmx 的选择器交出的是<b>匹配到的节点本身</b>，于是选中 <code>#epub-content</code> 会把内容面板套进它自己（重复 id、两个侧边栏），选中它的<b>子节点</b>才是「把面板内容换成落地页」。目的地状态全部由 §5.4 的同一个同步负责：样式、章节 JSON-LD、<code>body</code> 属性、侧边栏高亮、canonical 一起切换；文档标题由 htmx 从响应的 <code>&lt;title&gt;</code> 恢复；滚动位置由上面的 <code>afterSettle</code> 归零。</p>

<h3>5.8 分享</h3>

<p>把当前章节转成<b>令牌路径</b>放进剪贴板。令牌路径在产物里只出现两处：剪贴板，以及<b>运行期注入的章节节点的 <code>url</code></b>（§7.3）。除此之外它不在 <code>readingOrder</code> 里、不在 canonical 里、不在 Open Graph 里、也不在地址栏里。</p>

<p>这两处看着像多留了一道口子，其实区分是必要的：<b>canonical 断言「这才是这一章的家」，而 <code>url</code> 里的一条只断言「也可以从这里到达」。</b>前者在默认托管模式下是假的——那个地址返回 404；后者是真的——§8.2 的 404 引导确实能把读者送到这一章。把两句话当成同一句话，才会得出「令牌路径应当被彻底排除」的结论。<b>本版把这条原则推到底：章节在阅读器里根本不写 canonical</b>——不只否决令牌地址，连真实地址也不写（§5.4、§8.5）。读者是壳，壳自己的地址是落地页；替章节断言「它住在这里」本来就是章节自己的文件更有资格做的事。</p>

<p>同一个 404 也解释了为什么它<b>不</b>进静态的 <code>book.hasPart</code>：那份引用是给不执行 JS 的抓取器准备的（§7.2），而令牌地址恰恰只有执行 JS 才走得到。两件事的受众不重叠，因此可以各取所需而不矛盾。</p>

<p>落地页上没有章节可令牌化，于是复制<b>阅读器自己的地址</b>——「这是这本书」。按钮<b>永不禁用</b>：一个首次使用时什么都不做的控件，读起来就是一个坏掉的控件。片段被保留，因为分享一条脚注引用就应该落到那条脚注上。</p>

<h3>5.9 检索运行期</h3>

<p>按需加载：首次打开才取 Pagefind 的组件包（约 250 KB），大多数读者从不搜索。三个决定：</p>

<table>
<tr><th>决定</th><th>理由</th></tr>
<tr><td><b>模态的生命周期交给组件，用它的 <code>open()</code>/<code>close()</code></b></td><td>I7。<code>&lt;pagefind-modal&gt;</code> 有自己的 <code>_isOpen</code> 状态；直接对内部的 <code>&lt;dialog&gt;</code> 调 <code>showModal()</code> 会打开对话框却让标志仍为 <code>false</code>，于是组件认为自己已关闭，<b>它自己渲染、自己标注「close」的关闭按钮点击后毫无反应</b>。必须 <code>modal.open()</code>，那个标志才会被设置</td></tr>
<tr><td><b>关闭按钮在所有宽度都显示</b></td><td>组件默认在 640px 以上隐藏它（假定桌面读者会按 Esc）。一个唯一的出口是「没人告诉过你的某个键」的模态是个陷阱，而且触屏笔记本就是桌面宽度。覆盖需要 <code>!important</code>：Pagefind 的样式表是<b>非分层</b>注入的，而非分层的普通声明胜过一切分层声明——<code>@layer shell</code> 里的任何东西都压不住它</td></tr>
<tr><td><b>结果点击在捕获阶段拦截，并用 <code>composedPath()</code></b></td><td>结果指向章节的真实路径，交给浏览器就等于把读者丢到一个没有侧边栏的裸页面上——正是 §8 要防的失败，从一个没人看守的门进来。用 <code>composedPath()</code> 是因为组件在 shadow root 里渲染结果，普通 <code>closest('a')</code> 什么也看不到</td></tr>
</table>

<p>组件样式表以<b>非分层</b> <code>&lt;link&gt;</code> 注入，因此按层序压过 <code>layer(epub)</code> 的每一条规则。404 引导<b>永不</b>加载 Pagefind（§D.2）。</p>

<h3>5.10 布局与滚动（I6）</h3>

<p>壳是一个<b>两面板视口</b>：<code>#toc</code> 与 <code>#epub-content</code> 各自滚动，文档本身永不滚动。这组不变量在实现中逐条以缺陷的形式暴露过，所以每条都同时写出它防的是什么。</p>

<table>
<tr><th>构造</th><th>防的是什么</th></tr>
<tr><td><b>每条承载内容的网格轨道都声明 <code>minmax(0, …)</code></b>：<code>body</code> 的行与列、<code>#frame</code> 的列与行</td><td><code>1fr</code>（以及隐式 <code>auto</code>）轨道的下限是内容，不是 0。于是一章长文会把行撑到章节高度、<code>1fr</code> 没有余量可分、<code>overflow: auto</code> 永不生效，整个页面变成一张三万像素的长纸。<code>minmax(0, …)</code> 两次打断这个循环：轨道就是容器的高度，显式 <code>0</code> 下限让内容无法把它吹大。<b>这一条在四个不同位置各错过一次</b>，最后一次的元凶是工具栏里不换行的 flex 项把列撑到 511px（视口 500px），于是内容区的右内边距——读者的整个右边距——被推到屏幕之外</td></tr>
<tr><td>每个面板 <code>min-height: 0</code> + 自己的 <code>overflow</code></td><td>网格项的最小尺寸是内容，不声明 <code>0</code> 它就会长大而不是滚动</td></tr>
<tr><td><code>html</code>/<code>body</code> 用 <code>overflow: clip</code></td><td><code>overflow: hidden</code> <b>仍然是滚动容器</b>：<code>scrollIntoView</code> 与 htmx 的 <code>show:top</code> 依然能滚动它。工具栏正是这样滑到视口上方 51px 处的——滚章节把整个 <code>body</code> 滚了，工具栏跟着走。<code>clip</code> 根本不创建滚动容器</td></tr>
<tr><td><code>:root</code> 上 <code>overflow-wrap: break-word</code>（可继承）</td><td>CSS 只在空格与连字符处断行，<b>不在 <code>.</code>、<code>_</code>、<code>/</code> 处断</b>。于是 <code>spec.add_development_dependency</code>（侧边栏里的方法名）与 <code>/home/someuser/.local/share/…/example.rb</code>（正文里的路径）都是<b>原子词</b>，固定宽的列对此只有一条出路：长出横向滚动条。用 <code>break-word</code> 而非 <code>anywhere</code>：前者只在原本会溢出时才断，且不改变固有尺寸计算，表格与浮动仍按书的本意度量</td></tr>
<tr><td><code>--shell-toolbar-height</code> 单一令牌，同时驱动工具栏高度与抽屉的上边距</td><td>见 §5.11：两处需要同一个数，而它们一旦漂移，抽屉就会盖住工具栏</td></tr>
</table>

<p><b>内容区允许横向滚动，但只在它已恰好等于视口宽度之后。</b>此时右内边距是稳定的右边距，少数真正更宽的行（设置了 <code>white-space: pre</code> 的代码）可以滚动而不是被裁掉。</p>

<p><b>不要枚举「哪些东西可能很宽」。</b>曾经为了让内容区不横向滚动，把溢出交给 <code>pre, table</code> 自行处理。这个列表只活了一本书：Apress 把代码放在 <code>&lt;div class="ProgramCode"&gt;</code> 里，于是长代码行变得<b>够不着</b>。手工维护的「可能是宽的东西」清单永远不完整，而读不到一行的结尾比一条滚动条更糟。</p>

<h3>5.11 窄屏抽屉</h3>

<p>窄屏下侧边栏变成覆盖层，由工具栏上的一个按钮开关。该按钮在宽屏下不显示（那里侧边栏常驻），在窄屏下是一个<b>符号</b>而不是文字「Contents」——它的可及名称在 <code>aria-label</code> 上（§11.1）。</p>

<p><b>不变量：覆盖层不得盖住开关它的那个控件。</b>抽屉最初占满整个视口高度，于是打开它就盖住了打开它的那个按钮——唯一的出路是刷新页面。修法是几何的，不是加一个控件：抽屉从工具栏<b>下方</b>开始，开关因此始终可点，同一个按钮负责开也负责关。一个控件、一个布尔量，两者不可能互相矛盾。</p>

<p>这要求工具栏的高度<b>精确</b>而非近似，所以 <code>--shell-toolbar-height</code> 声明一次，同时驱动 <code>#toolbar</code> 的 <code>height</code>（配 <code>box-sizing: border-box</code>）与抽屉的 <code>inset-block-start</code>。</p>

<p>状态放在 <code>&lt;html&gt;</code> 的 <code>data-drawer-open</code> 上：一个属性要同步的东西只有一件，样式表可以在任意断点响应它而 JavaScript 无需知道布局，<code>aria-expanded</code> 可以从它派生而不是另行跟踪。注意 <code>aria-expanded</code> 是<b>字符串</b>：<code>setAttribute(name, false)</code> 会写入字面量 "false"，辅助技术读成<i>已展开</i>，与意图完全相反。</p>

<p><b>验收必须用命中测试。</b><code>toBeVisible()</code> 在被面板盖住的按钮上照样通过。真正的断言是「在按钮中心点做命中测试，结果是这个按钮」——这也正是浏览器在读者点击时做的事。</p>

<p><b>样式陷阱，必须记下：</b>目录开关与其余符号控件共用一组样式，而那组选择器是两个 id 宽（<code>#toolbar #…</code>，为了压过 <code>#toolbar button</code>）。因此 <code>#toc-toggle</code> 的 <code>display: none</code>（宽屏）与窄屏下的 <code>display: inline-flex</code> 也必须写成两个 id，否则它们会<b>输给那一组</b>，开关会在所有宽屏下现形——一个只在把新控件加进那组时才出现的缺陷，与加进去的那行规则看起来毫无关系。</p>

---

<h2>6. Head 管理策略 · 决策记录</h2>

<h3>6.1 结论</h3>

<p><b>不使用 htmx 的 head-support 扩展。</b>章节的 <code>&lt;head&gt;</code> 由壳自己按槽位同步（§5.4）。</p>

<h3>6.2 为什么不使用 head-support</h3>

<p>它解决的是「交换片段时把片段里的 head 也合并进来」。我们要的不是合并，而是<b>替换</b>：章与章之间，上一章的样式必须消失，否则两本书的字体与边距会叠加。合并语义需要我们把「移除」表达成合并的补集，而那正是错的抽象方向。</p>

<h3>6.3 决定性论证</h3>

<p>head-support 只在 htmx 处理交换时生效。而<b>入口导航</b>、<code>historyRestore</code>、以及裸页面加载都不经过它的路径。于是同一件事会有两套代码路径，其中一套只在读者按了后退时才跑——那是最不容易被测到的地方。</p>

<h3>6.4 判断规则</h3>

<p>需要「上一状态必须消失」时自己管；需要「新状态叠加到旧状态上」时才考虑合并语义。</p>

---

<h2>7. JSON-LD 图模型</h2>

<h3>7.1 两层一图，外加一份清单</h3>

<p>书籍节点静态存在于壳的 <code>&lt;head&gt;</code>，章节节点由运行期注入并与前者通过 <code>@id</code> 互链。清单（<code>publication.json</code>）是<b>面向外部</b>的标准产物，与 JSON-LD 是两件事（C.7）。</p>

<h3>7.2 书籍节点</h3>

<p><code>@type: ["Book"]</code>，含标识符、标题、作者（含 <code>role</code>）、译者、出版社、语言、描述、日期、以及 <code>hasPart</code>——<b>每一章的 name/url/position 都在这里</b>（<code>url</code> 只在绝对 <code>--base-url</code> 下存在，且只是真实地址，§7.3、§7.5）。这是「不执行 JS 的抓取器也能看到全貌」的全部依据（§7.7）。</p>

<p>不含 <code>numberOfPages</code>，不含 <code>pagination</code>（E.10）。</p>

<h3>7.3 章节节点</h3>

<p><code>@type: ["Chapter", "Article"]</code>，<code>@id</code> 为 <code>{bookId}#ch-{position}</code>，<code>isPartOf</code> 指向书籍节点，并带 <code>articleSection</code>（父级标题）与 <code>position</code>（阅读顺序）。</p>

<p><code>url</code> 是一个<b>数组</b>，列出这一章可以到达的地址：真实路径，以及 §8.2 的令牌路径。两个地址指向同一份内容，这是<b>事实</b>而非冗余——令牌地址在默认托管模式下确实能到达这一章，只是要绕一次 404 引导。</p>

<p>它因此是<b>唯一一个构建期与运行期共同写入的字段</b>，而分工不是随意的：</p>

<table>
<tr><th>时机</th><th>写入什么</th><th>为什么只能在这里</th></tr>
<tr><td>构建期</td><td>真实地址，且<b>仅当 <code>--base-url</code> 为绝对形态</b></td><td>路径形态不携带 origin（§7.5）。「站点此刻被服务在哪个源」是 G7 明确要求不猜的东西</td></tr>
<tr><td>运行期</td><td>读者真正到达的真实地址，加上它的令牌形态</td><td>只有此刻才知道自己是在哪个 origin、哪个子路径下被打开的——预览地址、改名的域名、本地端口都算数</td></tr>
</table>

<p>运行期的写法是<b>并集而不是覆盖</b>：已有的值原样保留，只追加缺失的，比较时把两边都化到 URL 的规范形态。这两条各自都有一个具体理由。保留是因为构建期写下的值可能正是对的（绝对 <code>--base-url</code> 下就是），覆盖等于用运行期的猜测替换构建期的事实；比较要规范化的理由是同一个地址有两种拼法——构建期写的是 zip 里的条目名，浏览器写的是百分号编码后的形态，<code>a b.xhtml</code> 与 <code>a%20b.xhtml</code> 是同一个文档，按字符串比会把它列两遍，恰好违反「只追加缺失的」。</p>

<p>节点是<b>替换</b>而非累积的：每次导航重建整个 <code>jsonld</code> 槽位（§5.6），落地页上则连章节节点都不存在。滞留下来的旧 <code>url</code> 会宣称「本页也是读者已经离开的那一章」，而这正是 <code>url</code> 存在时要做的断言，只不过做假了。</p>

<p><b>静态 <code>book.hasPart</code> 的引用不带令牌地址</b>，这是决定而非遗漏。它是给不执行 JS 的抓取器看的（§7.2），而令牌地址<b>只有</b>执行 JS 才走得到。于是两类消费者恰好各取所需：执行 JS 的看到两个地址，不执行的看到一个，而那个一定可用。</p>

<h3>7.4 决策：<code>@id</code> 用标识符而非 URL</h3>

<p>URL 会随部署位置改变，标识符不会。用 URL 会让「换域名不必重新构建」（G7）失效：图里的每一个 <code>@id</code> 都会变成构建期的猜测。</p>

<h3>7.5 字段映射</h3>

<table>
<tr><th>来源</th><th>去向</th><th>备注</th></tr>
<tr><td><code>dc:identifier</code></td><td>书籍 <code>@id</code> / <code>identifier</code></td><td>保留 <code>urn:isbn:</code>、<code>urn:uuid:</code>；<b>绝对 URL 原样保留</b>（它是合法的 IRI）；裸 ISBN/UUID 补前缀；其余取文本 SHA-256 前 16 位并发 <code>W_IDENTIFIER_UNPARSEABLE</code>。实测中五本 IDPF 样本里有四本用的不是 URN 标识符（其中一本用 Gutenberg 的 URL），因此这条规则是必要的而非防御性的</td></tr>
<tr><td>spine 序号</td><td><code>position</code>、<code>#ch-N</code></td><td>解析层永不反转（E.8）</td></tr>
<tr><td>spine 序号</td><td>清单 <code>readingOrder</code></td><td><b>只收 <code>linear</code> 项</b>。EPUB 的 <code>linear="no"</code> 标记的是「不在线性阅读序列里」的内容——封面、版权页，以及<b>导航文档自身</b>——而 Publication Manifest 没有表达该标记的词汇。把它放进 <code>readingOrder</code> 等于叫消费者把目录当正文读。那些条目改列 <code>resources</code> 并带 <code>rel="contents"</code>；阅读器侧边栏不受影响，它展示的是书自己的目录，与「什么是阅读顺序」是两个问题（E.11）</td></tr>
<tr><td>nav 祖先</td><td><code>isPartOf</code></td><td><b>单节点</b>，不输出祖先链：链需要祖先节点具备身份，而 nav 树只给出祖先的 <i>label</i>，要拼出链条就得为书中从未命名的节点编造 <code>@id</code>。链条本想承载的信息已由 <code>articleSection</code> 与 <code>position</code> 给出（E.11）</td></tr>
<tr><td>spine 条目路径</td><td>章节 <code>url</code></td><td><b>数组</b>，且是唯一由构建期与运行期共同写入的字段（§7.3）。构建期只在<b>绝对</b> <code>--base-url</code> 下写真实地址，并按 URL 规则百分号编码（条目名含空格的书不能写出一个带空格的「URL」）；运行期再把读者实际到达的地址与其令牌形态并入，已有的值原样保留。令牌地址<b>只</b>进这个数组：不进 canonical、不进 <code>book.hasPart</code>（§5.8、§8.5）。<code>--json-ld thin</code> 只裁剪 <code>book.hasPart</code>，运行期注入的章节节点<b>不裁剪</b>；<code>--json-ld none</code> 下根本没有章节节点，因此也就没有 <code>url</code> 可言。另：阅读器显示章节时<b>不写 canonical</b>（§5.4），因此这个数组是阅读器对章节地址做的唯一声明</td></tr>
</table>

<h3>7.6 为什么 <code>@type</code> 是数组</h3>

<p>JSON-LD 允许一个节点属于多个类型，而章节既是 <code>Chapter</code> 也是 <code>Article</code>——不同消费者认不同的词。输出数组让两边都拿到自己认的那个，代价只是一个方括号。</p>

<h3>7.7 局限（必须明说）</h3>

<ul>
<li><b>只有两层。</b>没有 <code>Part</code>、没有章节内的 <code>Section</code>，图深不超过 2。</li>
<li><b>不执行 JS 的消费者看不到章节节点</b>——这是刻意的：书籍节点的 <code>hasPart</code> 已经给出了每一章，章节节点是给执行 JS 的消费者的<i>增量</i>，不是唯一入口。因此<b>令牌地址只对执行 JS 的消费者可见</b>，而那恰好是能用得上令牌地址的一类（§8.5）；反过来也成立——不执行 JS 的抓取器从来看不到一个它取不到的地址，因为那个地址只存在于它看不到的节点里。</li>
<li><b>标识符不可解析时是派生的</b>：改了文本就改了身份，警告里写明这一点。</li>
</ul>

---

<h2>8. URL 与入口 · 决策记录</h2>

<h3>8.1 问题</h3>

<p>零改写意味着 <code>/OEBPS/text/ch03.xhtml</code> 是书里的真实文件，直接打开它是一个<b>没有侧边栏的裸页面</b>。这在 G1 下是正确的（每个章节都能独立阅读），但读者从搜索结果或别人的分享点进来时，期望的是阅读器。这两种期望指向同一个 URL，而我们不能改这个 URL——它就是文件。</p>

<h3>8.2 方案：令牌路径 + 404 引导</h3>

<p>保留一个<b>平行的</b>寻址方案：在文件名前加 <code>@</code>。该路径不对应任何文件，因此必然 404，而 404 的响应体就是我们的引导页。</p>

<pre><code>读者请求  /OEBPS/text/@ch03.xhtml
  → 404，响应体是引导页（URL 不变）
  → 引导页识别 @ 令牌，探测站点根（.epubsite-root）
  → 跳转到 epubsite.html?p=%2FOEBPS%2Ftext%2Fch03.xhtml
  → 壳 replaceState 到 /OEBPS/text/ch03.xhtml 并加载章节</code></pre>

<p>读者最终停在<b>诚实的地址</b>上：复制它、刷新它、发给别人，全都可用，有没有壳都一样。</p>

<p><b>这个方案需要 404-作为-响应体，所以 <code>--hosting none</code> 下它不生效</b>，裸页面依然正确服务。<b>代价明言接受</b>（E.9）：令牌协议依赖默认托管模式。</p>

<h3>8.3 入口文件的约束</h3>

<ol>
<li><b>URI 复杂度不得增加</b>：令牌不得引入查询串或额外路径段，否则 <code>?p=</code> 与 <code>#fragment</code> 会互相干扰。</li>
<li><b>前缀剥离必须有唯一答案</b>：引导页拿不到站点根，只能靠向上探测 <code>.epubsite-root</code>。</li>
<li><b>不得劫持缺失资源</b>：书里缺失的图片必须仍然是 404，不能被引导页变成一次章节加载。这条最容易违反，因为「任何 404 都跳转」是最省事的写法。</li>
<li><b>中转页不得留在历史记录里</b>（§4.7）。</li>
<li><b>入口参数不得丢失</b>：令牌入口带回 <code>?p=</code> 与片段。</li>
</ol>

<h3>8.4 可选：托管重写规则</h3>

<p>见 §4.8。<b>未实现</b>，退出码 2。</p>

<h3>8.5 被否决的替代方案</h3>

<table>
<tr><th>方案</th><th>否决理由</th></tr>
<tr><td>在壳里用 <code>history.replaceState</code> 把裸页面「改造」成阅读器</td><td>裸页面里没有壳的代码，也没法在不改写书的前提下把它放进去</td></tr>
<tr><td>把令牌 URL 放进 canonical / sitemap / Open Graph</td><td>默认托管模式下它 404。把搜索引擎指向一个失败，是最糟的一种 SEO。本版把这条原则用到极限：阅读器显示章节时<b>连真实地址也不写 canonical</b>，因为那个标签描述的是落地页而不是这一章（§5.4）</td></tr>
<tr><td>为每章生成包装页</td><td>那不是零改写，而且会让同一内容有两个 URL</td></tr>
<tr><td><b>把令牌地址列进运行期章节节点的 <code>url</code>（本版采纳，作为上一条的例外）</b></td><td><b>不与上一条矛盾，但确实放松了一条原则，因此写在这里而不是埋进 §7.3。</b>上一条否决的是把令牌地址当作<b>规范地址</b>：canonical 说的是「这才是这一章的家」，而在默认托管模式下那是个 404。数组里的一条说的是「也可以从这里到达」，这是真的。代价必须记下来：一个不执行 JS 的抓取器如果看到这个 <code>url</code>，会拿到一个它取不到的地址；但这个字段只出现在<b>需要执行 JS 才能看到的</b>章节节点里（§5.6），两个受众恰好错开，而静态的 <code>book.hasPart</code> 不带令牌地址正是为了让这个错开成立。三处输出对同一件事给出三种说法是设计，不是不一致</td></tr>
</table>

---

<h2>9. CLI</h2>

<pre><code>epubsite &lt;book.epub&gt; [options]
epubsite serve [dir] [--port &lt;n&gt;]</code></pre>

<table>
<tr><th>选项</th><th>默认</th><th>说明</th></tr>
<tr><td><code>-o, --out &lt;dir&gt;</code></td><td><code>./dist</code></td><td>相对<b>调用者</b>的 cwd，绝不相对包自身</td></tr>
<tr><td><code>--name &lt;file&gt;</code></td><td><code>epubsite.html</code></td><td>不得为 <code>index.html</code></td></tr>
<tr><td><code>--base-url &lt;url&gt;</code></td><td><code>/</code></td><td>路径形态（<code>/sub/</code>）或绝对形态（<code>https://host/sub/</code>）。<b>只有绝对形态</b>才能产出<b>落地页的</b> canonical 与<b>静态</b> JSON-LD <code>url</code>／<code>image</code>——路径形态知道站点住哪，但不携带 origin。canonical 另受 §5.4 约束：它描述落地页，读者进入章节后即移除。<b>本版同时删掉一处旧陈述：<code>og:image</code> 从未实现</b>——产物里没有任何 <code>og:*</code> 标签，「绝对形态解锁 og:image」是错的。运行期注入的章节节点不受此限：它自己知道被打在哪个源下，因此总会写入 <code>url</code>（§7.3）</td></tr>
<tr><td><code>--hosting &lt;mode&gt;</code></td><td><code>404</code></td><td><code>none</code> / <code>404</code> / <code>rewrite</code> / <code>all</code>。后两者未实现</td></tr>
<tr><td><code>--json-ld &lt;mode&gt;</code></td><td><code>full</code></td><td><code>full</code> / <code>thin</code> / <code>none</code>；<code>--no-json-ld</code> 是后者的简写。<b>不影响</b> <code>publication.json</code>（A.1）</td></tr>
<tr><td><code>--search</code></td><td>关</td><td>构建 Pagefind 索引（附录 D）</td></tr>
<tr><td><code>--pagefind &lt;path&gt;</code></td><td>自动发现</td><td>显式指定二进制，覆盖发现顺序</td></tr>
<tr><td><code>--no-spa</code></td><td>—</td><td>只出多页站点，不注入 htmx</td></tr>
<tr><td><code>--theme &lt;t&gt;</code></td><td><code>auto</code></td><td><code>auto</code> / <code>light</code> / <code>dark</code>。<code>auto</code> <b>不输出任何属性</b>，让 <code>prefers-color-scheme</code> 决定——输出 <code>data-theme="auto"</code> 会成为样式表要处理的第三个状态，并把选择冻结在加载时刻</td></tr>
<tr><td><code>--clean</code> / <code>--force</code></td><td>关</td><td>删除输出目录 / 允许写入非空目录</td></tr>
<tr><td><code>--dry-run</code></td><td>关</td><td>校验并报告，不写盘</td></tr>
<tr><td><code>--verbose</code> / <code>--json</code></td><td>关</td><td>详细 stderr / 机器的 stdout 结果</td></tr>
<tr><td><code>-h</code> / <code>-v</code></td><td>—</td><td>帮助 / 版本</td></tr>
</table>

<h3>9.1 子命令 <code>serve</code></h3>

<ul>
<li><b>URL 打到 stdout</b>，因为它是命令的结果、是脚本可能要读的东西；其余全部走 stderr。</li>
<li>它是开发服务器：GET/HEAD 之外一律 405；<code>.xhtml</code> 以 <code>application/xhtml+xml</code> 送出；<b>不做目录列表</b>；未知路径返回 <code>404.html</code> 的<b>响应体</b>而 URL 不变（否则令牌协议无法测试）。</li>
<li>遍历防护在 <code>decodeURIComponent</code> <b>之后</b>判定，否则编码过的 <code>..</code> 会绕过。</li>
<li><b>即使对 HEAD 也设置 <code>content-length</code></b>：省略它会让浏览器报 <code>ERR_ABORTED</code>。</li>
<li>被要求停止的服务器是成功了，不是失败了：收到 SIGINT/SIGTERM 后返回 0。</li>
</ul>

<h3>9.2 退出码</h3>

<table>
<tr><th>码</th><th>含义</th></tr>
<tr><td><code>0</code></td><td>成功（含「警告并继续」的全部情形）</td></tr>
<tr><td><code>1</code></td><td>非预期的内部错误。见到这个就是缺陷</td></tr>
<tr><td><code>2</code></td><td>用法错误，或已记录的缺口（<code>--hosting rewrite</code>）</td></tr>
<tr><td><code>3</code></td><td>输入不是合法的 EPUB</td></tr>
<tr><td><code>4</code></td><td>与保留命名空间冲突，或输出目录非空</td></tr>
<tr><td><code>5</code></td><td>书中含加密内容</td></tr>
</table>

<p>未知选项是<b>用法错误</b>，不是被静默忽略。<code>parseArgs</code> 以 strict 模式运行：一个在 CI 脚本里写错、却仍然产出一个「成功」的、选项不对的构建——那是最坏的结果。</p>

<h3>9.3 库与 CLI 的分层</h3>

<p>库<b>从不</b>调用 <code>process.exit</code>，只设置 <code>process.exitCode</code>。<code>build()</code> 抛出带稳定 <code>code</code> 与 <code>exitCode</code> 的 <code>EpubSiteError</code>。<code>--verbose</code> 下打印栈<b>而不是</b>「消息 + 栈」：栈本身已含消息，两者都打就是把每件事说两遍——正是那种让人不再读 stderr 的噪音。</p>

<p><b>流纪律</b>：结果是 stdout，诊断是 stderr。因此 <code>epubsite book.epub &gt; result.json</code> 是安全的。</p>

---

<h2>10. 安全</h2>

<ul>
<li><b>章节内容以脚本禁用方式插入。</b>托管出来的书不能在读者的会话里执行任意代码。</li>
<li><b>zip 路径穿透</b>：最终防线委托给解包库（yauzl 的 <code>validateFileName</code>），并以测试钉住该行为，而不是再加一道永远跑不到的守卫。换解包库必须重新验证这两条断言。</li>
<li><b><code>selfRequestsOnly</code></b>：htmx 不被允许向站外发请求。</li>
<li><b>剪贴板失败要说出来</b>：剪贴板需要安全上下文与用户手势，两者在任何真实部署里都成立。一个看起来成功、实际什么都没复制的按钮，比一个承认失败的按钮更糟。</li>
</ul>

---

<h2>11. 无障碍与响应式</h2>

<h3>11.1 无障碍</h3>

<ul>
<li>侧边栏是带 <code>aria-label</code> 的 <code>&lt;nav&gt;</code>；当前章节用 <code>aria-current="page"</code>，由内容路径的<b>精确键比较</b>得出，而不是比较 href——后者要为需要百分号编码的文件名重建 URL，是一堆等着互相矛盾的边界情况。</li>
<li>跳过链接指向 <code>#epub-content</code>；SPA 模式下必须带壳文件名（§5.2）。</li>
<li>焦点在导航后移到 <code>#epub-content</code>，用 <code>preventScroll: true</code>：焦点移动是为了让键盘用户落到新内容上，不是为了滚动。</li>
<li>内容区 <code>aria-live="polite"</code>。</li>
<li>锚点用逻辑属性（<code>inset-inline-start</code>）以便 RTL 正确翻转；<code>translateX</code> 没有各浏览器都懂的逻辑等价物，这是唯一使用物理方向的地方，且已注明。</li>
<li>模态的关闭控件在所有宽度可见（§5.9）；<code>aria-expanded</code> 写字符串而非布尔（§5.11）。</li>
<li><b>符号控件必须自带可及名称。</b>搜索、分享、折叠、目录开关、首页都是画出来的符号而非文字，符号一律 <code>aria-hidden</code>，名称从控件自己的 <code>aria-label</code> 来——否则辅助技术只会读出一个「按钮」。目录开关原本写的就是「Contents」，改成符号之后那个词只剩 <code>aria-label</code> 一处容身之地；<code>aria-expanded</code> 与 <code>aria-controls</code> 不受影响（它们描述的是状态与从属关系，不是外观）。</li>
<li><b>壳里的外部链接是真正的锚点</b>，不是由运行期接管的控件。落地页的致谢行指向本项目仓库，带 <code>target="_blank"</code> 与 <code>rel="noopener noreferrer"</code>——跟随一条致谢不该让读者丢掉阅读位置——并按 §5.7 标 <code>hx-boost="false"</code>（§4.6）。链接文字就是项目名，因此可及名称本身是可读的，而不是一个「点这里」。</li>
</ul>

<h3>11.2 响应式</h3>

<p>断点 <code>40rem</code>。窄屏下 <code>#toc</code> 变成覆盖式抽屉，工具栏出现开关。<code>prefers-reduced-motion: reduce</code> 下取消抽屉过渡。</p>

<h3>11.3 布局不变量（I6 的可操作形式）</h3>

<p>这一节把 §5.10 的规则写成可检查的清单。任何一条被违反，都会以「读者报告页面看起来坏了」的形式回来。</p>

<ol>
<li>每条承载内容的网格轨道都声明 <code>minmax(0, …)</code>。<b>没有例外</b>，也不因为「这一级是隐式的」而豁免——隐式轨道正是 <code>auto</code>，正是缺陷所在。</li>
<li>每个滚动面板都有 <code>min-height: 0</code>。</li>
<li><code>html</code> 与 <code>body</code> 用 <code>overflow: clip</code>（<code>hidden</code> 不够）。</li>
<li><code>:root</code> 上 <code>overflow-wrap: break-word</code>。</li>
<li>需要同一个尺寸的两处规则，共用一个自定义属性，而不是各写一个数。</li>
<li>覆盖层不得盖住开关它的控件。</li>
</ol>

---

<h3>11.4 侧边栏折叠</h3>

<p>书的目录常常是一棵树，而且不短：一本技术书可以嵌套几百个条目，三层并列。全展开的侧边栏会变成读者<i>滚过去</i>的一面墙，而不是一张图。折叠分支是让一棵树变得可导航的方式。</p>

<table>
<tr><th>决定</th><th>理由</th></tr>
<tr><td>状态是 <code>&lt;li&gt;</code> 上的一个属性 <code>data-collapsed</code>，样式表据此隐藏嵌套的 <code>&lt;ol&gt;</code></td><td>三条推论，每条都是选它的理由：状态在重新渲染后仍在，因为它是标记而不是 JavaScript 对象；隐藏由 CSS 负责，所以 DOM 与视觉状态不会出现不一致的那一帧；<code>aria-expanded</code> 可以从同一个属性派生，而不是另行跟踪</td></tr>
<tr><td>折叠控件放在标签<b>之后</b></td><td>叶子条目渲染成一个裸 <code>&lt;a&gt;</code>；把按钮放在标签之前会让每个分支标题缩进，破坏侧边栏作为一列的对齐</td></tr>
<tr><td>状态<b>不持久化</b></td><td>折叠后刷新就恢复展开，与其它一切行为一致，也避免发明一个没人想过其生命周期的存储键</td></tr>
<tr><td>“全部折叠”是<b>开关</b>，并且只在目录确实有嵌套时才输出</td><td>只有一个方向的按钮在无东西可折时就是一个死控件——与 <code>--no-spa</code> 下不输出搜索按钮是同一条理由。符号按钮没有文字可改，所以它的可及名称必须跟着变，否则会宣称将做与事实相反的事</td></tr>
<tr><td>到达某章时<b>展开其所在分支</b></td><td>否则 <code>aria-current</code> 会标在读者看不见的地方，侧边栏就失去了它唯一的作用。代价是：读者主动折叠当前分支后再导航进去，它会被重新展开——这是应当偏向的一侧，看不见自己在哪比一节重新打开更糟</td></tr>
<tr><td>折叠控件只在 SPA 模式输出</td><td>没有运行期它就是一个什么都不做的控件，与分享、搜索按钮同一条理由（§5.8、§D.4）</td></tr>
</table>

<p><b>已知局限：</b>折叠状态不随章节切换保留到下一次进入（它属于当前文档）；<code>rotate(-90deg)</code> 是物理方向，RTL 下雪佛龙转向与 LTR 相同——纯外观问题，已注明而未解决。</p>

---

<h2>12. 边界情况</h2>

<table>
<tr><th>情形</th><th>处置</th></tr>
<tr><td>书占用保留命名空间</td><td>退出码 4。不通过改名或改布局绕开——零改写是硬约束</td></tr>
<tr><td>书里有 <code>index.html</code></td><td><b>让位</b>，不生成中转页。站点根访问落到书的那个文件上，这是正确的：它是书的一部分</td></tr>
<tr><td><code>META-INF/encryption.xml</code> 存在</td><td>退出码 5</td></tr>
<tr><td>固定版式（<code>pre-paginated</code>）</td><td>关闭 SPA，落地页说明原因，发 <code>W_PRE_PAGINATED</code></td></tr>
<tr><td>无导航文档</td><td>用 spine 合成目录，标签取 <code>&lt;title&gt;</code> 或 <code>&lt;h1&gt;</code>，否则 <code>Chapter N</code></td></tr>
<tr><td>标识符不可解析</td><td>取文本 SHA-256 前 16 位，发 <code>W_IDENTIFIER_UNPARSEABLE</code>，警告里写明「改文本即改身份」</td></tr>
<tr><td>书引用了站外资源</td><td>不失败。<b>报告</b>到诊断里（外部引用 / 越界链接分别列出），让作者知道什么会在离线或内网下失效</td></tr>
<tr><td>章节标题含不可断令牌</td><td>断行，见 I6</td></tr>
<tr><td>同一个以 <code>/</code> 开头的字符串，来源不同</td><td>清单 href 的 <code>/OEBPS/x.xhtml</code> 是合法容器根引用，<b>翻译</b>为条目路径；ZIP 条目名的 <code>/etc/passwd</code> 是 zip-slip，<b>拒绝</b>。共用一条「去掉前导斜杠」的路径会让 zip-slip 被静默洗白（E.7）</td></tr>
<tr><td>宿主机无法落盘的文件名</td><td>末尾空格、Windows 保留设备名。判定<b>不得依赖平台</b>（E.5）</td></tr>
<tr><td>RTL 书</td><td>只反转<b>呈现层</b>的侧边栏顺序；<code>readingOrder</code> 与 <code>position</code> 保持 spine 序（E.8）</td></tr>
<tr><td>搜索二进制找不到</td><td><code>W_SEARCH_UNAVAILABLE</code>，退出 0，站点完整（§D.3）</td></tr>
</table>

<h3>12.1 诊断码</h3>

<p>诊断<b>从不</b>导致失败（终止性错误走退出码，§9.2）。它们是「书里有东西我们处理不了，但站点仍然是完整正确的」这一类的统一出口。<b>这是完整清单</b>，因为它是用户可见的接口：脚本会 grep 它。</p>

<table>
<tr><th>码</th><th>含义</th></tr>
<tr><td><code>W_CONTAINER</code></td><td>ZIP 目录结构异常（缺 <code>mimetype</code>、条目顺序不标准等），但仍可解析</td></tr>
<tr><td><code>W_ENTRY_PATH</code></td><td>条目路径需要被整理（去前导斜杠、折叠 <code>.</code>/<code>..</code>）才落到磁盘上</td></tr>
<tr><td><code>W_EXTRA_ROOTFILE</code></td><td>站点根出现了一个既不在书里、也不是我们生成的顶层文件</td></tr>
<tr><td><code>W_HEAD_UNREADABLE</code></td><td>某章的 <code>&lt;head&gt;</code> 解析失败；该章仍然原样复制，只是它的样式槽位为空</td></tr>
<tr><td><code>W_IDENTIFIER_UNPARSEABLE</code></td><td><code>dc:identifier</code> 既非 URN/ISBN/UUID 也非 URL，身份由文本 SHA-256 前 16 位派生。<b>改文本即改身份</b>，警告里写明这一点</td></tr>
<tr><td><code>W_NAV_ABSENT</code> / <code>W_NAV_MISSING</code></td><td>书没有导航文档 / 导航文档存在但读不到。目录回退到 spine 合成</td></tr>
<tr><td><code>W_PRE_PAGINATED</code></td><td>固定版式书，SPA 关闭，落地页说明原因</td></tr>
<tr><td><code>W_SEARCH_UNAVAILABLE</code></td><td>找不到 Pagefind 二进制，未生成索引</td></tr>
<tr><td><code>W_SEARCH_DOWNLOADED</code></td><td>索引是通过 <code>npx --yes</code> 现取二进制完成的——记录它，因为这意味着构建依赖了网络</td></tr>
<tr><td><code>W_SEARCH_PATH_MISSING</code></td><td><code>--pagefind</code> 指的文件不存在</td></tr>
<tr><td><code>W_SEARCH_NO_DOCUMENTS</code></td><td>索引建起来了，但一页都没收到</td></tr>
<tr><td><code>W_SEARCH_FAILED</code></td><td>Pagefind 以非零码退出，附带首行输出</td></tr>
<tr><td><code>W_SEARCH_GLOB_FALLBACK</code></td><td>书大到索引范围模式串不合理，退化为递归 glob（§4.9）</td></tr>
</table>

<p>此外，外部引用与越界链接是<b>逐章</b>报告的结构化条目（不是警告码），让作者知道什么会在离线或内网下失效。它们按固定顺序排序并去重，理由是 C.5 的顺序纪律：让 diff 可读。</p>

<h2>13. 测试</h2>

<h3>13.1 四条探测线</h3>

<p>设计依赖若干会在<b>静默</b>中失效的前提——基准移动了、不该发的请求发出去了、不该执行的脚本跑了——每一条都有一个清晰的观测点，前提一破就变红。这四条是验收的骨架：</p>

<table>
<tr><th>#</th><th>断言</th></tr>
<tr><td>T1</td><td>排除保留命名空间后，产物条目路径集合 = 源 EPUB 中央目录路径集合，且每个文件<b>字节长度相同</b>（G2）</td></tr>
<tr><td>T2</td><td>导航前后侧边栏 DOM 节点引用不变（G3、I5）</td></tr>
<tr><td>T3</td><td>端到端<b>零 4xx</b>（G4）。令牌请求本身除外——那是机制，不是缺陷</td></tr>
<tr><td>T4</td><td>令牌 URL 打开后带侧边栏（G5）</td></tr>
</table>

<p><b>T1 只用长度，不用逐字节比对</b>（E.1）：逐字节既脆弱又昂贵，而它想防的事故——截断、重编码、遗漏文件、凭空多出文件——全部表现为路径集合或长度异常。保留长度就保住了全部探测能力。</p>

<p><b>不写「两次构建字节一致」这类断言</b>（E.2）：跨运行字节级可复现想买到的只是审阅便利，而我们保留的是一组<b>顺序纪律</b>（显式排序、按 spine 序号回填、不把构建机绝对路径写进产物），目的是让 diff 可读，而不是让哈希相等。</p>

<h3>13.2 端到端用例</h3>

<p>站点由真实库构建、由真实 <code>serve</code> 服务，因此被测的是用户拿到的产物，不是它的替身。服务器不是可选项：令牌协议<i>就是</i>自定义 404 语义，一个用自家错误页回答未知路径的服务器会让整条入口链无法测试。</p>

<p>布局类缺陷<b>各有独立探测器</b>，因为每个症状就是读者会报告的那句话。一句「布局正常」会在变红时不说清是哪一条回来了。当前覆盖：</p>

<ul>
<li>章节在自身面板内滚动，而不是把页面撑长</li>
<li>长章节滚到底不会把工具栏推走</li>
<li>侧边栏保留自己的滚动条；两面板滚动互不影响</li>
<li>两个面板都不横向滚动，即使存在 CSS 无法在空格处断开的令牌</li>
<li>章节面板永不超出视口，右边距因此存活</li>
<li>抽屉能被同一个开关关掉；抽屉打开时整个工具栏仍可命中</li>
<li>检索模态在每个宽度都有可见的关闭控件，且点击确实关闭</li>
<li>favicon 在文档 URL 移动后仍能被取到</li>
</ul>

<p>行为类探测器另有四个，都不看几何：<b>首页控件</b>回到落地页时不重载文档（窗口上的标记证明文档未被替换）且只交换内容面板（侧边栏节点引用不变，证明没有把整份壳套进面板）；<b>落地页的 canonical</b> 在进入章节后消失，并在「后退」与首页这两条返回路径上<b>都</b>恢复——只覆盖前进方向的实现会在这里变红；<b>工具栏的每个符号控件</b>都有 <code>aria-label</code> 且自身没有文字；<b>致谢链接真正可用</b>——点击后新标签页落在仓库地址上（用 context 级路由桩住 github.com，测试不碰真实网络），并对照断言它在章节打开后消失。最后一条值得说明为什么不用断言属性代替：一个被 boost 吃掉的跨源链接<b>看起来与能用的链接完全一样</b>，只有点下去才知道（§5.7）。</p>

<h3>13.3 单元测试</h3>

<p>纯函数优先：路径与令牌变换（双射性质）、选项校验、导航 href 四条规则、<code>@import</code> 切分、诊断排序与去重、标识符归一化、搜索 glob 生成。</p>

<h3>13.4 测试方法论：三条纪律</h3>

<p>这三条都是被实际浪费掉的时间换来的。</p>

<table>
<tr><th>纪律</th><th>为什么</th></tr>
<tr><td><b>失败的断言先确认它复现了，再动手修</b></td><td>曾把一个未复现的失败断言改成 <code>fixme</code>，于是它停止了测试——而它本来就是对的。把失败断言改成 <code>fixme</code>，等于删掉它</td></tr>
<tr><td><b>断言要通过的手段，不是碰巧的结果</b></td><td>一个「滚到底能看到最后一段」的断言在布局全坏时也会通过，因为 <code>overflow: hidden</code> 的 <code>body</code> 仍然可以被程序化滚动。它测的不是布局，是运气</td></tr>
<tr><td><b>「可点击」要用命中测试断言</b></td><td><code>toBeVisible()</code> 在被覆盖的按钮上照样通过。命中测试才是浏览器回答「读者点下去会发生什么」的方式</td></tr>
</table>

---

<h2>14. 实施阶段</h2>

<p>P0–P8 全部完成并通过验证（§1.4）。此后附录 F.10、F.11、F.12 三处就地修订落地，全量验证：类型检查、lint 干净，单元 + 集成 <b>18 个文件 / 336 个测试</b>，端到端 <b>53 个</b>（52 通过，另 1 个是 I1 探针里按设计跳过的 <code>fixme</code>，真实 Chrome）。</p>

<table>
<tr><th>阶段</th><th>内容</th></tr>
<tr><td>P0</td><td>脚手架 + I1 探针门槛</td></tr>
<tr><td>P1</td><td>构建核心：ZIP、容器、OPF、抽取、零改写校验、裸多页壳</td></tr>
<tr><td>P2</td><td>导航提取 + SPA 壳（htmx、抽屉、级联层）</td></tr>
<tr><td>P3</td><td><code>&lt;head&gt;</code> 槽位 + <code>shell-data.json</code></td></tr>
<tr><td>P4</td><td>令牌协议 + 404 引导 + 入口 + 分享</td></tr>
<tr><td>P5</td><td>结构化数据（JSON-LD + 清单）</td></tr>
<tr><td>P6</td><td><code>serve</code> + 端到端套件</td></tr>
<tr><td>P7</td><td>固定版式自动降级、<code>--theme</code>、引用审计、URL 标识符</td></tr>
<tr><td>P8</td><td><code>--search</code>（构建 + 运行期）</td></tr>
</table>

---

<h2>附录 A · <code>publication.json</code> 与 <code>shell-data.json</code></h2>

<h3>A.1 <code>publication.json</code>（站点根，面向外部）</h3>

<p>符合 W3C Publication Manifest REC 的<b>扁平</b>结构（E.6）：</p>

<ul>
<li>没有嵌套的 <code>metadata</code>；<code>@context</code> 是<b>二元数组</b> <code>["https://schema.org", "https://www.w3.org/ns/pub-context"]</code>；<code>conformsTo</code> 必需；结构性 <code>rel</code>（<code>contents</code> 等）<b>不得</b>出现在 <code>links</code> 里。</li>
<li><code>readingOrder</code> 只含 spine 的 <code>linear</code> 项；非线性的（含导航文档）进 <code>resources</code> 并带 <code>rel="contents"</code>（E.11）。</li>
<li><b><code>--json-ld</code> 不影响它</b>：那个开关管的是 <code>&lt;script&gt;</code> 块，不是清单的描述属性。</li>
</ul>

<p>v1.1 的示例与它自己引用的规范相矛盾：照 v1.1 写出的清单<b>过不了校验</b>。</p>

<h3>A.2 <code>_epubsite_assets/shell-data.json</code>（壳专用）</h3>

<p>启动时一次拉取，含每章的路径、标题、<code>body</code> 属性、样式引用与章节 JSON-LD。<b>不含</b>书籍节点（E.12）：它已经是壳 <code>&lt;head&gt;</code> 里的静态内容，而 <code>syncJsonLd</code> 只处理章节节点，书籍那块不带 <code>data-epub-ld</code>、永远不会被移除。再拷一份到启动时拉取的文件里，是为一个不存在的读者重复最大的一块数据。</p>

---

<h2>附录 B · 关键流程图汇总</h2>

<h3>B.1 运行期导航</h3>

<pre><code>点击书内链接
  → htmx boost 拦截
  → 同章节片段？ → 我们自己执行跳转，不请求（§5.7）
  → XHR 取章节
  → pushState(章节真实 URL)        ← 必须在 swap 之前（I1）
  → swap #epub-content（innerHTML show:top）
  → syncChapter：样式 / body 属性 / 侧边栏高亮 / 标题（§5.4）</code></pre>

<h3>B.2 令牌入口</h3>

<pre><code>GET /OEBPS/text/@ch03.xhtml
  → 404（响应体 = 引导页）
  → 探测 .epubsite-root 定位站点根
  → epubsite.html?p=%2FOEBPS%2Ftext%2Fch03.xhtml
  → replaceState 到真实路径
  → 加载章节，侧边栏就位</code></pre>

<h3>B.3 站点根入口</h3>

<pre><code>GET /
  → index.html（中转页）
  → 跳转 epubsite.html，不留在历史记录里（§8.3 约束 4）</code></pre>

<h3>B.4 站点根来源与可移植性（I4）</h3>

<pre><code>壳：位置已知 → SITE_ROOT = 自身目录（启动时冻结）
引导页：位置未知 → 向上探测 .epubsite-root
两者共同构成「换域名/换子路径无需重新构建」</code></pre>

---

<h2>附录 C · 实现细节与依赖选型</h2>

<h3>C.1 模块划分与依赖边界</h3>

<table>
<tr><th>路径</th><th>可用</th><th>由 lint 强制</th></tr>
<tr><td><code>src/shared/</code></td><td>什么都不行——无 import，无 <code>node:</code></td><td>是</td></tr>
<tr><td><code>src/build/</code></td><td>Node。永不碰 DOM</td><td>是</td></tr>
<tr><td><code>src/runtime/</code></td><td>DOM。永不碰 Node</td><td>是</td></tr>
</table>

<p><code>src/shared/</code> 同时被构建期与运行期引用（路径常量、令牌变换），所以它必须是零依赖的——它是两侧唯一共享的词汇表，两边对它的理解不可能不一致。</p>

<h3>C.2 依赖选型</h3>

<table>
<tr><th>依赖</th><th>角色</th></tr>
<tr><td><code>yauzl</code></td><td>唯一被信任做 ZIP 解析的库。手写 ZIP 解析是安全面，不是节省面</td></tr>
<tr><td><code>htmlparser2</code></td><td>解析 OPF / nav / NCX / 章节 <code>&lt;head&gt;</code>。不用完整 DOM：构建期不需要，而它把攻击面与内存占用都放大一个数量级</td></tr>
<tr><td><code>htmx</code></td><td>vendored 到 <code>_epubsite_assets/htmx.esm.js</code>，<b>不</b>从 CDN 取。上游 2.0.10 不发布压缩过的 ESM 构建，所以文件名就是上游真实的那个，不再自己压一份名字对不上的产物（E.3）</td></tr>
<tr><td><code>Pagefind</code></td><td><b>不是依赖</b>，只是被发现的外部工具（§4.9）</td></tr>
</table>

<h3>C.3 程序化 API 与 CLI 调用约定</h3>

<p><code>build()</code> 接受部分选项，未给的取默认值；抛出 <code>EpubSiteError</code>。<code>parseArgs</code> 严格模式。<code>serve</code> 作为位置参数识别，不引入子命令框架：多一个关键字不值得一个依赖，而框架会接管帮助文本，那份文本最终还是得手工跟规范对齐。</p>

<h3>C.4 运行期代码的产出方式</h3>

<p>四个 tsup 入口：<code>bin/epubsite</code>（Node，shebang）、<code>index</code>（库，含 dts）、<code>runtime/shell</code>（浏览器 ESM）、<code>runtime/token-iife</code>（浏览器 IIFE，压缩，内联进 404 引导）。</p>

<p>令牌 IIFE 是刻意的：引导页必须在构建站点时就能内联一段脚本，而不需要 esbuild。IIFE 的产物名要显式压制 tsup 的 <code>.global.js</code> 后缀。</p>

<p><code>shell.css</code> 与 <code>icon.svg</code> 由一段拷贝脚本放进 <code>build/runtime/</code>，构建期用 <code>runtimeAsset()</code> 定位。<b>资产定位靠 <code>import.meta.dirname</code> 而不是 <code>process.cwd()</code></b>：整个 <code>--out ./dist</code> 的意义就是 cwd 属于<i>调用者</i>，用它定位我们自己的资产会「在本仓库里能用、在别处全坏」。向上搜 <code>package.json</code> 而不是数 <code>..</code> 的层数——数层数是那种一加第三个入口就静默失效的算术。</p>

<h3>C.5 确定性与 diff 稳定性</h3>

<p>不承诺跨运行字节一致（E.2）。承诺的是一组顺序纪律：显式排序、按 spine 序号回填、不把构建机绝对路径写进产物。目标是<b>diff 可读</b>。</p>

<h3>C.6 两处规范补漏</h3>

<h4>C.6.1 <code>--base-url</code> 路径形态的后果</h4>

<p>路径形态会被校验但<b>对产物不产生任何影响</b>。它是「站点住哪」的声明，而所有引用也都是相对或站点根相对的。唯一消费它的是 <code>rewrite</code> 模式的托管规则生成，而那个模式尚未实现。这个连带后果必须写明，否则「我设了 <code>--base-url</code> 却什么都没变」会被当成缺陷。</p>

<h4>C.6.2 <code>--name</code> 与 <code>index.html</code></h4>

<p><code>--name</code> 不得为 <code>index.html</code>：中转页的职责是「跳到壳」，而壳自己占了那个位置时两者冲突。这是<b>用法错误</b>，退出码 2，而不是让构建去猜。</p>

<h3>C.7 为什么清单拆成两份</h3>

<p><code>publication.json</code> 面向外部消费者，遵循标准；<code>shell-data.json</code> 面向壳自己，可以随实现演化。<b>把两者合一</b>的代价是：壳的每个内部细节都变成公开契约，或者标准产物被内部需求污染。两份的代价是一次重复的小数据（章节路径与标题），而这个重复是<b>可被测试钉住的</b>——断言两份对同一章节的路径一致即可。</p>

---

<h2>附录 D · 搜索</h2>

<h3>D.1 为什么是 Pagefind</h3>

<p>它索引<b>已构建的静态文件</b>，不需要服务器、不需要在页面里嵌运行时索引，且把索引切片成按需加载的小块。这正是静态产物的形状。</p>

<h3>D.2 三个会静默失败的坑</h3>

<table>
<tr><th>坑</th><th>后果</th></tr>
<tr><td><b><code>data-pagefind-body</code> 是全站开关</b></td><td>它有「只有标了这个属性的元素才被索引」的语义。标在壳上，索引里就只剩壳——而站点看起来完全正常，只是搜不到东西</td></tr>
<tr><td><b>默认 glob 会索引站点自身的页面</b></td><td>壳、中转页、404 引导都是 HTML，都在同一棵树里。默认递归 glob 会把它们全部收进去，于是搜索「关于这本书的文档」</td></tr>
<tr><td><b>索引构建必须排在最后</b></td><td>它索引的是产物；此后写入的任何文件对它都不可见</td></tr>
</table>

<h3>D.3 构建期集成</h3>

<p>见 §4.9。<b>失败是警告，退出码 0</b>。没有索引时按钮仍然输出并在按下时报告失败：一个点了没反应的按钮，比一个说明「索引没生成」的提示更糟。</p>

<h3>D.4 运行期</h3>

<p>见 §5.9。</p>

<h3>D.5 验收</h3>

<ul>
<li>构建后在 <code>_epubsite_assets/pagefind/</code> 下存在索引与组件包</li>
<li><code>pagefind-entry.json</code> 的 <code>page_count</code> ≤ spine 项数——这证明默认 glob 没被使用</li>
<li>壳里有搜索控件；<code>--no-spa</code> 下没有（没有运行期去驱动它）</li>
<li>在真实浏览器里：查询有结果、命中被高亮、点击结果<b>留在阅读器里</b>（侧边栏仍在、模态已关、<code>aria-current</code> 已设、URL 是章节的真实路径）</li>
<li>关闭控件在每个宽度都可见且可用</li>
<li>二进制不可用时：警告、退出 0、站点完整</li>
</ul>

<h3>D.6 已知局限</h3>

<ul>
<li>索引体积随书线性增长，没有对超大书的裁剪策略。</li>
<li>词干化与停用词由 Pagefind 决定，我们不干预。</li>
<li>搜索结果只按 Pagefind 的相关性排序，不考虑书本身的阅读顺序。</li>
</ul>

---

<h2>附录 E · 相对 v1.1 的修订记录（v1.2）</h2>

<p>v1.1 与 v1.2 均已冻结。以下逐条保留<b>为什么改</b>，因为每一条都是实现过程中被事实推翻的假设，而不是风格偏好。其内容<b>已并入</b> v1.3 正文，此处保留编号供追溯。</p>

<table>
<tr><th>#</th><th>修订</th><th>理由</th></tr>
<tr><td>E.1</td><td>G2 不再要求逐字节一致，改为路径集合 + 字节长度等价</td><td>见 §13.1</td></tr>
<tr><td>E.2</td><td>放弃跨运行字节级可复现承诺</td><td>见 §13.1、C.5</td></tr>
<tr><td>E.3</td><td><code>htmx.esm.min.js</code> → <code>htmx.esm.js</code></td><td>上游不发布压缩过的 ESM 构建。规范原本指着一个不存在的文件</td></tr>
<tr><td>E.4</td><td><code>.epubsite-root</code> 纳入保留命名空间</td><td>见 §3.2</td></tr>
<tr><td>E.5</td><td>新增宿主机约束与条目名来源的区别</td><td>见 §4.2、§12</td></tr>
<tr><td>E.6</td><td><code>publication.json</code> 改为 W3C REC 扁平结构</td><td>见 A.1</td></tr>
<tr><td>E.7</td><td>同一个以 <code>/</code> 开头的字符串，来源不同处置相反</td><td>见 §12</td></tr>
<tr><td>E.8</td><td>RTL 的「反转」明确为呈现层职责</td><td>见 §4.3</td></tr>
<tr><td>E.9</td><td><b>永久移除 <code>--book-dir</code></b></td><td>见 §1.2</td></tr>
<tr><td>E.10</td><td>移除 <code>numberOfPages</code> 与 <code>pagination</code></td><td>见 §1.2、§7.2</td></tr>
<tr><td>E.11</td><td>清单 <code>readingOrder</code> 只收 <code>linear</code> 项；<code>isPartOf</code> 改为单节点</td><td>见 §7.5</td></tr>
<tr><td>E.12</td><td><code>shell-data.json</code> 不再重复书籍节点</td><td>见 A.2</td></tr>
</table>

---

<h2>附录 F · 相对 v1.2 的修订记录（v1.3）</h2>

<p>E 记的是「被事实推翻的假设」，F 记的是「v1.2 根本没说、而实现中我们必须回答的问题」。后者的主体是一类此前完全没有被规范覆盖的东西：<b>布局</b>。</p>

<table>
<tr><th>#</th><th>修订</th><th>理由</th></tr>
<tr><td>F.1</td><td><b>新增 I6：文档永不滚动，滚动是面板各自的职责</b>（§2、§5.10、§11.3）</td><td>v1.2 通篇没有一句关于布局的话，而实现中四个独立缺陷全部源自同一条被忽略的 CSS 规则：<code>1fr</code> 轨道的下限是<b>内容</b>而非 0。同一类错误在四处各犯一次（<code>body</code> 的行、<code>body</code> 的列、<code>#frame</code> 的列、窄屏的列），其中最后一次的元凶是工具栏里不换行的 flex 项。规则本身是抽象的（「每条承载内容的轨道都声明 <code>minmax(0, …)</code>」），而它的四个实例是具体的，因此两者都写进规范</td></tr>
<tr><td>F.2</td><td><b>新增 I7：第三方组件的内部状态由其 API 独占</b>（§2、§5.9）</td><td>直接对 Pagefind 模态内部的 <code>&lt;dialog&gt;</code> 调 <code>showModal()</code>，会打开对话框却让组件的 <code>_isOpen</code> 仍为 <code>false</code>，于是<b>组件自己渲染的关闭按钮点击后毫无反应</b>。这不是配置错误，是绕过封装的必然结果：组件用它自己的状态推断该做什么，我们让那个状态说了谎</td></tr>
<tr><td>F.3</td><td><b>新增 I2 的适用范围</b>：凡会被「重新解析」的壳 URL 都算（§2.2、§5.3）</td><td>I2 原先读起来像「链接要绝对化」。favicon 是反例：它不是链接、没人点它，但浏览器在文档 URL 变化后会按当前基准<b>重新解析</b>它的 <code>href</code>，于是相对写法在导航后请求 <code>/OEBPS/text/_epubsite_assets/icon.svg</code> 而 404——并且静默，因为 favicon 404 只表现为图标不显示。规则按「会不会重解析」判，样式表因此被正当地豁免</td></tr>
<tr><td>F.4</td><td><b>新增 §5.11 窄屏抽屉</b>，含不变量「覆盖层不得盖住开关它的控件」</td><td>抽屉原本占满视口高度，打开即盖住打开它的按钮，唯一出路是刷新。修法是几何的（抽屉从工具栏下方开始）而不是加一个关闭按钮：一个控件、一个布尔量，不可能互相矛盾。连带的构造要求是工具栏高度由一个令牌精确决定（§5.10）</td></tr>
<tr><td>F.5</td><td><b>新增 §5.9 检索运行期</b>与 §1.4 实现状态</td><td>v1.2 的附录 D 写到「运行期」就停在方案层面，没有记录模态归属、关闭控件的宽度策略、以及结果点击必须拦截这三件实现中确定下来的事</td></tr>
<tr><td>F.6</td><td><b>G8 从「可选」改为目标</b>；<code>--search</code> 与 <code>icon.svg</code> 进入产物结构（§3.1、§3.2、§9）</td><td>搜索已实现，而图标是壳的固有组成部分——它在 <code>--no-spa</code> 下也存在（那是唯一与样式表一起发布的资产）。两者此前不在规范里</td></tr>
<tr><td>F.7</td><td><b>新增 §13.4 测试方法论</b></td><td>三条纪律各由一次实际浪费换来：把未复现的失败断言改成 <code>fixme</code>（等于删掉它）、写了在布局全坏时也会通过的断言（因为 <code>overflow: hidden</code> 的 body 仍可被程序化滚动）、用 <code>toBeVisible()</code> 断言一个被覆盖的按钮「可用」。这些不是风格偏好，是错误答案的具体形状</td></tr>
<tr><td>F.8</td><td>术语表补入「面板」「不可断令牌」「降级」；§1.2 补入「不为内容重新排版」及其唯一例外</td><td>I6 要求断行，而断行是壳对书内容的唯一一处呈现干预。不写明例外，§1.2 的承诺就会与 §5.10 的实施相矛盾</td></tr>
<tr><td>F.9</td><td><b>章节 <code>url</code> 改为数组，运行期并入真实地址与令牌地址</b>（§5.8、§7.3、§7.5、§8.5、§9）</td><td>v1.2 与 v1.3 都写了「令牌路径在整个系统里的唯一用途是剪贴板」。这条断言被一个具体需求推翻：只给真实地址时，抓取器要么索引裸页面（可读，但没有阅读器），要么根本看不到章节节点。列两个地址等于说「这一章在这两个地址都能到达」，这是真的。它要求把两句话分开——canonical（仍否决）与 <code>url</code> 列表项（采纳）——并要求运行期承担这个字段，因为「站点此刻被打在哪个源下」构建期无从得知（G7）。顺带修掉一处构造缺陷：构建期写 <code>url</code> 时直接用 zip 里的条目名，含空格的书会写出一个带空格的「URL」，而运行期写的是浏览器形态；同一个地址两种拼法使「已有则跳过」失效，地址被列两遍。改法是构建期按 URL 规则编码，运行期按规范形态比较。<b>这也是首次出现「必须原地改写既有章节」的情况，理由记在文首</b></td></tr>
<tr><td>F.10</td><td><b>canonical 只属于落地页：进入章节时移除，回到落地页时恢复</b>（§4.6、§5.4、§5.6、§7.5、§8.5、§9）</td><td>canonical 此前是壳 <code>&lt;head&gt;</code> 里的静态标签，因此在阅读器里<b>永远</b>存在——而它断言的是「本文档住在这里」。读者进入章节之后这句话是假的，且是后果最重的一句假话：它告诉爬虫每一章都是落地页的副本。修法不是在构建期少写一个标签（那样落地页也失去了它），而是承认它是一个<b>槽位</b>：由 §5.4 的同一个同步切换，标签带 <code>data-epub-canonical</code> 让运行期找得到它。恢复时保留<b>原节点</b>并插回它当时的前一个后继兄弟之前，而不是重新创建后追加——否则 <code>&lt;head&gt;</code> 的结构会随运行期槽位的增减而漂移。<b>章节不写 canonical，连真实地址也不写</b>：读者是壳，替章节声明它住哪里不是它该做的事。同时删去一处从未兑现的旧陈述：<code>og:image</code> 从来没有被实现过</td></tr>
<tr><td>F.11</td><td><b>工具栏新增「首页」控件，目录开关改为符号</b>（§5.1、§5.7、§5.11、§11.1）</td><td>两点合成一条，因为它们是同一个问题：工具栏此前没有任何回到落地页的路径（只能按「后退」），而那个唯一带文字的控件恰好在最窄的屏幕上最重要。首页控件是<b>链接</b>而不是按钮——它是导航，中键与新标签页都该照常工作——因此靠两个属性成立：<code>data-shell</code> 让它在 <code>pushState</code> 之后仍指向站点根，<code>hx-select="#epub-content &gt; *"</code> 让「请求壳」变成「把面板内容换成落地页」。后者是承重的：增强导航请求回来的是一整份壳，而 htmx 的 <code>hx-select</code> 交出的是<b>匹配到的节点本身</b>，选中 <code>#epub-content</code> 会把面板套进它自己（重复 id、两个侧边栏）。目录开关去掉文字之后可及名称只剩 <code>aria-label</code>；连带的样式陷阱也记进 §5.11：符号控件的样式组是两个 id 宽，<code>#toc-toggle</code> 的显隐规则若仍写一个 id 就会输给它，开关将在所有宽屏下现形</td></tr>
<tr><td>F.12</td><td><b>落地页末尾加入对本项目的致谢行</b>（§4.6、§5.1、§11.1、§13.2）</td><td>它写在 <code>#epub-content</code> 里面，因此<b>只属于落地页</b>：章节打开时面板被整体替换，致谢随之消失，首页控件把落地页换回来时它一并回来；深链入口从未显示它。这是刻意选的，不是将就——把致谢固定在视口底部（<code>#frame</code> 的第三行）会让 §5.10 那句「每条承载内容的网格轨道都声明 <code>minmax(0, …)</code>」自相矛盾，因为工具栏那一行本来就已经是 <code>auto</code>；那意味着额外一次措辞收紧与一组布局探测器的重新标定，换一行代码不值得。链接是真正的锚点：<code>target="_blank"</code> 配 <code>rel="noopener noreferrer"</code>，并按 §5.7 标 <code>hx-boost="false"</code>。实测 htmx 本来也不会接管它——<code>isLocalLink</code> 比较主机名，且 <code>boostElement</code> 要求 <code>target</code> 为空或 <code>_self</code>——但把结论写出来比让它靠推断成立更好。验收用<b>真点击</b>（context 级路由桩住 github.com，断言弹窗落在仓库地址），因为被 boost 吃掉的跨源链接与能用的链接看起来完全一样。URL 是渲染器里的一个常量，不从 <code>package.json</code> 读：<code>render/</code> 不碰文件系统，<code>readPackageVersion()</code> 保持 CLI 专属。同一条决定下<b>没有</b>提供关闭开关，若出版商日后要求，再加 <code>--no-credit</code> 并记进未决项</td></tr>
</table>

<h3>F.13 未决项</h3>

<table>
<tr><th>项</th><th>状态</th></tr>
<tr><td><code>--hosting rewrite</code> / <code>all</code></td><td>按约定<b>不实现</b>，源码留报错桩（退出码 2），桩的注释里写明完整契约。连带后果见 §4.8、C.6.1</td></tr>
<tr><td>CLI 暴露 <code>--host</code></td><td><code>startServer</code> 支持 <code>host</code>，<code>args.ts</code> 的选项表里没有它。<b>缺口</b>：命令行传 <code>--host</code> 会报用法错误。修法很小（选项表加一项），但既然 §9 的选项表是契约，就得先决定它是否应该在契约里</td></tr>
<tr><td>书的代码块设了 <code>white-space: pre</code> 时</td><td>长行仍会产生横向滚动条。当前有意不动它：那需要把书的内容改成 <code>pre-wrap</code>，属于 §1.2 所限制的呈现干预，而「一条被包住的滚动条」是可接受的代价。<b>若要改，是一行</b>，但应当是明确的产品决定而非默认行为</td></tr>
<tr><td>路径穿透的最终防线归属</td><td>委托给解包库（yauzl 的 <code>validateFileName</code>），以测试钉住而非再加一道永远跑不到的守卫。换解包库必须重新验证这两条断言</td></tr>
<tr><td>搜索索引规模</td><td>无裁剪策略（D.6）。对超大书，索引体积随正文线性增长</td></tr>
</table>

<div align="center">
<sub>规范结束 · v1.3</sub>
</div>
