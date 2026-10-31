# 改动说明与提交方案 / Contribution Notes

> 针对 `dev` 分支（`42a706f`，2026-10-04）的本地改动，供维护者评审。
> 整理时间：2026-10-31
>
> 这份文档不是 PR 本身，而是「每个改动想解决什么、为什么这么改、验证到什么程度」的说明。
> 每一条都可以独立评审、独立采纳、独立放弃。

---

## 一、关于 AI 辅助的说明

这套改动是在 AI 辅助下完成的，分工如下，供你判断可信度：

| 环节 | 谁做的 |
|---|---|
| 读现有实现、定位根因、写补丁初稿 | AI（对话式，逐文件改） |
| 逐行审查每处改动是否成立 | 人工，26 个文件全部过了一遍 |
| 判断哪些符合项目既有设计口径 | 人工（对照 `SearchPage` 已有的 atom 方案） |
| 实测复现与验证 | 人工，在本地真实音乐库上操作 |
| 剔除不该进上游的部分 | 人工（见第四节） |

交付前已通过项目自身的检查链：

```
node node_modules/eslint/bin/eslint.js ./src   → 0 error
node node_modules/prettier/bin/prettier.cjs --check <改动文件>  → 全部符合
node node_modules/typescript/bin/tsc --noEmit  → 0 error
electron-forge package                         → 打包成功、产物可运行
```

**不要求照单全收。** 任何一条觉得不合适、或者和你正在做的重构冲突，直接丢掉就行，不需要解释。

---

## 二、改动一览

| # | 类型 | 内容 | 文件数 |
|---|---|---|---|
| 1 | `fix` | 搜索页的音乐结果无法 Shift 多选 / Ctrl+A 全选 | 2 |
| 2 | `fix` | 列表底部反复请求，表现为「抽搐 / 闪烁」，且状态提示不显示 | 8 |
| 3 | `feat` | 切页 / 返回后 tab、滚动位置、插件选择被重置 | 13 |
| 4 | `fix` | 底部提示文字在浅色主题下不可见 | 3 |

合计 26 个文件，723 行新增 / 121 行删除，约占全项目代码量的 1.5%。

**未改动**：`src/infra/**`、`src/main/**`、路由表、i18n 词条、组件库公共 API（仅新增可选 prop）。
**无**数据结构变更、无 IndexedDB/数据库迁移、无新增依赖。

---

## 三、逐条方案

### 1. 搜索页音乐结果无法多选

**现象**
本地音乐、排行榜、热门歌单里，点一行再按 `Shift` 点另一行能范围选中，`Ctrl+A` 能全选。但在搜索页的音乐结果里完全没反应。

**根因**
`SongTable` 的 `enableSelection` 默认值是 `false`。本地音乐、榜单、歌单这几个调用点都显式传了 `enableSelection`，而 `SearchPage/components/MusicResult.tsx` 没传 —— 同一个组件，两套行为。

另外三个选区生命周期问题是顺带发现的，都会让「选中」这件事变得不可预期：

1. **切页不清空**。`AlbumPage` 从专辑 A 跳到专辑 B 时，React 复用同一个组件实例，`selectedIds` 跟着残留到新专辑上，用户看到的是「新列表里莫名其妙有几行是选中的」。
2. **数据收敛后残留**。搜索词变了、或列表里某些项被移除后，被选中的 id 已经不在 `data` 里，但仍在 `selectedIds` 里，后续批量操作会作用到看不见的项。
3. **没有"取消选择"的出口**。只有点击行才能改选区，点空白处不会退出。

**方案**

- `SongTable` 的 `enableSelection` 默认值改为 `true`（13 个调用点统一受益）；搜索页的音乐结果接入项目已有的 `useSelection`（`LocalMusicPage/hooks/useSelection`），用 `[pluginHash, query]` 作为清空依赖 —— 换插件或换关键词清空，加载更多不清空。
- `SongTable` 内部补三条生命周期规则：
  - `pathname` 变化 → 清空（覆盖"专辑 A → 专辑 B"这类同组件换参数）；
  - `data` 变化 → 用 id 交集裁剪，只保留仍然存在的；
  - 容器 `onMouseDown` 且 `!target.closest('tr')` → 清空（点空白处放弃选择，不与工具栏按钮冲突）。

**影响面**
`enableSelection` 默认值变化只影响没显式传该 prop 的调用点（即搜索页）。其余页面的行为不变。

---

