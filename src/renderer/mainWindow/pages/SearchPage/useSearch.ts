/**
 * useSearch — 搜索页核心 Hook
 *
 * 分页规则完全由「条数」决定，不依赖滚动事件：
 *
 *   1. 首屏返回的条数记为 baseline（一页大概多少条）
 *   2. 后续某页返回条数 < baseline、返回 0 条、或返回项全是重复的
 *      → 视为最后一页，isEnd = true
 *   3. 拉取后总条数没有增长 → 视为到底，同样置 isEnd
 *   4. 请求失败 → loadMoreStatus = Error，停止自动重试，等用户点「点击重试」
 *
 * 这样即使列表内容填不满一屏（UI 一直认为「已在底部」），
 * 也不会出现「请求 → 成功 → 再请求」的空转。
 *
 * 防腐设计：
 * - fetchPage 写入前检查 store 中的 query 是否仍匹配（防 stale 写入）
 * - autoContinue 仅追踪本轮新增数据量而非累积量
 */

import { useCallback, useRef } from 'react';
import { RequestStatus } from '@common/constant';
import pluginManager from '@infra/pluginManager/renderer';
import { type SearchMediaType, getPluginResult, setPluginResult } from './store';

/** 最大自动续页次数（防止死循环） */
const MAX_AUTO_CONTINUE = 3;

/**
 * 首屏少于此条数时，不再尝试翻页。
 * 搜索结果只有一两条时，插件多半没有下一页；硬拉第 2 页会报错，
 * 最后变成「加载失败·点击重试」误导用户。
 */
const MIN_PAGE_HINT = 3;

/**
 * 请求阶段：
 * - initial 首屏（决定 status）
 * - more    加载更多（决定 loadMoreStatus）
 */
type FetchPhase = 'initial' | 'more';

interface FetchOutcome {
    success: boolean;
    isEnd: boolean;
    /** 本轮真正新增的条数（去重后变少则算 0） */
    dataLen: number;
}

/** 取条目的 id（不同媒体类型都有 id，这里做一次宽松取值） */
function itemId(item: unknown): string | undefined {
    const id = (item as { id?: string } | undefined)?.id;
    return id || undefined;
}

/**
 * 执行一次搜索请求并写入 store。
 *
 * 写入前会校验 store 中该 slot 的 query 仍为当前 query，
 * 防止 stale 响应覆盖新搜索结果。
 */
async function fetchPage<T extends SearchMediaType>(
    query: string,
    page: number,
    type: T,
    pluginHash: string,
    phase: FetchPhase,
): Promise<FetchOutcome> {
    try {
        const result = await pluginManager.callPluginMethod({
            hash: pluginHash,
            method: 'search',
            args: [query, page, type],
        });

        // ── Stale guard：写入前确认 slot 的 query 没有被更新 ──
        const current = getPluginResult(type, pluginHash);
        if (current && current.query !== query) {
            // 用户已切换关键词，丢弃本次结果
            return { success: false, isEnd: true, dataLen: 0 };
        }

        const resData = (result?.data ?? []) as IMedia.SupportMediaItem[T][];
        const resIsEnd = result?.isEnd ?? true;
        const prevData = (current?.data ?? []) as IMedia.SupportMediaItem[T][];

        if (__DEV__) {
            console.log(
                `[useSearch] ${pluginHash} / ${type} / page ${page}:`,
                `${resData.length} items, isEnd=${resIsEnd}`,
                resData,
            );
        }

        // ── 重复页判定 ──
        // 部分音源翻页失效，会把同一页再返回一遍；不挡住的话列表会无限变长。
        const prevIds = new Set<string>();
        prevData.forEach((item) => {
            const id = itemId(item);
            if (id) {
                prevIds.add(id);
            }
        });
        const allDuplicated =
            page > 1 &&
            resData.length > 0 &&
            prevIds.size > 0 &&
            resData.every((item) => {
                const id = itemId(item);
                return !!id && prevIds.has(id);
            });

        // ── 条数规则 ──
        // baseline = 首页条数，即「一页应该有多少条」。
        // 后面某页少于它，说明这就是最后一页。
        const baseline = page === 1 ? resData.length : (current?.baselinePageSize ?? 0);
        const shortPage = page > 1 && baseline > 0 && resData.length < baseline;
        const emptyPage = page > 1 && resData.length === 0;
        // 首屏就只有很少几条：不再尝试翻页
        const tooFewToPage = page === 1 && resData.length > 0 && resData.length < MIN_PAGE_HINT;

        const finalIsEnd = resIsEnd || allDuplicated || shortPage || emptyPage || tooFewToPage;

        const nextData = page === 1 ? resData : [...prevData, ...resData];
        // 拉取后条数没有增长 → 事实上到底了
        const grew = nextData.length > prevData.length;

        setPluginResult(type, pluginHash, {
            query,
            page,
            isEnd: finalIsEnd,
            status:
                phase === 'initial' ? RequestStatus.Done : (current?.status ?? RequestStatus.Done),
            // 首屏就直接到底时也让底部显示「没有更多了」，避免空白。
            loadMoreStatus:
                phase === 'more'
                    ? RequestStatus.Done
                    : finalIsEnd
                      ? RequestStatus.Done
                      : RequestStatus.Idle,
            baselinePageSize: baseline,
            data: nextData,
        });

        return {
            success: true,
            isEnd: finalIsEnd,
            // 没有增长时按 0 回报，续页逻辑据此停手
            dataLen: grew ? resData.length : 0,
        };
    } catch (err) {
        // Stale guard on error path too
        const current = getPluginResult(type, pluginHash);
        if (current && current.query !== query) {
            return { success: false, isEnd: true, dataLen: 0 };
        }

        console.error(`[useSearch] search failed: ${pluginHash} / ${type} / page ${page}`, err);
        setPluginResult(type, pluginHash, {
            // 首屏失败 → 整页显示错误占位；加载更多失败 → 只影响底部提示
            status:
                phase === 'initial'
                    ? RequestStatus.Error
                    : (current?.status ?? RequestStatus.Error),
            loadMoreStatus: phase === 'more' ? RequestStatus.Error : RequestStatus.Idle,
        });
        return { success: false, isEnd: true, dataLen: 0 };
    }
}

