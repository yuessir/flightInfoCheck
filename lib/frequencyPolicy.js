/**
 * FrequencyPolicy (Single Responsibility + Open/Closed Principle)
 * 專責航班動態變頻節流規則評估 (採用時間槽 Slot-based 演算法)。
 * 
 * 核心機制：
 * 以航班固定的 departureTime (起飛時間) 為錨點，劃分固定的時間格子 (Slots)：
 * 1. 階梯 3 (起飛前 3 小時至飛行中)：以 25 分鐘為一格 (SPRINT_0, SPRINT_1, SPRINT_2...)
 * 2. 階梯 2 (起飛前 3 ~ 12 小時)：以 2 小時為一格 (MID_0, MID_1...)
 * 3. 階梯 1 (起飛前 > 12 小時)：以 24 小時為一格 (FAR_0, FAR_1...)
 * 
 * 規則：每個時間槽 (Slot)，只准執行 1 次檢查。
 * 徹底解決滑動時間差漂移、手動查詢干擾以及排程採樣落差問題！
 */

class FrequencyPolicy {
  constructor(customConfig = {}) {
    this.sprintIntervalMinutes = customConfig.sprintIntervalMinutes || 25; // 衝刺期 25 分鐘一格
    this.midIntervalMinutes = customConfig.midIntervalMinutes || 120;     // 備戰期 2 小時一格
    this.farIntervalMinutes = customConfig.farIntervalMinutes || 1440;    // 遠期 24 小時一格
  }

  /**
   * 評估特定航班當前是否應該執行爬取
   * 
   * @param {object} params
   * @param {Date} params.departureTime 預定起飛時間
   * @param {Date} params.currentTime 當前時間 (支援外部傳入模擬時間)
   * @param {object|null} params.schedule 該航班排程控制資料 (含 lastSlot, lastCheckedAt, isFinished)
   * @param {object|null} params.flightData 該航班業務資料 (含 status, gate, baggage 等)
   * @param {boolean} params.force 是否強制執行 (忽略節流)
   * @returns {object} { shouldFetch: boolean, tier: string, tierName: string, reason: string, currentSlot: string }
   */
  evaluate({ departureTime, currentTime = new Date(), schedule = null, flightData = null, force = false }) {
    if (force) {
      return {
        shouldFetch: true,
        tier: 'FORCE_OVERRIDE',
        tierName: '手動強制執行',
        reason: '手動強制執行模式 (--force)，略過時間槽節流',
        currentSlot: 'FORCE'
      };
    }

    // 1. 最高優先級：已抵達或已標記結束
    const isFinished = Boolean(
      schedule?.isFinished || 
      ['arrived', '到達', '抵達', '已抵達', '已到達'].some(s => String(flightData?.status || '').toLowerCase().includes(s)) ||
      ['arrived', '到達', '抵達', '已抵達', '已到達'].some(s => String(schedule?.status || '').toLowerCase().includes(s))
    );

    if (isFinished) {
      return {
        shouldFetch: false,
        tier: 'FINISHED_OR_ARRIVED',
        tierName: '航班已抵達 (任務結束)',
        reason: '航班狀態為「已抵達 (Arrived)」，永久停止查詢，不再消耗任何額度！',
        currentSlot: 'FINISHED'
      };
    }

    if (!departureTime || isNaN(departureTime.getTime())) {
      return {
        shouldFetch: true,
        tier: 'UNKNOWN_TIME',
        tierName: '未知起飛時間',
        reason: '網址無精確時間資訊，預設進行抓取',
        currentSlot: 'UNKNOWN'
      };
    }

    // 計算離起飛的差距 (分鐘)
    const diffMs = departureTime.getTime() - currentTime.getTime();
    const diffMinutes = Math.floor(diffMs / (60 * 1000));
    const diffHours = diffMinutes / 60;

    // 2. 超過預計抵達時間過久 (起飛 4 小時後未標記)
    if (diffMinutes < -240) {
      return {
        shouldFetch: false,
        tier: 'EXPIRED_PAST',
        tierName: '逾期結束',
        reason: '已超過預計起飛時間 4 小時以上，視同已結束，停止自動查詢',
        currentSlot: 'EXPIRED'
      };
    }

    let tierId = '';
    let tierName = '';
    let slotKey = '';

    // 3. 階梯 3：起飛前夕衝刺 (起飛前 3 小時至飛行中，180 分鐘至 -240 分鐘)
    if (diffMinutes <= 180 && diffMinutes >= -240) {
      tierId = 'SPRINT_ACTIVE';
      tierName = '階梯 3：起飛前夕衝刺 (3 小時內至飛行中)';
      // 以起飛前 3 小時 (180 分鐘) 為基準起點，每 25 分鐘劃分一格 (例如 09:25 -> 09:50 -> 10:15...)
      const minutesFromSprintStart = 180 - diffMinutes;
      const slotIndex = Math.floor(minutesFromSprintStart / this.sprintIntervalMinutes);
      slotKey = `SPRINT_${slotIndex}`;
    }
    // 4. 階梯 2：當日備戰 (起飛前 3 ~ 12 小時，180 ~ 720 分鐘)
    else if (diffMinutes > 180 && diffMinutes <= 720) {
      tierId = 'MID_TERM';
      tierName = '階梯 2：當日備戰 (3 ~ 12 小時)';
      const slotIndex = Math.floor(diffMinutes / this.midIntervalMinutes);
      slotKey = `MID_${slotIndex}`;
    }
    // 5. 階梯 1：遠期觀望 (離起飛 > 12 小時，> 720 分鐘)
    else {
      tierId = 'FAR_FUTURE';
      tierName = '階梯 1：遠期觀望 (> 12 小時)';
      const slotIndex = Math.floor(diffMinutes / this.farIntervalMinutes);
      slotKey = `FAR_${slotIndex}`;
    }

    // 6. 時間槽 (Slot) 判定：若該時間槽已經查過，則略過；若未查過，則執行！
    if (schedule && schedule.lastSlot === slotKey) {
      return {
        shouldFetch: false,
        tier: tierId,
        tierName,
        reason: `[${tierName}] 當前時間槽 [${slotKey}] 已於先前執行過檢查，跳過！`,
        currentSlot: slotKey,
        diffHours
      };
    }

    return {
      shouldFetch: true,
      tier: tierId,
      tierName,
      reason: `[${tierName}] 進入新的時間槽 [${slotKey}]，執行資料抓取！`,
      currentSlot: slotKey,
      diffHours
    };
  }
}

module.exports = {
  FrequencyPolicy
};