### 2. 列表底部反复请求（抽搐 / 闪烁）

这是花时间最多的一条。**三个独立原因叠加**，只修一个看起来都没效果。

**现象**
搜索某歌手，结果只有一页（十来条），不滚动、不做任何操作，底部就自己反复闪「加载中…→ 点击重试→ 加载中…」。控制台（开发模式）能看到 `endReached` 被连续触发。

**根因 A：`endReached` 闸门只看状态，不看数据**
`SongTable.handleEndReached` 原来只挡 `Pending`：

```ts
if (loadMoreStatusRef.current === RequestStatus.Pending) return;
```

但 Virtuoso 在**内容不足以填满视口**时会认为视口一直停在底部，每次渲染后都报一次 `endReached`。请求成功后状态回到 `Idle`，闸门重新打开 → 又请求一次 → 又成功 → 再请求，形成空转。`MediaGrid`（卡片网格）和 `ArtistResult` 的 `IntersectionObserver` 是同一个毛病：`observer` 的依赖数组里带了 `loadMoreStatus` / `onLoadMore`，状态一变就重建 observer，`observe()` 会立刻再回调一次，等于自己踢自己一脚。

**根因 B：底部状态读的是 ref，不触发重渲染**
`ListFooter` 是通过 Virtuoso 的 `components` 注入的，父组件重渲染不会带着它一起更新。而它拿的状态来自 `loadMoreStatusRef.current` —— ref 改了不触发渲染，所以界面会**停在第一次拿到的那个值**上。表现就是：要么永远显示「点击重试」，要么永远不显示「没有更多了」。这也是之前反馈"看不到加载中/到底提示"的直接原因。

**根因 C：`isEnd` 完全信任插件**
`useSearch` 原来只认插件返回的 `isEnd`。有的音源翻页失效，会一直回 `isEnd: false` 并把同一页数据再发一遍，`autoContinue` 于是最多连拉 3 页空数据，之后被 `endReached` 继续触发，永远停不下来。

**方案**

A. **闸门改由数据决定**
给 `handleEndReached` 加一个「数据指纹」：

```ts
const fingerprint = list.length === 0 ? '0'
    : `${list.length}|${list[0]?.id}|${list[list.length - 1]?.id}`;
if (endReachedGuardRef.current === fingerprint) return;
endReachedGuardRef.current = fingerprint;
```

同一份数据只放行一次，只有列表真的变长了才允许下一次。`Error` 状态也一并挡住（失败后停下来等用户点重试）。

`MediaGrid` / `ArtistResult` 的 observer 同样改为：状态与回调放 `ref`，依赖数组只留 `[enableLoadMore, data.length]`，并用 `guardLenRef` 做同样的条数闸门。

B. **底部状态改成可订阅**
在 `SongTable` 内部加了一个 20 行的极简 store（`createFooterStatusStore`），`TableFoot` 用 `useSyncExternalStore` 订阅。状态变化能真正推到 Virtuoso 注入的那个节点上。

C. **`isEnd` 改由条数规则推断**（`fetchPage` 里集中处理）

```
baseline = 首屏条数（"一页应该有多少条"）
到底 = 插件说 isEnd
     或 本页条数 < baseline         （短页 = 最后一页）
     或 本页 0 条
     或 本页全是已存在的 id          （插件翻页失效，原样返回上一页）
     或 拼接后总条数没有增长
```

首屏少于 3 条时也不再尝试翻页（`MIN_PAGE_HINT`）—— 这种情况硬拉第 2 页多半报错，最后变成「加载失败·点击重试」误导用户。
`autoContinue` 连拉 3 页仍无新数据时兜底置 `isEnd`。

**配套的 API 调整**

- `store` 里的结果记录增加 `loadMoreStatus`（与整页 `status` 分开）和 `baselinePageSize`。原来首屏和加载更多共用一个 `status`，首屏成功即 `Done`，底部就没法区分「正在加载更多」和「已经到底」。
- `useSearch` 新增 `retryLoadMore`。`loadMore` 遇到 `Error` 会直接返回（这是防空转的关键），所以「点击重试」必须有一条能绕过该闸门的路径，否则按钮点了没反应。
- `SongTable` / `MediaGrid` 新增可选 prop `showNoMore`（默认 `false`，向后兼容）：`enableLoadMore=false` 时也把 footer 渲染出来，用于显示「没有更多了」。否则到底之后 footer 直接消失，用户不知道是加载完了还是坏了。

