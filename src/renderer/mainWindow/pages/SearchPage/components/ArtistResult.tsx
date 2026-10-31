/**
 * ArtistResult — 搜索结果：作者 Tab
 *
 * 独立圆形头像网格，不复用 MediaGrid（后者为方形封面设计）。
 *
 * 设计稿还原：
 *   网格: repeat(auto-fill, minmax(140px, 1fr)), gap-x 24px, gap-y 32px
 *   头像: 120×120, 圆形, shadow 0 8px 16px rgba(0,0,0,0.3)
 *   名称: 14px semibold, 居中, truncate
 *   副标题: 12px secondary
 */

import { memo, useRef, useEffect, useCallback } from 'react';
import { useAtomValue } from 'jotai/react';
import { useNavigate } from 'react-router';
import { useTranslation } from 'react-i18next';
import { User } from 'lucide-react';
import { RequestStatus } from '@common/constant';
import { Artwork } from '../../../components/ui/Artwork';
import { ListFooter } from '../../../components/ui/ListFooter';
import { StatusPlaceholder } from '../../../components/ui/StatusPlaceholder';
import { artistRoute } from '../../../routes';
import { searchResultsAtom, type SearchMediaType } from '../store';
import { useSearch } from '../useSearch';

interface ArtistResultProps {
    pluginHash: string;
}

export function ArtistResult({ pluginHash }: ArtistResultProps) {
    const results = useAtomValue(searchResultsAtom);
    const type: SearchMediaType = 'artist';
    const record = results[type][pluginHash];
    const { search, loadMore, retryLoadMore } = useSearch();
    const navigate = useNavigate();
    const { t } = useTranslation();

    const handleArtistClick = useCallback(
        (artist: IArtist.IArtistItem) => {
            navigate(artistRoute(artist.platform, artist.id), {
                state: { artistItem: artist },
            });
        },
        [navigate],
    );

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

    // ── IntersectionObserver 哨兵 ──
    const sentinelRef = useRef<HTMLDivElement>(null);
    const enableLoadMore = !isEnd && data.length > 0 && status !== RequestStatus.Idle;
    const showNoMore = isEnd && data.length > 0;

    // 状态与回调放 ref：它们变化时若重建 observer，observe 会立刻再触发一次，
    // 列表填不满一屏时就变成「请求 → 成功 → 再请求」的空转。
    const loadMoreStatusRef = useRef(loadMoreStatus);
    loadMoreStatusRef.current = loadMoreStatus;
    const onLoadMoreRef = useRef(handleLoadMore);
    onLoadMoreRef.current = handleLoadMore;
    // 同一份数据只放行一次
    const guardLenRef = useRef(-1);

    useEffect(() => {
        if (!enableLoadMore) return;
        const sentinel = sentinelRef.current;
        if (!sentinel) return;

        const observer = new IntersectionObserver(
            (entries) => {
                if (!entries[0]?.isIntersecting) return;

                const st = loadMoreStatusRef.current;
                // 失败后不自动重试，等用户点「点击重试」
                if (st === RequestStatus.Pending || st === RequestStatus.Error) return;
                // 条数没变说明上一次拉取没带来新数据，不再空转
                if (guardLenRef.current === data.length) return;

                guardLenRef.current = data.length;
                onLoadMoreRef.current?.();
            },
            { rootMargin: '200px' },
        );

        observer.observe(sentinel);
        return () => observer.disconnect();
    }, [enableLoadMore, data.length]);

    // ── 首次加载占位 ──
    if (data.length === 0) {
        if (status === RequestStatus.Pending) {
            return <StatusPlaceholder status={RequestStatus.Pending} />;
        }
        if (status === RequestStatus.Error) {
            return (
                <StatusPlaceholder
                    status={RequestStatus.Error}
                    errorTitle={t('search.load_artist_error')}
                    onRetry={handleRetry}
                />
            );
        }
        if (status === RequestStatus.Done || status === RequestStatus.Idle) {
            return (
                <StatusPlaceholder
                    status={RequestStatus.Done}
                    isEmpty
                    emptyTitle={t('search.empty_artist')}
                />
            );
        }
    }

    return (
        <div className="p-search__artist-grid">
            <div className="p-search__artist-grid-inner">
                {data.map((artist) => (
                    <ArtistCard
                        key={`${artist.platform}-${artist.id}`}
                        artist={artist}
                        onClick={handleArtistClick}
                    />
                ))}
            </div>

            {enableLoadMore && <div ref={sentinelRef} style={{ height: 1 }} />}
            {(enableLoadMore || showNoMore) && (
                <ListFooter
                    status={enableLoadMore ? loadMoreStatus : RequestStatus.Done}
                    onRetry={handleRetryLoadMore}
                />
            )}
        </div>
    );
}

// ── ArtistCard ──

const ArtistCard = memo(function ArtistCard({
    artist,
    onClick,
}: {
    artist: IArtist.IArtistItem;
    onClick?: (artist: IArtist.IArtistItem) => void;
}) {
    return (
        <div className="p-search__artist-card" onClick={() => onClick?.(artist)}>
            <Artwork
                src={artist.avatar}
                alt={artist.name}
                rounded="lg"
                size="md"
                fallback={<User size={36} />}
                className="p-search__artist-avatar"
            />
            <div className="p-search__artist-name" title={artist.name}>
                {artist.name}
            </div>
            {artist.fans != null && <div className="p-search__artist-fans">{artist.fans} fans</div>}
        </div>
    );
});
