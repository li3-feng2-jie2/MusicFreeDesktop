// ============================================================================
// App — 应用根布局
// ============================================================================
//
// 布局结构:
//   ┌────────────┬──────────────────────────────────┐
//   │  Sidebar   │  TopBar (nav + search)  [winctrls]│
//   │  260px     ├──────────────────────────────────┤
//   │  全高       │  Content / <Outlet />            │
//   │            │  (flex-1, scrollable)            │
//   │            ├──────────────────────────────────┤
//   │            │  PlayerBar (72px, fixed 底部)     │
//   └────────────┴──────────────────────────────────┘
//   PlayerBar 从 sidebar 右侧开始，不覆盖 sidebar

import { useEffect, useState } from 'react';
import { Outlet } from 'react-router';
import Sidebar from './components/layout/Sidebar';
import TopBar from './components/layout/TopBar';
import PlayerBar from './components/layout/PlayerBar';
import QueueDrawer from './components/layout/QueueDrawer';
import FullscreenPlayer from './components/layout/FullscreenPlayer';
import { ToastContainer } from './components/ui/Toast';
import { ModalContainer } from './components/ui/Modal/ModalContainer';
import { ContextMenuContainer } from './components/ui/ContextMenu/ContextMenuContainer';

// 注册业务弹窗 & 右键菜单模板
import './components/business/modals';
import './components/business/contextMenus';

import './App.scss';
import { useScrollRestoration } from './hooks/useScrollRestoration';
import { runRefreshHandlers } from './common/refresh';

export default function App() {
    // 切页时记住/恢复内容区的滚动位置（配合 jotai 里已上提的页面状态，
    // 让"返回"看起来像页面被缓存过）
    useScrollRestoration();

    // ── F5 / Ctrl+R：按当前界面重新请求一次（不是整窗重载） ──
    // 先让缓存层失效，再改 key 把当前页面整体重挂；这样「挂载即拉数据」的
    // hook 会重新请求，而 tab / 插件选择等界面状态在 atom 里，不受影响。
    const [refreshTick, setRefreshTick] = useState(0);
    useEffect(() => {
        const onKeyDown = (e: KeyboardEvent) => {
            const isF5 = e.key === 'F5';
            const isCtrlR =
                (e.ctrlKey || e.metaKey) && !e.shiftKey && !e.altKey && e.key.toLowerCase() === 'r';
            if (!isF5 && !isCtrlR) {
                return;
            }
            e.preventDefault();
            runRefreshHandlers();
            setRefreshTick((n) => n + 1);
        };
        window.addEventListener('keydown', onKeyDown);
        return () => window.removeEventListener('keydown', onKeyDown);
    }, []);

    return (
        <div className="l-app-shell">
            <Sidebar />
            <main className="l-app-shell__main">
                <TopBar />
                <div className="l-app-shell__content">
                    <Outlet key={refreshTick} />
                </div>
            </main>
            <PlayerBar />
            <QueueDrawer />
            <FullscreenPlayer />
            <ToastContainer />
            <ModalContainer />
            <ContextMenuContainer />
        </div>
    );
}