**影响面**
`loadMore` 的语义变严格（`Error` 状态下不再自动重试）。所有原来把 `onLoadMoreRetry` 指向 `handleLoadMore` 的调用点都改成了新的 `retryLoadMore`，行为对用户是「按钮恢复可用」。

---

### 3. 切页后 tab / 滚动 / 插件选择被重置

**现象**
- 多插件页面（排行榜、热门歌单）点进详情再返回，落回第一个插件。
- 本地音乐切到「歌手」，去听一首再回来，变回「歌曲」。
- 设置页切到「播放」，进别的页再回来，变回「通用」。
- 搜索页切到「专辑」，返回后变回「音乐」。
- 列表滚到中间，进详情再返回，回到顶部。

**根因**
这个应用的页面是**平级路由**（`createHashRouter`），导航即卸载重建。作者把 tab 放在页面自己的 `useState` 里，卸载就没了 —— 这是「有状态就重建」的直接结果，不算 bug，是设计取舍。

值得注意的是，**搜索页早就解决过这个问题**：`store.ts` 里的 `activeMediaTypeAtom` / `activePluginPerTypeAtom`，注释写着「每种媒体类型各自记忆上次选中的插件 hash」。所以这不是引入新范式，而是把同一口径补齐到其余页面。

**方案**

沿用搜索页的做法，把"当前停在哪个 tab"提进 jotai：

- `common/pageTabs.ts` — `localMusicTabAtom`、`downloadTabAtom`、`settingSectionAtom`、`themeSectionAtom`、`artistTabAtom`
  （歌手详情把 `{id, tab}` 一起存：同一个歌手返回时恢复上次的 tab，换一个歌手自然落回「单曲」，不会串味）
- `common/pluginTabs.ts` — `activePluginPerFeatureAtom`，`feature → 上次选中的插件 hash`（排行榜 / 热门歌单共用）

口径约定（写在文件头注释里）：
- **只记忆 tab，不记忆搜索框内容**（一进列表就带着旧过滤词会误导）；
- **仅本次运行内有效，不落盘**（重启回默认）；
- 换数据集时由页面自己决定是否复位。

滚动位置单独处理：`hooks/useScrollRestoration.ts`（81 行），按 `location.key` 记账。细节上做了两件事：一是列表数据异步加载时内容高度还没撑开，直接 `scrollTo` 会被浏览器 clamp 到 0，所以用 `requestAnimationFrame` 连试几帧；二是不接管所有滚动，只处理内容区。

**F5 / Ctrl+R 的语义**

原来按 F5 是整窗重载（Electron 默认），会丢掉所有界面状态。现在改成「按当前界面上的信息重新请求一次」：

- `App.tsx` 先跑一遍登记过的失效回调（`common/refresh.ts`），再 `setRefreshTick` 让 `<Outlet key>` 变化、当前页面重挂；
- 「挂载即拉数据」的页面（榜单、歌单、专辑、歌手、下载）重挂后自动重新请求；
- 数据缓存在 jotai 里的页面（搜索页）不会因为重挂而重拉，所以它显式 `onBeforeRefresh(resetSearchResults)` 把缓存清掉 —— 否则会出现「按了 F5，什么都没发生」。

放组件层而不是 `infra/shortCut` 的原因：后者只管 8 个播放器动作，且模块注释已说明组件级快捷键应自行绑定。

**另外修的一处**
`SearchPage/index.tsx` 判断"是否是新搜索"原来用组件内的 `prevQueryRef`。从详情页返回时组件重新挂载、ref 被重置成 `''`，于是被误判成新搜索，把 `activeType` 打回音乐、结果清空重拉。改成读 `store.get(searchQueryAtom)`，挂载状态无关。

**影响面**
新增 4 个文件，均为 `common/` 或 `hooks/` 下的纯前端状态，不涉及 infra。tab 值的类型是从各页面现有 `useState` 的泛型直接搬过来的。

---

### 4. 底部提示文字在浅色主题下不可见

**现象**
白色主题下，列表底部的「没有更多了」「加载中…」「点击重试」几乎看不见，浅灰到像没渲染。

**根因**
样式里写死了白系半透明：

```scss
color: rgba(255, 255, 255, 0.15);   // done
color: rgba(255, 255, 255, 0.25);   // loading
color: rgba(255, 255, 255, 0.3);    // error
background-color: rgba(255, 255, 255, 0.04);
```

