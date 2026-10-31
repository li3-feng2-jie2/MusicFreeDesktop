/**
 * SheetResult — 搜索结果：歌单 Tab
 *
 * 使用 ui/MediaGrid 展示歌单卡片网格。
 * IMusicSheetItem 与 MediaGrid 的数据类型完全匹配。
 */

import { useCallback } from 'react';
import { useAtomValue } from 'jotai/react';
import { useNavigate } from 'react-router';
import { useTranslation } from 'react-i18next';
import { RequestStatus } from '@common/constant';
import { MediaGrid } from '../../../components/ui/MediaGrid';
import { musicSheetRoute } from '../../../routes';
import { searchResultsAtom, type SearchMediaType } from '../store';
import { useSearch } from '../useSearch';

interface SheetResultProps {
    pluginHash: string;
}

export function SheetResult({ pluginHash }: SheetResultProps) {
    const results = useAtomValue(searchResultsAtom);
    const type: SearchMediaType = 'sheet';
    const record = results[type][pluginHash];
    const { search, loadMore, retryLoadMore } = useSearch();
    const navigate = useNavigate();
    const { t } = useTranslation();

    const data = record?.data ?? [];
    const status = record?.status ?? RequestStatus.Idle;
    const isEnd = record?.isEnd ?? false;
    const loadMoreStatus = record?.loadMoreStatus ?? RequestStatus.Idle;

    const handleRetry = useCallback(() => {
        if (record?.query) {
            search(record.query, type, pluginHash);
        }
    }, [search, record?.query, pluginHash]);

    const handleLoadMore = useCallback(() => {
        loadMore(type, pluginHash);
    }, [loadMore, pluginHash]);

    // 底部「点击重试」：绕过失败闸门，手动再拉一次
    const handleRetryLoadMore = useCallback(() => {
        retryLoadMore(type, pluginHash);
    }, [retryLoadMore, pluginHash]);

    const handleItemClick = useCallback(
        (item: IMusic.IMusicSheetItem) => {
            navigate(musicSheetRoute(item.platform, item.id), {
                state: { sheetItem: item },
            });
        },
        [navigate],
    );

    return (
        <MediaGrid
            data={data}
            onItemClick={handleItemClick}
            requestStatus={status}
            onRetry={handleRetry}
            enableLoadMore={!isEnd && data.length > 0 && status !== RequestStatus.Idle}
            loadMoreStatus={loadMoreStatus}
            showNoMore={isEnd && data.length > 0}
            onLoadMore={handleLoadMore}
            onLoadMoreRetry={handleRetryLoadMore}
            emptyTitle={t('search.empty_sheet')}
        />
    );
}
