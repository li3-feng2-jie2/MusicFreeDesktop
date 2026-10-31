/**
 * 界面刷新（F5 / Ctrl+R）
 *
 * 语义：按当前界面上的信息重新请求一次，**不是整窗重载**。
 *
 * 做法分两层，缺一不可：
 *   1. App 层：把当前页面组件整体重新挂载（<Outlet key> 变化），
 *      页面里「挂载即拉数据」的 hook（榜单、歌单、专辑、歌手、下载…）会自动重新请求；
 *   2. 缓存层：把数据存在 jotai 里的页面（目前是搜索结果）不会因为重挂而重拉，
 *      所以需要在这里登记一个「先失效」回调，先把缓存清掉再重挂。
 *      否则就会出现「按了 F5，但什么都没发生」。
 *
 * 放在组件层而不是 infra/shortCut：那里只管 8 个播放器动作，
 * 且模块注释已说明组件级快捷键直接用 tinykeys / DOM 监听绑定。
 */

type RefreshHandler = () => void;

const handlers = new Set<RefreshHandler>();

/** 登记一个「刷新前先失效」的回调，返回取消函数 */
export function onBeforeRefresh(handler: RefreshHandler): () => void {
    handlers.add(handler);
    return () => {
        handlers.delete(handler);
    };
}

/** 触发一次失效（由 App 的快捷键监听调用，执行完再重挂页面） */
export function runRefreshHandlers(): void {
    handlers.forEach((handler) => {
        try {
            handler();
        } catch (err) {
            console.error('[refresh] handler failed', err);
        }
    });
}