这在深色主题下刚好够用，但项目本身有 3 套本地主题（含浅色），白底白字必然看不见。项目已经有语义化 token（`--color-text-secondary` / `--color-text-disabled` / `--color-border-default`），这几处是漏网的硬编码。

**方案**

三个文件（`ListFooter`、`StatusPlaceholder`、`PluginFeatureUnavailable`）里的硬编码 `rgba(255,255,255,*)` 全部换成对应语义 token；`--done` 的字号从 `--text-caption-size` 提到 `--text-label-size`，字重提到 `medium`。

**关于字重的一个坑**：一开始试过 `-webkit-text-stroke: 0.3px` 加粗，13px 中文描边会在笔画边缘产生重影，已放弃，改用字重。

---

## 四、不建议提交上游的部分

以下两处是本地环境专用，**不建议进 PR**，评审时请直接忽略：

| 文件 | 改了什么 | 为什么不提 |
|---|---|---|
| `forge.config.ts` | `outDir: process.env.MUSICFREE_OUT_DIR \|\| 'out'` | 只是为了让程序运行时（exe 被占用）还能打到另一个目录做对比测试，对上游没有价值 |
| `components/business/SongTable/index.scss` | 移除 `:focus-visible` 的品牌色外框 | 纯个人偏好。多选靠键盘触发，但"选中"已经由行高亮表达；不过键盘可达性上「焦点可见」是有争议的，不适合替项目做决定 |

如果维护者觉得焦点框那条有价值，可以单独讨论 —— 我倾向不上游。

---

## 五、验证记录

**环境**：Windows / Electron 40.4.0 / `dev@42a706f` / `electron-forge package` 产物实测

**数据集**：本地音乐库（含大量内嵌封面的文件）

| 场景 | 改前 | 改后 |
|---|---|---|
| 搜索页音乐结果 Shift 多选 | 无反应 | 正常 |
| 搜索页音乐结果 Ctrl+A | 无反应 | 正常 |
| 切页面后选区残留 | 有 | 已清空 |
| 搜索结果只有一页时不操作 | 底部反复闪「加载中/点击重试」 | 稳定显示「没有更多了」 |
| 搜索结果只有 1~2 条 | 反复拉第 2 页并报错 | 直接判定到底 |
| 加载更多失败 | 底部一直「点击重试」，点不动 | 显示「点击重试」，点击可恢复 |
| 加载更多成功但无新数据 | 无限续页 | 一轮后置 `isEnd` |
| 排行榜/热门歌单返回 | 落回第一个插件 | 恢复上次选中 |
| 本地音乐/设置/主题/下载返回 | 落回第一个 tab | 恢复上次 tab |
| 列表滚到中间进详情再返回 | 回到顶部 | 恢复位置 |
| F5 / Ctrl+R | 整窗重载、状态全丢 | 按当前界面重新请求，tab 保持 |
| 浅色主题下底部提示 | 看不见 | 清晰可读 |

**静态检查**：`eslint ./src` 0 error；改动文件 `prettier --check` 全部通过；`tsc --noEmit` 0 error。

---

## 六、提交建议

如果要合入，建议拆成 4 个独立 PR（对应上面 4 条），每条都能单独验证、单独回滚：

```
fix(search): enable multi-select in music result
fix(list):  stop endless endReached when content fits viewport
feat(nav):  persist tab and scroll position across navigation
fix(theme): use semantic color tokens in list footer
```

分支从 `dev` 切出，commit 按 Conventional Commits。

其中第 2 条改动最大（`useSearch` 的分页规则），如果只想先合一条，建议先合它 —— 用户感知最强，且和第 1、3 条没有依赖关系。

---

## 七、已知遗留

- **本地音乐封面**：新版改为 `skipCovers: true`、`artwork: null`，不再把封面转 base64 存 IndexedDB。这是卡死的根治手段，但也意味着列表里没有封面。如果要做「封面可见 + 不卡」，需要的是懒加载 + 磁盘缓存方案（只在可视区域解码、按需读文件），改动量比本套大一个量级，本次没有碰。
- `useScrollRestoration` 目前按 `location.key` 记账，同一路由重复进入会各记一份，长时间使用后 Map 会缓慢增长。量级很小（每次导航一条字符串），暂未做清理。
- 搜索结果各媒体类型（音乐/专辑/歌单/歌手）分页规则统一，但不同插件返回的"一页条数"可能相差很大，`baseline` 是按单个插件单次搜索算的，跨插件不共享。
