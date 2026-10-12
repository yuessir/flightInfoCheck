require('dotenv').config();
const axios = require('axios');
const fs = require('fs');
const path = require('path');
const buildFlightFlex = require('./flightFlex');

// 載入 SOLID 模組架構
const FlightUrlParser = require('./lib/urlParser');
const { FrequencyPolicy } = require('./lib/frequencyPolicy');
const { createStateStore } = require('./lib/stateStore');
const FlightDiffDetector = require('./lib/diffDetector');

// CLI 參數解析
const args = process.argv.slice(2);
const isProd = args.includes('--prod');
const isForce = args.includes('--force');
const isWatch = args.includes('--watch') || args.includes('--loop');
const isDev = !isProd && (process.env.DEV_MODE === 'true' || args.includes('--dev') || args.includes('--sample') || args.includes('--mock'));

// 解析 --interval=<seconds>
const intervalArg = args.find(a => a.startsWith('--interval='));
const watchIntervalSeconds = intervalArg ? parseInt(intervalArg.split('=')[1], 10) : 30;

// 解析 --url=<url> (支援單一航班直接指定)
const urlArg = args.find(a => a.startsWith('--url='));
const targetSingleUrl = urlArg ? urlArg.slice(urlArg.indexOf('=') + 1).replace(/^['"]|['"]$/g, '').trim() : null;

// 解析 --mock-time="YYYY-MM-DD HH:mm" (時空模擬測試核心)
const mockTimeArg = args.find(a => a.startsWith('--mock-time=') || a.startsWith('--mock='));
let mockTime = null;
if (mockTimeArg) {
  const timeStr = mockTimeArg.split('=')[1].replace(/['"]/g, '').trim();
  mockTime = new Date(timeStr.includes('+') || timeStr.includes('Z') ? timeStr : `${timeStr}+08:00`);
  if (isNaN(mockTime.getTime())) {
    console.error(`❌ 無效的 --mock-time 格式: ${timeStr}，請使用如 "2026-10-16 13:30"`);
    process.exit(1);
  }
}

const ZENROWS_API_KEY = process.env.ZENROWS_API_KEY || (args[0] && !args[0].startsWith('--') ? args[0] : null);
const LINE_BOT_ENDPOINT = process.env.LINE_BOT_ENDPOINT;

// 初始化 SOLID 服務實例 (可依需求注入或置換)
const frequencyPolicy = new FrequencyPolicy();
const stateStore = createStateStore();

// 多航班樣本資料夾
const SAMPLES_DIR = path.join(__dirname, 'samples');
if (!fs.existsSync(SAMPLES_DIR)) {
  fs.mkdirSync(SAMPLES_DIR, { recursive: true });
}
const legacyDefaultSample = path.join(__dirname, 'zenrows_next_data.json');
const sample7C = path.join(SAMPLES_DIR, 'flight_7C1353.json');
if (!fs.existsSync(sample7C) && fs.existsSync(legacyDefaultSample)) {
  try { fs.copyFileSync(legacyDefaultSample, sample7C); } catch (_) {}
}

const urlsFilePath = path.join(__dirname, 'flight', 'from_urls.txt');

if (!isDev && !ZENROWS_API_KEY) {
  console.error("❌ 缺少 ZenRows API Key！");
  console.error("請在 .env 中設定 ZENROWS_API_KEY，或以參數傳入：node trip_zenrows.js <YOUR_API_KEY>");
  console.error("💡 提示：若要在開發模式下測試（讀取本地 Sample），可設定 DEV_MODE=true 或加上 --dev 參數。");
  process.exit(1);
}

/**
 * 處理單一航班的排程檢查與爬取流程
 */
async function processFlight(targetUrl, index, total, currentTime) {
  let parsed;
  try {
    parsed = FlightUrlParser.parse(targetUrl);
  } catch (err) {
    console.error(`❌ 網址解析失敗 [${targetUrl}]:`, err.message);
    return;
  }

  const { flightNo, departureTime, flightKey, queryDate, queryTime } = parsed;

  console.log(`\n==================== [${index}/${total}] 航班檢查: ${flightKey} ====================`);
  console.log(`📍 航班代號: ${flightNo || '未知'} | 預定起飛: ${queryDate} ${queryTime}`);
  console.log(`⏱️ 當前比對時間: ${currentTime.toLocaleString('zh-TW', { timeZone: 'Asia/Taipei' })}${mockTime ? ' 🧪[時空模擬中]' : ''}`);

  // 1. 取得該航班儲存的歷史排程控制與業務資料 (方案二：職責分離)
  const schedule = await stateStore.getSchedule(flightKey);
  const flightDataPrev = await stateStore.getFlightData(flightKey);

  if (schedule) {
    const lastCheckStr = schedule.lastCheckedAt ? new Date(schedule.lastCheckedAt).toLocaleString('zh-TW', { timeZone: 'Asia/Taipei' }) : '無';
    console.log(`📜 排程狀態紀錄: 時間槽=[${schedule.lastSlot || '無'}] | 上次查詢=[${lastCheckStr}] | 已結束=[${schedule.isFinished ? '是' : '否'}]`);
  }
  if (flightDataPrev) {
    console.log(`🏢 業務資料紀錄: 狀態=[${flightDataPrev.status || '未定'}] | 登機門=[${flightDataPrev.gate?.value || '-'}] | 轉盤=[${flightDataPrev.baggage?.value || '-'}]`);
  }

  // 2. 變頻時間槽守門員判定 (Slot-based Frequency Policy)
  const decision = frequencyPolicy.evaluate({
    departureTime,
    currentTime,
    schedule,
    flightData: flightDataPrev,
    force: isForce
  });

  if (!decision.shouldFetch) {
    console.log(`⏩ ==================== [變頻節流生效：跳過] ====================`);
    console.log(`🛡️  所屬階梯: ${decision.tierName || decision.tier}`);
    console.log(`💡 原因說明: ${decision.reason}`);
    console.log(`💰 ZenRows 額度消耗: 0 點 (成功保護額度)`);
    console.log(`==================================================================\n`);
    return;
  }

  console.log(`🎯 命中規則: ${decision.tierName || decision.tier} -> 進行資料抓取！`);

  // 3. 執行資料爬取 (開發模式讀 Sample，正式模式呼叫 ZenRows)
  try {
    let nextData;

    if (isDev) {
      let sampleFile = null;
      let sampleSourceDesc = '';

      if (flightNo) {
        const candidate = path.join(SAMPLES_DIR, `flight_${flightNo}.json`);
        if (fs.existsSync(candidate)) {
          sampleFile = candidate;
          sampleSourceDesc = `專屬樣本 (samples/flight_${flightNo}.json)`;
        }
      }

      if (!sampleFile && fs.existsSync(legacyDefaultSample)) {
        sampleFile = legacyDefaultSample;
        sampleSourceDesc = `共用預設樣本 (zenrows_next_data.json)`;
      }

      if (!sampleFile) {
        console.error(`❌ 找不到任何可用的樣本檔案！請確認 samples/ 目錄是否包含資料。`);
        return;
      }

      console.log(`💡 [開發模式] 略過商業 API，讀取: ${sampleSourceDesc}`);
      const rawSample = fs.readFileSync(sampleFile, 'utf-8');
      if (rawSample.trim().startsWith('{')) {
        nextData = JSON.parse(rawSample);
      } else {
        const match = rawSample.match(/<script id="__NEXT_DATA__" type="application\/json"[^>]*>([\s\S]*?)<\/script>/);
        if (!match) {
          console.warn("⚠️ 樣本檔案中未找到 __NEXT_DATA__ 標籤");
          return;
        }
        nextData = JSON.parse(match[1]);
      }

      if (flightNo && sampleFile === legacyDefaultSample) {
        nextData = JSON.parse(JSON.stringify(nextData));
        if (nextData?.props?.pageProps) {
          if (!nextData.props.pageProps.query) nextData.props.pageProps.query = {};
          nextData.props.pageProps.query.flightNo = flightNo;
        }
      }
    } else {
      console.log("🚀 正在透過 ZenRows 請求 Trip.com 頁面...");
      const startTime = Date.now();
      const response = await axios.get('https://api.zenrows.com/v1/', {
        params: {
          apikey: ZENROWS_API_KEY,
          url: targetUrl,
          js_render: 'true',
          antibot: 'true',
        },
        timeout: 60000
      });

      console.log(`✅ ZenRows 抓取完成！耗時: ${((Date.now() - startTime) / 1000).toFixed(2)} 秒\n`);

      const html = response.data;
      const match = html.match(/<script id="__NEXT_DATA__" type="application\/json"[^>]*>([\s\S]*?)<\/script>/);

      if (!match) {
        console.warn("⚠️ 未找到 __NEXT_DATA__ 標籤，可能頁面尚未渲染完成或遭遇驗證碼。");
        return;
      }

      nextData = JSON.parse(match[1]);

      // 正式抓取成功時獨立儲存專屬樣本
      try {
        const cleanFlightNo = String(flightNo || `FLIGHT_${index}`).replace(/[^a-zA-Z0-9_-]/g, '').toUpperCase();
        const flightSamplePath = path.join(SAMPLES_DIR, `flight_${cleanFlightNo}.json`);
        fs.writeFileSync(flightSamplePath, JSON.stringify(nextData, null, 2), 'utf-8');
        fs.writeFileSync(legacyDefaultSample, JSON.stringify(nextData, null, 2), 'utf-8');
      } catch (saveErr) {
        console.warn("⚠️ 儲存樣本檔案失敗:", saveErr.message);
      }
    }

    const pageProps = nextData?.props?.pageProps;
    const flightData = pageProps?.flightVarDetailSearchServiceData;
    const res = flightData?.res;
    const card = res?.flightStatusCard;
    const statusInfo = card?.statusInfo;
    const flightInfo = card?.flightInfo;
    const coreInfos = card?.coreInfos || [];

    if (flightData?.successFetch && (statusInfo || flightInfo)) {
      console.log("🎉 航班資訊解析成功！狀態:", statusInfo?.status, statusInfo?.content ? `(${statusInfo.content})` : '');

      const checkInItem = coreInfos.find(i => i.type === 'CheckInCounter' || i.title === '辦理登機');
      const gateItem = coreInfos.find(i => i.type === 'BoardingGate' || i.title === '登機門');
      const baggageItem = coreInfos.find(i => i.type === 'Baggage' || i.title === '行李');

      const flightPayload = {
        flightNo: pageProps?.query?.flightNo || res?.topInfo?.itineraryInfo?.flightNo || flightNo || '未知航班',
        airlineName: res?.topInfo?.itineraryInfo?.airlineName || '',
        status: statusInfo?.status || '',
        statusContent: statusInfo?.content || '',
        departInfo: {
          airport: flightInfo?.departInfo?.airportShortName || '',
          terminal: flightInfo?.departInfo?.terminal || '',
          plannedTime: flightInfo?.departInfo?.plannedTime || '',
          actualTime: flightInfo?.departInfo?.time || '',
        },
        arrivalInfo: {
          airport: flightInfo?.arrivalInfo?.airportShortName || '',
          terminal: flightInfo?.arrivalInfo?.terminal || '',
          plannedTime: flightInfo?.arrivalInfo?.plannedTime || '',
          actualTime: flightInfo?.arrivalInfo?.time || '',
        },
        checkIn: {
          value: checkInItem?.value || '-',
          secondary: checkInItem?.secondaryInfo?.map(s => s.text).join(' / ') || '',
        },
        gate: {
          value: gateItem?.value || '-',
        },
        baggage: {
          value: baggageItem?.value || '-',
        },
        rawText: `航班狀態: ${statusInfo?.status || ''} (${statusInfo?.content || ''})\n出發: ${flightInfo?.departInfo?.airportShortName || ''} | 抵達: ${flightInfo?.arrivalInfo?.airportShortName || ''}`
      };

      // 4. 異動偵測 (FlightDiffDetector: 比對上次業務資料與最新資料)
      const diffResult = FlightDiffDetector.detect(flightDataPrev, flightPayload);
      const isFinished = ['arrived', '到達', '抵達', '已抵達', '已到達'].some(s => String(statusInfo?.status || '').toLowerCase().includes(s));

      // 5. 分開儲存 (方案二：業務資料層 vs 排程控制層)
      // 5-1. 儲存業務資料層 (flight:data:<flightKey>)
      await stateStore.saveFlightData(flightKey, flightPayload);
      console.log(`💾 [業務資料層] 已更新航班資訊 (flight:data:${flightKey})`);

      // 5-2. 儲存排程控制層 (flight:schedule:<flightKey>)
      await stateStore.saveSchedule(flightKey, {
        flightNo,
        lastSlot: decision.currentSlot,
        lastCheckedAt: currentTime.getTime(),
        isFinished
      });
      console.log(`💾 [排程控制層] 已記錄時間槽 [${decision.currentSlot}] (flight:schedule:${flightKey})。任務結束: ${isFinished ? '✅ 是' : '❌ 否'}`);

      // 6. 依據是否異動決定發送 LINE 卡片
      if (diffResult.hasChanged) {
        console.log(`📢 偵測到航班重要變更: ${diffResult.changes.join(' | ')}`);
        if (LINE_BOT_ENDPOINT) {
          console.log(`📤 正在傳送至 LINE BOT: ${LINE_BOT_ENDPOINT}...`);
          try {
            const flexCard = buildFlightFlex(flightPayload);
            const notifyRes = await axios.post(LINE_BOT_ENDPOINT, {
              messages: [flexCard],
              type: 'flight'
            }, { timeout: 15000 });
            console.log(`✅ LINE BOT 推播回應成功:`, notifyRes.data);
          } catch (notifyErr) {
            console.error(`❌ LINE BOT 推播失敗:`, notifyErr.response ? notifyErr.response.data : notifyErr.message);
          }
        } else {
          console.log("ℹ️ 未設定 LINE_BOT_ENDPOINT，略過推播。");
        }
      } else {
        console.log(`ℹ️ [狀態無異動] 航班資料與前次完全一致，自動略過發送重複 LINE 卡片！`);
      }
    } else {
      console.log("⚠️ 未能取得該航班動態詳細資料。");
    }

  } catch (error) {
    if (error.response) {
      console.error(`❌ ZenRows 請求失敗 [HTTP ${error.response.status}]:`, error.response.data);
    } else {
      console.error("❌ 執行發生錯誤:", error.message);
    }
  }
}

/**
 * 執行一輪完整檢查
 */
async function runCheckRound() {
  let urls = [];
  if (targetSingleUrl) {
    urls = [targetSingleUrl];
  } else {
    if (!fs.existsSync(urlsFilePath)) {
      console.error(`❌ 找不到檔案: ${urlsFilePath}`);
      process.exit(1);
    }

    const content = fs.readFileSync(urlsFilePath, 'utf-8');
    urls = content
      .split(/\r?\n/)
      .map(line => line.trim())
      .filter(line => line && !line.startsWith('#') && line.startsWith('http'));
  }

  if (urls.length === 0) {
    console.warn(`⚠️ 查無有效的航班網址！`);
    return;
  }

  const currentTime = mockTime || new Date();

  console.log("\n============================================================");
  console.log(`🛫 航班動態檢查任務啟動 | 檢查時間: ${currentTime.toLocaleString('zh-TW', { timeZone: 'Asia/Taipei' })}`);
  if (mockTime) console.log(`🧪 [時空模擬模式已啟用]: ${mockTime.toISOString()}`);
  if (isDev) console.log(`🛠️  [本地樣本模式]: 不消耗 ZenRows 商業額度`);
  console.log("============================================================");

  for (let i = 0; i < urls.length; i++) {
    await processFlight(urls[i], i + 1, urls.length, currentTime);
    if (i < urls.length - 1) {
      await new Promise(resolve => setTimeout(resolve, 500));
    }
  }

  console.log(`🎉 本輪檢查完成！[${currentTime.toLocaleTimeString('zh-TW', { timeZone: 'Asia/Taipei' })}]\n`);
}

/**
 * 主程式入口
 */
async function main() {
  if (isWatch) {
    console.log(`⏰ [本地 CRON 循環模擬模式] 已啟動！每隔 ${watchIntervalSeconds} 秒自動檢查一次... (按 Ctrl+C 可結束)`);
    await runCheckRound();
    setInterval(async () => {
      await runCheckRound();
    }, watchIntervalSeconds * 1000);
  } else {
    await runCheckRound();
  }
}

main();
