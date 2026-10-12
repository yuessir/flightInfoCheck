/**
 * manage_redis.js - Upstash Redis 鍵值管理與清理工具
 * 
 * 支援功能：
 * 1. 互動式選單：列出所有 Key，輸入編號即可刪除 (node manage_redis.js)
 * 2. 指令式刪除特定 Key：node manage_redis.js --del=key名稱
 * 3. 快速清空航班快取：node manage_redis.js --clear-flights
 * 4. 模式比對批次刪除：node manage_redis.js --pattern="flight:*"
 */

require('dotenv').config();
const readline = require('readline');
const { Redis } = require('@upstash/redis');

if (!process.env.UPSTASH_REDIS_REST_URL || !process.env.UPSTASH_REDIS_REST_TOKEN) {
  console.error('❌ 缺少 Redis 設定 (UPSTASH_REDIS_REST_URL / UPSTASH_REDIS_REST_TOKEN)，請檢查 .env！');
  process.exit(1);
}

const redis = new Redis({
  url: process.env.UPSTASH_REDIS_REST_URL,
  token: process.env.UPSTASH_REDIS_REST_TOKEN,
});

const args = process.argv.slice(2);
const delArg = args.find(a => a.startsWith('--del='));
const targetKeyToDel = delArg ? delArg.split('=')[1].trim() : null;
const patternArg = args.find(a => a.startsWith('--pattern='));
const targetPattern = patternArg ? patternArg.split('=')[1].trim() : null;
const isClearFlights = args.includes('--clear-flights') || args.includes('--flights');
const isListOnly = args.includes('--list') || args.includes('--ls');

