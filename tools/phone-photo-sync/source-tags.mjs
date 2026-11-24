// Phone source tags: where a file was on the phone (camera, album, screenshot
// of which app, saved by which app, download). Tags hang under the sync tag
// (来自手机) as  来自手机 › <kind> › <detail>.
import { createHash } from 'node:crypto';
import path from 'node:path';

/** Android package → app name. Screenshot names end with md5(package). */
export const APP_NAMES = {
  'tv.danmaku.bili': '哔哩哔哩',
  'com.ss.android.ugc.aweme': '抖音',
  'com.ss.android.ugc.trill': 'TikTok',
  'com.xingin.xhs': '小红书',
  'com.tencent.mm': '微信',
  'com.tencent.wework': '企业微信',
  'com.tencent.mobileqq': 'QQ',
  'com.tencent.tim': 'TIM',
  'com.zhihu.android': '知乎',
  'com.baidu.tieba': '百度贴吧',
  'com.reddit.frontpage': 'Reddit',
  'com.microsoft.emmx': 'Edge',
  'com.android.chrome': 'Chrome',
  'com.heytap.browser': '浏览器',
  'com.Qunar': '去哪儿',
  'ctrip.android.view': '携程',
  'com.tongcheng.android': '同程旅行',
  'com.netease.cloudmusic': '网易云音乐',
  'com.tencent.qqmusic': 'QQ音乐',
  'com.android.mms': '短信',
  'com.nemoleoliu.OnePointThreeAcres': '一亩三分地',
  'com.xunmeng.pinduoduo': '拼多多',
  'com.taobao.taobao': '淘宝',
  'com.taobao.idlefish': '闲鱼',
  'com.einnovation.temu': 'Temu',
  'com.amazon.mShop.android.shopping': 'Amazon',
  'com.walmart.android': 'Walmart',
  'com.cainiao.wireless': '菜鸟',
  'com.sankuai.meituan': '美团',
  'com.dianping.v1': '大众点评',
  'com.dd.doordash': 'DoorDash',
  'com.ubercab': 'Uber',
  'com.google.android.apps.maps': '谷歌地图',
  'com.autonavi.minimap': '高德地图',
  'com.baidu.BaiduMap': '百度地图',
  'com.thetransitapp.droid': 'Transit',
  'com.flyfrontier.android': 'Frontier',
  'com.infonow.bofa': '美国银行',
  'com.chinamworld.bocmbci': '中国银行',
  'com.eg.android.AlipayGphone': '支付宝',
  'com.tratao.xcurrency': '极简汇率',
  'com.redteamobile.roaming': '红茶移动',
  'com.sinovatech.unicom.ui': '中国联通',
  'com.greenpoint.android.mc10086.activity': '中国移动',
  'com.taou.maimai': '脉脉',
  'com.atriumcampus.connect': 'Atrium',
  'com.sina.weibo': '微博',
  'com.douban.frodo': '豆瓣',
  'com.facebook.katana': 'Facebook',
  'com.discord': 'Discord',
  'org.telegram.messenger': 'Telegram',
  'com.google.android.youtube': 'YouTube',
  'com.openai.chatgpt': 'ChatGPT',
  'com.larus.nova': '豆包',
  'notion.id': 'Notion',
  'com.tencent.androidqqmail': 'QQ邮箱',
  'com.google.android.gm': 'Gmail',
  'com.microsoft.office.outlook': 'Outlook',
  'com.android.email': '邮件',
  'com.tencent.weread': '微信读书',
  'com.koodoreader.expo': 'Koodo Reader',
  'com.lingkou.leetcode': '力扣',
  'com.tencent.tmgp.sgame': '王者荣耀',
  'com.tencent.karaoke': '全民K歌',
  'com.heytap.market': '软件商店',
  'com.android.settings': '设置',
  'com.oplus.wirelesssettings': '设置',
  'com.android.launcher': '桌面',
  'com.android.contacts': '联系人',
  'com.coloros.alarmclock': '时钟',
  'com.coloros.calculator': '计算器',
  'com.coloros.gallery3d': '相册',
  'com.oplus.camera': '相机',
};

const APP_BY_HASH = new Map(Object.entries(APP_NAMES).map(([pkg, name]) => [createHash('md5').update(pkg).digest('hex'), name]));

