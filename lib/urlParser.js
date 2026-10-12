// 機場時區映射 (依出發機場 dcode 自動決定時區偏移)
function getAirportTimezoneOffset(airportCode) {
  const code = (airportCode || '').toUpperCase();
  // 韓國與日本 (UTC+9)
  const UTC_9 = ['ICN', 'GMP', 'PUS', 'CJU', 'KIX', 'NRT', 'HND', 'FUK', 'CTS', 'OKA', 'NGO', 'KOJ'];
  if (UTC_9.includes(code)) return '+09:00';

  // 泰國、越南 (UTC+7)
  const UTC_7 = ['BKK', 'DMK', 'CNX', 'HKT', 'SGN', 'HAN', 'DAD'];
  if (UTC_7.includes(code)) return '+07:00';

  // 台灣 (TPE, KHH, TSA)、香港 (HKG)、澳門 (MFM)、新馬、中國 (UTC+8)
  return '+08:00';
}

class FlightUrlParser {
  /**
   * 解析 Trip.com 航班 URL
   * @param {string} urlString 
   * @returns {object} 解析結果
   */
  static parse(urlString) {
    if (!urlString || typeof urlString !== 'string') {
      throw new Error('Invalid URL string provided to FlightUrlParser');
    }

    try {
      const url = new URL(urlString);
      const params = url.searchParams;

      // 提取參數
      const flightNo = (params.get('flightNo') || '').trim().toUpperCase();
      const queryDate = params.get('queryDate') || ''; // 格式: YYYY-MM-DD
      const queryTime = params.get('queryTime') || '12:00:00'; // 格式: HH:mm:ss 或預設
      const dcode = (params.get('dcode') || '').toUpperCase();
      const acode = (params.get('acode') || '').toUpperCase();

      // 計算預定起飛時間（自動依出發機場時區建立全球唯一 Date 物件）
      let departureTime = null;
      let timezoneOffset = '+08:00';
      if (queryDate) {
        timezoneOffset = getAirportTimezoneOffset(dcode);
        const timePart = queryTime.length === 5 ? `${queryTime}:00` : queryTime;
        departureTime = new Date(`${queryDate}T${timePart}${timezoneOffset}`);
      }

      const flightKey = flightNo && queryDate ? `${flightNo}_${queryDate}` : (flightNo || 'UNKNOWN_FLIGHT');

      return {
        flightNo,
        queryDate,
        queryTime,
        dcode,
        acode,
        timezoneOffset,
        departureTime,
        flightKey,
        rawUrl: urlString
      };
    } catch (err) {
      throw new Error(`無法解析航班網址: ${err.message}`);
    }
  }
}

module.exports = FlightUrlParser;
