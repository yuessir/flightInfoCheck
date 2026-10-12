/**
 * FlightDiffDetector (Single Responsibility Principle)
 * 專責比對兩次航班資訊的核心關鍵欄位是否產生有意義的變更。
 * 避免在資料無變化時重複向 LINE 群組發送一模一樣的卡片。
 */

class FlightDiffDetector {
  /**
   * 檢查航班是否產生重要資訊變更
   * @param {object} previousData 上次抓取的 flightPayload
   * @param {object} currentData 本次抓取的 flightPayload
   * @returns {object} { hasChanged: boolean, changes: string[] }
   */
  static detect(previousData, currentData) {
    if (!previousData) {
      // 第一次抓取，視同有變更 (初始通知)
      return {
        hasChanged: true,
        changes: ['[初始狀態紀錄]']
      };
    }

    const changes = [];

    // 1. 航班狀態或狀態敘述變更 (例如: Plan -> Departed, 準點 -> 延誤 30 分鐘)
    if (previousData.status !== currentData.status) {
      changes.push(`航班狀態變更: ${previousData.status || '-'} ➔ ${currentData.status || '-'}`);
    }
    if (previousData.statusContent !== currentData.statusContent) {
      changes.push(`狀態說明更新: ${previousData.statusContent || '-'} ➔ ${currentData.statusContent || '-'}`);
    }

    // 2. 登機門變更 (常在起飛前 2 小時公佈或更換)
    const prevGate = previousData.gate?.value || '-';
    const currGate = currentData.gate?.value || '-';
    if (prevGate !== currGate && currGate !== '-') {
      changes.push(`登機門分配/更換: ${prevGate} ➔ ${currGate}`);
    }

    // 3. 行李轉盤變更 (常在抵達前公佈)
    const prevBaggage = previousData.baggage?.value || '-';
    const currBaggage = currentData.baggage?.value || '-';
    if (prevBaggage !== currBaggage && currBaggage !== '-') {
      changes.push(`行李轉盤公佈: ${prevBaggage} ➔ ${currBaggage}`);
    }

    // 4. 報到櫃台變更
    const prevCheckIn = previousData.checkIn?.value || '-';
    const currCheckIn = currentData.checkIn?.value || '-';
    if (prevCheckIn !== currCheckIn && currCheckIn !== '-') {
      changes.push(`報到櫃台公佈: ${prevCheckIn} ➔ ${currCheckIn}`);
    }

    // 5. 實際出發/抵達時間變更
    const prevDepTime = previousData.departInfo?.actualTime || '';
    const currDepTime = currentData.departInfo?.actualTime || '';
    if (prevDepTime !== currDepTime && currDepTime) {
      changes.push(`出發時間更新: ${prevDepTime || '未定'} ➔ ${currDepTime}`);
    }

    const prevArrTime = previousData.arrivalInfo?.actualTime || '';
    const currArrTime = currentData.arrivalInfo?.actualTime || '';
    if (prevArrTime !== currArrTime && currArrTime) {
      changes.push(`抵達時間更新: ${prevArrTime || '未定'} ➔ ${currArrTime}`);
    }

    return {
      hasChanged: changes.length > 0,
      changes
    };
  }
}

module.exports = FlightDiffDetector;
