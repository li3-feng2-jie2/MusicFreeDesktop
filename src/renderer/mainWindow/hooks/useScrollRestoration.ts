/**
 * 按「历史条目」记忆内容区滚动位置。
 *
 * 背景：这个应用的 16 个页面是平级路由，导航即卸载重建 —— React 没有 Vue 那种
 * keep-alive，页面 DOM 保不住。真正的做法只剩两条：
 *   ① 把状态从页面里搬出去（tab / 筛选 / 数据），已经用 jotai 做了；
 *   ② 记住滚动位置，回到原处。
 * 两条合起来，返回时的观感与「页面被缓存」基本无差别，而不用把整棵 React 树常驻内存。
 *
 * 为什么按 location.key 而不是 pathname：
 *   - key 是历史条目 ID，浏览器后退会回到同一条目 → 恢复上次位置；
 *   - 从侧边栏重新进入同一路径会新建条目 → 从头开始（符合预期）。
 */

import { useEffect, useRef } from 'react';
import { useLocation } from 'react-router';

const SCROLL_CONTAINER_SELECTOR = '.l-app-shell__content';

/** 历史上限，防止长时间使用后无限增长 */
const MAX_ENTRIES = 100;

/** location.key → scrollTop */
const positions = new Map<string, number>();

function remember(key: string, top: number) {
    positions.set(key, top);
    if (positions.size > MAX_ENTRIES) {
        const oldest = positions.keys().next().value;
        if (oldest !== undefined) {
            positions.delete(oldest);
        }
    }
}

export function useScrollRestoration() {
    const { key } = useLocation();
    const latestRef = useRef(0);
    const keyRef = useRef(key);

    // ── 持续记录当前滚动位置（passive 监听，开销可忽略） ──
    useEffect(() => {
        const el = document.querySelector<HTMLElement>(SCROLL_CONTAINER_SELECTOR);
        if (!el) {
            return;
        }
        const onScroll = () => {
            latestRef.current = el.scrollTop;
        };
        el.addEventListener('scroll', onScroll, { passive: true });
        return () => el.removeEventListener('scroll', onScroll);
    }, []);

    // ── 切页：先把上一页的位置记账，再恢复本页的位置 ──
    useEffect(() => {
        const el = document.querySelector<HTMLElement>(SCROLL_CONTAINER_SELECTOR);
        if (!el) {
            return;
        }

        if (keyRef.current !== key) {
            remember(keyRef.current, latestRef.current);
            keyRef.current = key;
        }

        const target = positions.get(key) ?? 0;
        latestRef.current = target;

        // 新页面内容还没撑开时 scrollTop 会被夹住，多试几帧直到落位
        let frames = 0;
        let raf = requestAnimationFrame(function restore() {
            el.scrollTop = target;
            if (Math.abs(el.scrollTop - target) > 1 && frames < 20) {
                frames += 1;
                raf = requestAnimationFrame(restore);
            }
        });

        return () => cancelAnimationFrame(raf);
    }, [key]);
}