/** Phone folder (prefix, lower case) → app that saved files there. */
const SAVE_FOLDERS = [
  ['pictures/weixin/', '微信'],
  ['dcim/weixinwork/', '企业微信'],
  ['pictures/qq/', 'QQ'],
  ['pictures/qqimage/', 'QQ'],
  ['movies/qq/', 'QQ'],
  ['pictures/chatgpt/', 'ChatGPT'],
  ['pictures/bili/', '哔哩哔哩'],
  ['pictures/bilibili/', '哔哩哔哩'],
  ['pictures/douyin/', '抖音'],
  ['movies/qqmusic/', 'QQ音乐'],
];

export const KIND = {
  camera: '相机拍摄',
  album: '手机相册',
  screenshot: '手机截图',
  saved: '应用保存',
  download: '手机下载',
};

/**
 * Returns the two tag levels for a phone path: { kind, detail }. detail is
 * null when the kind tag alone describes the file.
 */
export function phoneSourceTags(phonePath) {
  const lower = phonePath.toLowerCase();
  const name = path.posix.basename(phonePath);
  const parts = phonePath.split('/');

  if (lower.startsWith('pictures/screenshots/')) {
    const hash = /_([0-9a-f]{32})\.\w+$/i.exec(name)?.[1]?.toLowerCase();
    const app = hash ? APP_BY_HASH.get(hash) : undefined;
    return { kind: KIND.screenshot, detail: `${app ?? '其他'}截图` };
  }
  if (lower.startsWith('dcim/myalbums/') && parts.length > 3) {
    return { kind: KIND.album, detail: `${parts[2]}相册` };
  }
  const dragDrop = /^download\/\.oplusdraganddrop\/([^/]+)\//i.exec(phonePath);
  if (dragDrop) return { kind: KIND.saved, detail: `${APP_NAMES[dragDrop[1]] ?? '其他应用'}保存` };
  const appData = /^android\/(?:data|media)\/([^/]+)\//i.exec(phonePath);
  if (appData) return { kind: KIND.saved, detail: `${APP_NAMES[appData[1]] ?? '其他应用'}保存` };
  for (const [prefix, app] of SAVE_FOLDERS) {
    if (lower.startsWith(prefix)) return { kind: KIND.saved, detail: `${app}保存` };
  }
  // Xiaohongshu saves notes into the DCIM root (Camera_XHS_…, Camera_1040g…, xhs_live_photo_…).
  if (parts.length === 2 && parts[0].toLowerCase() === 'dcim' && /^(camera_xhs|camera_1040g|xhs_)/i.test(name)) {
    return { kind: KIND.saved, detail: '小红书保存' };
  }
  if (lower.startsWith('dcim/camera/')) {
    if (/^(img|vid)[_\d]/i.test(name)) return { kind: KIND.camera, detail: null };
    return { kind: KIND.saved, detail: '其他应用保存' };
  }
  if (lower.startsWith('download/')) return { kind: KIND.download, detail: null };
  return { kind: KIND.saved, detail: '其他应用保存' };
}

/**
 * Creates the missing source tags under `rootTagName` and assigns each asset
 * its most specific source tag. `entries` is [{ assetId, phonePath }].
 * Returns { tagName: count }.
 */
export async function applyPhoneSourceTags(keel, libraryId, rootTagName, entries) {
  const tags = [];
  for (let offset = 0; ; offset += 200) {
    const page = await keel.call('keel_tag_list', { libraryId, limit: 200, offset });
    tags.push(...page.items);
    if (!page.hasMore) break;
  }
  const byName = new Map(tags.map((tag) => [tag.name, tag.tagId]));
  const ensure = async (name, parentTagId) => {
    if (!byName.has(name)) byName.set(name, (await keel.call('keel_tag_create', { libraryId, name, parentTagId })).id);
    return byName.get(name);
  };
  const rootId = await ensure(rootTagName, null);
  const groups = new Map();
  for (const { assetId, phonePath } of entries) {
    const { kind, detail } = phoneSourceTags(phonePath);
    const target = detail ?? kind;
    if (!groups.has(target)) groups.set(target, { kind, detail, ids: new Set() });
    groups.get(target).ids.add(assetId);
  }
  const counts = {};
  for (const [name, group] of groups) {
    const kindId = await ensure(group.kind, rootId);
    const tagId = group.detail ? await ensure(group.detail, kindId) : kindId;
    const ids = [...group.ids];
    for (let start = 0; start < ids.length; start += 10_000) {
      await keel.call('keel_tag_assign', { libraryId, assetIds: ids.slice(start, start + 10_000), tagIds: [tagId] });
    }
    counts[name] = ids.length;
  }
  return counts;
}