function formatTTL(seconds) {
  if (seconds === -1) return '永久 (無過期)';
  if (seconds === -2) return '已過期/不存在';
  if (seconds < 60) return `${seconds} 秒`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)} 分鐘`;
  if (seconds < 86400) return `${(seconds / 3600).toFixed(1)} 小時`;
  return `${(seconds / 86400).toFixed(1)} 天`;
}

function getKeyCategory(key) {
  if (key.startsWith('flight:data:')) return '🛫 航班業務資料';
  if (key.startsWith('flight:schedule:')) return '⏱️ 航班排程控制';
  if (key.startsWith('flight:state:')) return '🕰️ 舊版航班快取';
  if (key.startsWith('flight:')) return '🛫 航班相關快取';
  if (key.startsWith('group:')) return '👥 LINE 群組 ID';
  if (key.startsWith('user:')) return '👤 LINE 用戶 ID';
  if (key.startsWith('config:')) return '⚙️ 系統設定';
  return '📦 其他資料';
}

async function getAllKeysInfo() {
  const keys = await redis.keys('*');
  const items = [];

  for (const key of keys) {
    let ttl = -1;
    let preview = '';
    try {
      ttl = await redis.ttl(key);
      let val = await redis.get(key);
      if (typeof val === 'object' && val !== null) {
        if (val.status) preview = `狀態: ${val.status}${val.gate?.value ? ' | 門:' + val.gate.value : ''}`;
        else if (val.lastSlot) preview = `槽位: ${val.lastSlot} | 結束: ${val.isFinished ? '是' : '否'}`;
        else if (val.groupName) preview = `群組: ${val.groupName}`;
        else if (val.displayName) preview = `用戶: ${val.displayName}`;
        else preview = JSON.stringify(val).substring(0, 40) + '...';
      } else if (typeof val === 'string') {
        preview = val.substring(0, 40);
      }
    } catch (_) {}

    items.push({
      key,
      category: getKeyCategory(key),
      ttlText: formatTTL(ttl),
      preview: preview || '-'
    });
  }

  // 排序：航班快取排前面，其他排後面
  items.sort((a, b) => a.key.localeCompare(b.key));
  return items;
}

async function deleteKey(key) {
  const res = await redis.del(key);
  if (res > 0) {
    console.log(`✅ 成功刪除 Key: [${key}]`);
  } else {
    console.warn(`⚠️ 未能刪除 (Key 可能已不存在): [${key}]`);
  }
}

async function main() {
  console.log('====================================================');
  console.log('🗄️  Upstash Redis 雲端鍵值管理工具');
  console.log('====================================================\n');

  // 1. 命令列模式：直接清空航班快取
  if (isClearFlights) {
    console.log('🧹 正在掃描並清空所有航班快取 (flight:*)...');
    const flightKeys = await redis.keys('flight:*');
    if (flightKeys.length === 0) {
      console.log('ℹ️ 目前 Redis 中沒有任何航班快取 Key。');
      return;
    }
    for (const k of flightKeys) {
      await deleteKey(k);
    }
    console.log(`🎉 已清理完畢！共刪除 ${flightKeys.length} 個航班快取。\n`);
    return;
  }

  // 2. 命令列模式：依 Pattern 刪除
  if (targetPattern) {
    console.log(`🧹 正在依條件 [${targetPattern}] 搜尋並刪除...`);
    const matched = await redis.keys(targetPattern);
    if (matched.length === 0) {
      console.log(`ℹ️ 沒有找到符合 [${targetPattern}] 的 Key。`);
      return;
    }
    for (const k of matched) {
      await deleteKey(k);
    }
    console.log(`🎉 已清理完畢！共刪除 ${matched.length} 個 Key。\n`);
    return;
  }

  // 3. 命令列模式：直接指定特定 Key 刪除
  if (targetKeyToDel) {
    await deleteKey(targetKeyToDel);
    return;
  }

  // 4. 預設模式：列出所有 Key 並提供互動式選單
  console.log('🔍 正在連線讀取 Redis 雲端現有 Key 清單...\n');
  const items = await getAllKeysInfo();

  if (items.length === 0) {
    console.log('ℹ️ 目前 Upstash Redis 是空的，沒有任何 Key！\n');
    return;
  }

  console.log(`📋 共找到 ${items.length} 個 Key：\n`);
  console.table(items.map((item, idx) => ({
    '編號': idx + 1,
    'Key 名稱': item.key,
    '類型': item.category,
    '剩餘 TTL': item.ttlText,
    '摘要預覽': item.preview
  })));

  if (isListOnly || !process.stdin.isTTY) {
    console.log('\n💡 提示：');
    console.log('👉 刪除單一 Key: node manage_redis.js --del=<KEY名稱>');
    console.log('👉 清空所有航班快取: node manage_redis.js --clear-flights\n');
    return;
  }

  // 互動輸入提示
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
  });

  console.log('\n💡 操作選項：');
  console.log('  • 輸入編號（例如 1 或多個 1,2,3）進行刪除');
  console.log('  • 輸入 "flights" 清空所有航班快取');
  console.log('  • 輸入 "q" 或按 Ctrl+C 離開\n');

  rl.question('👉 請選擇要執行的操作: ', async (answer) => {
    rl.close();
    const trimmed = (answer || '').trim().toLowerCase();

    if (!trimmed || trimmed === 'q' || trimmed === 'exit') {
      console.log('👋 已取消操作。');
      return;
    }

    if (trimmed === 'flights' || trimmed === 'f') {
      const flightKeys = items.filter(i => i.key.startsWith('flight:')).map(i => i.key);
      if (flightKeys.length === 0) {
        console.log('ℹ️ 沒有航班快取可刪除。');
        return;
      }
      for (const k of flightKeys) {
        await deleteKey(k);
      }
      console.log(`🎉 共清空 ${flightKeys.length} 個航班快取！`);
      return;
    }

    // 解析數字清單 (例如 "1" 或 "1, 2")
    const indices = trimmed.split(/[,，\s]+/)
      .map(s => parseInt(s, 10))
      .filter(n => !isNaN(n) && n >= 1 && n <= items.length);

    if (indices.length === 0) {
      // 嘗試比對是否直接輸入了 Key 名稱
      const exactMatch = items.find(i => i.key === answer.trim());
      if (exactMatch) {
        await deleteKey(exactMatch.key);
        return;
      }
      console.log('⚠️ 無效的輸入，未進行任何刪除。');
      return;
    }

    for (const idx of indices) {
      const target = items[idx - 1];
      if (target) {
        await deleteKey(target.key);
      }
    }
    console.log('🎉 刪除操作完成！');
  });
}

main().catch(err => {
  console.error('執行失敗:', err.message);
  process.exit(1);
});
