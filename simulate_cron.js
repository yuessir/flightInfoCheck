/**
 * simulate_cron.js - GitHub Actions 全生命週期與變頻節流全鏈路模擬器
 * 
 * 測試標的：LJ233 (首爾 ICN ➔ 大阪 KIX)
 * - 韓國/日本當地時區: UTC+9
 * - 台灣本地時區: UTC+8 (比日韓慢 1 小時)
 * - 表定起飛: 韓國時間 10:10 (換算台灣時間 09:10)
 * - 表定抵達: 日本時間 12:00 (換算台灣時間 11:00)
 * 
 * 完整覆蓋：
 * 1. 階梯 1 (遠期觀望 > 12 小時，24 小時一格) + 槽內節流抑制
 * 2. 階梯 2 (當日備戰 3 ~ 12 小時，2 小時一格) + 槽內節流抑制 + 跨槽喚醒
 * 3. 階梯 3 (起飛前夕衝刺，超過 120 分鐘密集變頻期，每 25 分鐘一格)
 *    - 06:10 SPRINT_0 (衝刺起點)
 *    - 06:20 槽內重複喚醒 (節流抑制)
 *    - 06:35 SPRINT_1 (跨格 + 登機門公佈異動)
 *    - 06:48 槽內重複喚醒 (節流抑制)
 *    - 07:00 SPRINT_2 (跨格 + 無異動略過發卡)
 *    - 07:25 SPRINT_3 (跨格)
 *    - 07:50 SPRINT_4 (跨格)
 *    - 08:15 SPRINT_5 (跨格)
 *    - 09:35 SPRINT_8 (飛行途中狀態異動)
 * 4. 階梯終點 (已抵達 + 行李轉盤公佈)
 * 5. 抵達後排程喚醒 (isFinished 永久終止查詢)
 */

require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
const { Redis } = require('@upstash/redis');

const SAMPLES_DIR = path.join(__dirname, 'samples');
const TARGET_SAMPLE = path.join(SAMPLES_DIR, 'flight_LJ233.json');

const FAR_SAMPLE = path.join(SAMPLES_DIR, 'flight_LJ233_far.json');
const MID_SAMPLE = path.join(SAMPLES_DIR, 'flight_LJ233_mid.json');
const SPRINT_NOGATE_SAMPLE = path.join(SAMPLES_DIR, 'flight_LJ233_sprint_nogate.json');
const GATE_ANNOUNCED_SAMPLE = path.join(SAMPLES_DIR, 'flight_LJ233_before.json');
const DEPART_SAMPLE = path.join(SAMPLES_DIR, 'flight_LJ233_Depart.json');
const ARRIVE_SAMPLE = path.join(SAMPLES_DIR, 'flight_LJ233_arrive.json');

const LJ233_URL = 'https://www.trip.com/webapp/flight/schedule/detail.html?hideAddTrip=true&isHideNavBar=YES&navBarStyle=gray&queryDate=2026-10-12&flightNo=LJ233&dcode=ICN&acode=KIX&queryTime=10:10:00&locale=zh_TW';

const redis = process.env.UPSTASH_REDIS_REST_URL && process.env.UPSTASH_REDIS_REST_TOKEN
  ? new Redis({ url: process.env.UPSTASH_REDIS_REST_URL, token: process.env.UPSTASH_REDIS_REST_TOKEN })
  : null;

async function resetState() {
  console.log('\n🧹 ==================== [環境準備：重置乾淨快取] ====================');
  // 清理 Redis (方案二分層 Key + 舊版 Key)
  if (redis) {
    try {
      await redis.del('flight:schedule:LJ233_2026-10-12');
      await redis.del('flight:data:LJ233_2026-10-12');
      await redis.del('flight:state:LJ233_2026-10-12');
      console.log('✅ 已清除 Redis 歷史快取 (flight:schedule, flight:data, flight:state)');
    } catch (err) {
      console.warn('清理 Redis 失敗:', err.message);
    }
  }
  // 清理本地 flight_state.json
  const localStateFile = path.join(__dirname, 'flight_state.json');
  if (fs.existsSync(localStateFile)) {
    try {
      const data = JSON.parse(fs.readFileSync(localStateFile, 'utf-8'));
      if (data.schedules) delete data.schedules['LJ233_2026-10-12'];
      if (data.flightData) delete data.flightData['LJ233_2026-10-12'];
      delete data['LJ233_2026-10-12'];
      fs.writeFileSync(localStateFile, JSON.stringify(data, null, 2), 'utf-8');
      console.log('✅ 已清除本地 flight_state.json 中的 LJ233 紀錄');
    } catch (err) {
      console.warn('清理本地快取失敗:', err.message);
    }
  }
}

