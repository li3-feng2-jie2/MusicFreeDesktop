/**
 * 各页面的 Tab 选中项（提出来才不会「返回就回到第一个」）。
 *
 * 背景：这个应用的页面是平级路由，导航即卸载重建。作者原本把 tab 放在页面自己的
 * useState 里，所以从详情页返回、或切换侧边栏再回来，一律回到默认 tab。
 * 搜索页早就把 tab 提到 jotai（activeMediaTypeAtom），这里按同一口径补齐其余页面。
 *
 * 口径约定：
 *   - 只记忆「当前停在哪个 tab」，不记忆搜索框内容（一进列表就带着旧过滤词容易误导）；
 *   - 仅本次运行内有效，不落盘；
 *   - 切到别的数据集时由页面自己决定是否复位（例如换插件时清标签筛选）。
 */

import { atom } from 'jotai';

/** 本地音乐：歌曲 / 歌手 / 专辑 / 文件夹 */
export const localMusicTabAtom = atom<'songs' | 'artists' | 'albums' | 'folders'>('songs');

/** 下载页：下载中 / 已完成 */
export const downloadTabAtom = atom<'queue' | 'completed'>('queue');

/** 歌手详情：单曲 / 专辑。
 *  连着 id 一起存 —— 同一个歌手返回时恢复上次的 tab，
 *  换成另一个歌手时自然落回默认的"单曲"，不会串味。 */
export const artistTabAtom = atom<{ id: string; tab: IArtist.ArtistMediaType }>({
    id: '',
    tab: 'music',
});

/** 设置页分区 key（general / playback / ...） */
export const settingSectionAtom = atom<string>('general');

/** 主题页分区 key（local / remote） */
export const themeSectionAtom = atom<string>('local');
