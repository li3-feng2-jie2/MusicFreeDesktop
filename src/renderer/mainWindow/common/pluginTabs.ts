/**
 * 多插件界面的「上次选中的插件」记忆。
 *
 * 背景：热门歌单 / 排行榜的 TabBar 里，每个 tab 对应一个插件。原先这两页把选中项
 * 放在页面自己的 useState 里 —— 点进歌单（或榜单）再返回时，页面重新挂载、状态清空，
 * 于是总是落回第一个插件。
 *
 * 搜索页早就用同一思路解决过这个问题（见 pages/SearchPage/store.ts 的
 * activePluginPerTypeAtom，注释：「每种媒体类型各自记忆上次选中的插件 hash」），
 * 这里按同样的口径补齐其余两页。
 *
 * 记忆范围：仅本次运行内有效，不落盘。重启程序回到默认（第一个可用插件）。
 */

import { atom } from 'jotai';

/** 支持「多插件切换」的功能名，取自插件 feature 标识 */
export type PluginFeature = 'getTopLists' | 'getRecommendSheetsByTag';

/**
 * feature → 上次选中的插件 hash。
 * 缺省 / 空字符串表示尚未选择，页面会落回第一个可用插件。
 */
export const activePluginPerFeatureAtom = atom<Partial<Record<PluginFeature, string>>>({});