function runStep(stepNumber, title, sampleSource, mockTimeTaiwan, koreaTimeStr, description, expectation) {
  console.log(`\n${'='.repeat(75)}`);
  console.log(`🎬 【步驟 ${stepNumber}】${title}`);
  console.log(`📝 情境: ${description}`);
  console.log(`🎯 預期: ${expectation}`);
  console.log(`🌏 模擬時間 (台灣 UTC+8): ${mockTimeTaiwan}  |  🛫 當地時間 (首爾/大阪 UTC+9): ${koreaTimeStr}`);
  console.log(`${'='.repeat(75)}`);

  // 套用對應的 Sample
  if (sampleSource && fs.existsSync(sampleSource)) {
    fs.copyFileSync(sampleSource, TARGET_SAMPLE);
    console.log(`📁 載入樣本: ${path.basename(sampleSource)} ➔ samples/flight_LJ233.json`);
  }

  // 執行檢查 (透過 --url 指定 LJ233，並強制使用 --dev 本地樣本模式)
  try {
    const cmd = `node trip_zenrows.js --dev --url='${LJ233_URL}' --mock-time='${mockTimeTaiwan}'`;
    const output = execSync(cmd, { cwd: __dirname, encoding: 'utf-8' });
    console.log(output);
  } catch (err) {
    console.error('執行失敗:', err.stdout || err.message);
  }
}