/**
 * 自动续页：如果当前页返回空数据但 isEnd 为 false，自动拉取下一页。
 * 最多续 MAX_AUTO_CONTINUE 次。
 *
 * 只检查每轮 fetchPage 的返回值（dataLen）判断是否继续，
 * 不依赖累积数据量（避免 loadMore 场景下已有数据导致立即 break）。
 */
async function autoContinue<T extends SearchMediaType>(
    query: string,
    startPage: number,
    type: T,
    pluginHash: string,
): Promise<void> {
    let page = startPage;
    // 是否已经出现了「可以停手」的理由（到底 / 失败 / 拿到数据 / 词已变）
    let settled = false;

    for (let i = 0; i < MAX_AUTO_CONTINUE; i++) {
        const prev = getPluginResult(type, pluginHash);
        if (!prev || prev.isEnd || prev.query !== query) {
            settled = true;
            break;
        }

        page += 1;
        setPluginResult(type, pluginHash, { loadMoreStatus: RequestStatus.Pending });

        const result = await fetchPage(query, page, type, pluginHash, 'more');
        // 请求失败、到底、或获取到新数据 → 停止自动续页
        if (!result.success || result.isEnd || result.dataLen > 0) {
            settled = true;
            break;
        }
    }

    // 连续 MAX_AUTO_CONTINUE 页都是空数据、插件却一直说「没到底」：
    // 视为到底，否则加载更多会被反复触发，永远停不下来。
    if (!settled) {
        const last = getPluginResult(type, pluginHash);
        if (last && last.query === query && !last.isEnd) {
            setPluginResult(type, pluginHash, {
                isEnd: true,
                loadMoreStatus: RequestStatus.Done,
            });
        }
    }
}

export function useSearch() {
    // 用于取消过期请求的序列号
    const seqRef = useRef(0);

    /**
     * 首次搜索：从第 1 页开始。
     * 会自动 reset 该 slot 然后拉取。
     */
    const search = useCallback(async (query: string, type: SearchMediaType, pluginHash: string) => {
        if (!query.trim() || !pluginHash) return;

        const seq = ++seqRef.current;

        // 初始化状态
        setPluginResult(type, pluginHash, {
            query,
            page: 1,
            isEnd: false,
            status: RequestStatus.Pending,
            loadMoreStatus: RequestStatus.Idle,
            baselinePageSize: 0,
            data: [],
        });

        const result = await fetchPage(query, 1, type, pluginHash, 'initial');

        // 过期检查（双重保险：fetchPage 自身的 stale guard + 此处的 seq 检查）
        if (seqRef.current !== seq) return;

        // 首页无数据且未到底 → 自动续页
        if (result.success && !result.isEnd && result.dataLen === 0) {
            await autoContinue(query, 1, type, pluginHash);
        }
    }, []);

    /**
     * 加载更多：在当前 page 基础上 +1。
     *
     * 闸门（全部由数据决定，不看滚动）：
     * - 已到底 → 不拉
     * - 正在拉 → 不拉
     * - 上次失败 → 不拉，等用户点「点击重试」
     */
    const loadMore = useCallback(async (type: SearchMediaType, pluginHash: string) => {
        const prev = getPluginResult(type, pluginHash);
        if (!prev || !prev.query || prev.isEnd) return;
        if (prev.status === RequestStatus.Pending) return;
        if (prev.loadMoreStatus === RequestStatus.Pending) return;
        if (prev.loadMoreStatus === RequestStatus.Error) return;

        const nextPage = prev.page + 1;
        setPluginResult(type, pluginHash, { loadMoreStatus: RequestStatus.Pending });

        const result = await fetchPage(prev.query, nextPage, type, pluginHash, 'more');

        // 本页无新增且未到底 → 自动续页
        if (result.success && !result.isEnd && result.dataLen === 0) {
            await autoContinue(prev.query, nextPage, type, pluginHash);
        }
    }, []);

    /**
     * 底部「点击重试」专用：绕过 Error 闸门，手动再发一次。
     */
    const retryLoadMore = useCallback(async (type: SearchMediaType, pluginHash: string) => {
        const prev = getPluginResult(type, pluginHash);
        if (!prev || !prev.query || prev.isEnd) return;
        if (prev.loadMoreStatus === RequestStatus.Pending) return;

        const nextPage = prev.page + 1;
        setPluginResult(type, pluginHash, { loadMoreStatus: RequestStatus.Pending });

        const result = await fetchPage(prev.query, nextPage, type, pluginHash, 'more');

        if (result.success && !result.isEnd && result.dataLen === 0) {
            await autoContinue(prev.query, nextPage, type, pluginHash);
        }
    }, []);

    return { search, loadMore, retryLoadMore };
}