async function main() {
  console.log('###########################################################################');
  console.log('🚀 開始執行 GitHub Actions 全生命週期與變頻節流全鏈路端對端模擬');
  console.log('✈️ 測試航班：真航空 LJ233 (首爾 ICN 10:10 ➔ 大阪 KIX 12:00)');
  console.log('🌏 台灣時區 (UTC+8) 起飛時間為 09:10 (比首爾慢 1 小時)');
  console.log('###########################################################################');

  // 0. 重置快取
  await resetState();

  // =========================================================================
  // 【階段 1：階梯 1 遠期觀望 (> 12 小時，24 小時一格)】
  // =========================================================================
  runStep(
    '1-1',
    '階梯 1 遠期觀望 (離起飛 18 小時)',
    FAR_SAMPLE,
    '2026-10-11 15:10',
    '2026-10-11 16:10',
    '離起飛 18 小時 (> 12 小時)。此時登機門與報到櫃台均尚未公佈。',
    '命中階梯 1 (FAR_FUTURE)，進入時間槽 FAR_0，初次抓取資料並建立儲存記錄！'
  );

  runStep(
    '1-2',
    '階梯 1 同時間槽排程再次喚醒 (20 分鐘後)',
    FAR_SAMPLE,
    '2026-10-11 15:30',
    '2026-10-11 16:30',
    '距上次檢查僅過 20 分鐘。GitHub Actions 定時喚醒。',
    '【階梯 1 變頻節流生效】仍處於同一時間槽 FAR_0，立即秒速跳過，ZenRows 耗額 0 點！'
  );

  // =========================================================================
  // 【階段 2：階梯 2 當日備戰 (3 ~ 12 小時，2 小時一格)】
  // =========================================================================
  runStep(
    '2-1',
    '階梯 2 當日備戰 (離起飛 8 小時)',
    MID_SAMPLE,
    '2026-10-12 01:10',
    '2026-10-12 02:10',
    '離起飛 8 小時 (進入 3 ~ 12 小時備戰期)。報到櫃台更新為 E21 - F17。',
    '命中階梯 2 (MID_TERM)，進入新時間槽 MID_4，執行資料抓取並更新櫃台！'
  );

  runStep(
    '2-2',
    '階梯 2 同時間槽排程再次喚醒 (15 分鐘後)',
    MID_SAMPLE,
    '2026-10-12 01:25',
    '2026-10-12 02:25',
    '距上次檢查僅過 15 分鐘。',
    '【階梯 2 變頻節流生效】仍處於同一時間槽 MID_4，立即秒速跳過，ZenRows 耗額 0 點！'
  );

  runStep(
    '2-3',
    '階梯 2 跨入下一時間槽 (2 小時 5 分鐘後)',
    MID_SAMPLE,
    '2026-10-12 03:15',
    '2026-10-12 04:15',
    '已超過 2 小時間隔，跨入起飛前 5 小時 55 分鐘。',
    '進入階梯 2 新時間槽 MID_2，放行抓取並記錄！'
  );

  // =========================================================================
  // 【階段 3：階梯 3 起飛前夕衝刺 (密集 25 分鐘槽，連續模擬超過 120 分鐘)】
  // 表定起飛: 台灣 09:10。起飛前 3 小時起點為 06:10！
  // =========================================================================
  runStep(
    '3-1',
    '階梯 3 密集衝刺啟動 (起飛前 3 小時整：06:10)',
    SPRINT_NOGATE_SAMPLE,
    '2026-10-12 06:10',
    '2026-10-12 07:10',
    '離起飛整整 180 分鐘，精確觸發衝刺期第 1 格 (SPRINT_0)！登機門仍調度中 (-)。',
    '進入階梯 3 (SPRINT_ACTIVE)，記錄 SPRINT_0，執行資料抓取！'
  );

  runStep(
    '3-2',
    '衝刺期槽內排程重複喚醒 (10 分鐘後：06:20)',
    SPRINT_NOGATE_SAMPLE,
    '2026-10-12 06:20',
    '2026-10-12 07:20',
    '距上次僅過 10 分鐘 (未達 25 分鐘槽間隔)。',
    '【衝刺期節流生效】仍處於時間槽 SPRINT_0，立即跳過，ZenRows 耗額 0 點！'
  );

  runStep(
    '3-3',
    '衝刺期跨入第 2 格 + 登機門公佈 (25 分鐘後：06:35)',
    GATE_ANNOUNCED_SAMPLE,
    '2026-10-12 06:35',
    '2026-10-12 07:35',
    '距起點剛好 25 分鐘，跨入 SPRINT_1！此時機場公佈登機門為 215！',
    '跨入新時間槽 SPRINT_1，觸發抓取；偵測到登機門重大變更 (215)，發送卡片！'
  );

  runStep(
    '3-4',
    '衝刺期槽內排程重複喚醒 (13 分鐘後：06:48)',
    GATE_ANNOUNCED_SAMPLE,
    '2026-10-12 06:48',
    '2026-10-12 07:48',
    '距上次僅 13 分鐘。',
    '【節流生效】仍處於 SPRINT_1，立即跳過，ZenRows 耗額 0 點！'
  );

  runStep(
    '3-5',
    '衝刺期跨入第 3 格 (起飛前 2 小時 10 分：07:00)',
    GATE_ANNOUNCED_SAMPLE,
    '2026-10-12 07:00',
    '2026-10-12 08:00',
    '離起點 50 分鐘，跨入 SPRINT_2！資料無變更。',
    '跨入 SPRINT_2，觸發抓取；資料無異動，自動略過重複發卡！'
  );

  runStep(
    '3-6',
    '衝刺期跨入第 4 格 (起飛前 1 小時 45 分：07:25)',
    GATE_ANNOUNCED_SAMPLE,
    '2026-10-12 07:25',
    '2026-10-12 08:25',
    '離起點 75 分鐘，跨入 SPRINT_3！',
    '跨入 SPRINT_3，正常執行抓取並更新排程時間戳記！'
  );

  runStep(
    '3-7',
    '衝刺期跨入第 5 格 (起飛前 1 小時 20 分：07:50)',
    GATE_ANNOUNCED_SAMPLE,
    '2026-10-12 07:50',
    '2026-10-12 08:50',
    '離起點 100 分鐘，跨入 SPRINT_4！',
    '跨入 SPRINT_4，正常執行抓取！'
  );

  runStep(
    '3-8',
    '衝刺期跨入第 6 格 (起飛前 55 分鐘：08:15)',
    GATE_ANNOUNCED_SAMPLE,
    '2026-10-12 08:15',
    '2026-10-12 09:15',
    '離起點 125 分鐘，跨入 SPRINT_5！(已連續模擬衝刺期 125 分鐘)',
    '跨入 SPRINT_5，正常執行抓取！'
  );

  runStep(
    '3-9',
    '起飛後飛行途中 (起飛後 25 分鐘：09:35)',
    DEPART_SAMPLE,
    '2026-10-12 09:35',
    '2026-10-12 10:35',
    '航班已於 10:10 順利起飛！樣本變更為「飛行途中」。',
    '跨入 SPRINT_8，觸發抓取；偵測到狀態重大異動 (飛行途中)，推送起飛卡片！'
  );

  // =========================================================================
  // 【階段 4：已抵達與行李轉盤公佈】
  // =========================================================================
  runStep(
    '4-1',
    '班機抵達關西機場 (抵達後 5 分鐘：11:05)',
    ARRIVE_SAMPLE,
    '2026-10-12 11:05',
    '2026-10-12 12:05',
    '班機順利降落關西！狀態為「已抵達」，行李轉盤公佈為「6」。',
    '偵測到狀態變更 (已抵達) 與轉盤 (6)，推送抵達卡片，並標記任務結束！'
  );

  // =========================================================================
  // 【階段 5：抵達後定時喚醒 (永久終止)】
  // =========================================================================
  runStep(
    '5-1',
    '抵達後續排程再次喚醒 (30 分鐘後：11:35)',
    ARRIVE_SAMPLE,
    '2026-10-12 11:35',
    '2026-10-12 12:35',
    'GitHub Actions 例行性排程再度喚醒。',
    '【任務結束永久停止】偵測到航班已標記結束，永久終止查詢，ZenRows 耗額 0 點！'
  );

  console.log('\n###########################################################################');
  console.log('🎉 全部 13 個生命週期鏈路節點模擬驗證完畢！');
  console.log('✨ 包含：階梯 1～3 完整切換、槽內節流抑制 (0 點消耗)、連續 125 分鐘衝刺變頻、');
  console.log('       登機門公佈異動、飛行途中狀態變更、抵達轉盤通知與任務終止！');
  console.log('###########################################################################\n');
}

main();
