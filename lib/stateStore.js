/**
 * StateStore (Dependency Inversion + Liskov Substitution Principle)
 * 專責航班狀態存取。
 * 遵循方案二：
 * 1. 業務資料層：flight:data:<flightKey> (乾淨的航班卡片資料：登機門、行李、狀態、時間)
 * 2. 排程控制層：flight:schedule:<flightKey> (排程時間槽 Slot、上次執行時間、isFinished)
 */

const fs = require('fs');
const path = require('path');
const { Redis } = require('@upstash/redis');

class BaseStateStore {
  async getSchedule(flightKey) { throw new Error('Not implemented'); }
  async saveSchedule(flightKey, scheduleData) { throw new Error('Not implemented'); }
  async getFlightData(flightKey) { throw new Error('Not implemented'); }
  async saveFlightData(flightKey, flightData) { throw new Error('Not implemented'); }
  async deleteFlight(flightKey) { throw new Error('Not implemented'); }
  async clearAll() { throw new Error('Not implemented'); }
}

class LocalFileStateStore extends BaseStateStore {
  constructor(filePath = path.join(__dirname, '../flight_state.json')) {
    super();
    this.filePath = filePath;
  }

  _readAll() {
    if (!fs.existsSync(this.filePath)) return { schedules: {}, flightData: {} };
    try {
      const data = JSON.parse(fs.readFileSync(this.filePath, 'utf-8'));
      if (!data.schedules) data.schedules = {};
      if (!data.flightData) data.flightData = {};
      return data;
    } catch (_) {
      return { schedules: {}, flightData: {} };
    }
  }

  _writeAll(data) {
    try {
      fs.writeFileSync(this.filePath, JSON.stringify(data, null, 2), 'utf-8');
    } catch (err) {
      console.warn(`[LocalFileStateStore] 寫入失敗:`, err.message);
    }
  }

  async getSchedule(flightKey) {
    const all = this._readAll();
    if (all.schedules?.[flightKey]) return all.schedules[flightKey];
    // 向後相容舊版平鋪格式
    if (all[flightKey]) {
      return {
        flightNo: all[flightKey].flightNo,
        lastSlot: all[flightKey].lastSlot || null,
        lastCheckedAt: all[flightKey].lastCheckedAt || null,
        isFinished: all[flightKey].isFinished || false
      };
    }
    return null;
  }

  async saveSchedule(flightKey, scheduleData) {
    const all = this._readAll();
    all.schedules[flightKey] = {
      ...all.schedules[flightKey],
      ...scheduleData,
      updatedAt: Date.now()
    };
    this._writeAll(all);
  }

  async getFlightData(flightKey) {
    const all = this._readAll();
    if (all.flightData?.[flightKey]) return all.flightData[flightKey];
    // 向後相容舊版平鋪格式
    if (all[flightKey]?.lastPayload) return all[flightKey].lastPayload;
    return null;
  }

  async saveFlightData(flightKey, flightData) {
    const all = this._readAll();
    all.flightData[flightKey] = {
      ...all.flightData[flightKey],
      ...flightData,
      updatedAt: Date.now()
    };
    this._writeAll(all);
  }

  async deleteFlight(flightKey) {
    const all = this._readAll();
    delete all.schedules[flightKey];
    delete all.flightData[flightKey];
    this._writeAll(all);
  }

  async clearAll() {
    this._writeAll({ schedules: {}, flightData: {} });
  }

  // 向後相容方法
  async getState(flightKey) {
    const s = await this.getSchedule(flightKey);
    const d = await this.getFlightData(flightKey);
    if (!s && !d) return null;
    return { ...d, ...s, lastPayload: d };
  }
}

class RedisStateStore extends BaseStateStore {
  constructor(redisClient = null) {
    super();
    this.schedulePrefix = 'flight:schedule:';
    this.dataPrefix = 'flight:data:';
    this.redis = redisClient || new Redis({
      url: process.env.UPSTASH_REDIS_REST_URL,
      token: process.env.UPSTASH_REDIS_REST_TOKEN,
    });
  }

  async getSchedule(flightKey) {
    try {
      let data = await this.redis.get(`${this.schedulePrefix}${flightKey}`);
      if (typeof data === 'string') {
        try { data = JSON.parse(data); } catch (_) {}
      }
      if (data) return data;

      // 向後相容：讀取舊版 flight:state:<flightKey>
      const legacy = await this.redis.get(`flight:state:${flightKey}`);
      if (legacy) {
        const leg = typeof legacy === 'string' ? JSON.parse(legacy) : legacy;
        return {
          flightNo: leg.flightNo,
          lastSlot: leg.lastSlot || null,
          lastCheckedAt: leg.lastCheckedAt || null,
          isFinished: leg.isFinished || false
        };
      }
      return null;
    } catch (err) {
      console.warn(`[RedisStateStore] 讀取排程 ${flightKey} 失敗:`, err.message);
      return null;
    }
  }

  async saveSchedule(flightKey, scheduleData) {
    try {
      const existing = (await this.getSchedule(flightKey)) || {};
      const merged = {
        ...existing,
        ...scheduleData,
        updatedAt: Date.now()
      };
      await this.redis.set(`${this.schedulePrefix}${flightKey}`, merged, { ex: 14 * 86400 });
    } catch (err) {
      console.warn(`[RedisStateStore] 儲存排程 ${flightKey} 失敗:`, err.message);
    }
  }

  async getFlightData(flightKey) {
    try {
      let data = await this.redis.get(`${this.dataPrefix}${flightKey}`);
      if (typeof data === 'string') {
        try { data = JSON.parse(data); } catch (_) {}
      }
      if (data) return data;

      // 向後相容：讀取舊版 flight:state:<flightKey>
      const legacy = await this.redis.get(`flight:state:${flightKey}`);
      if (legacy) {
        const leg = typeof legacy === 'string' ? JSON.parse(legacy) : legacy;
        return leg.lastPayload || leg;
      }
      return null;
    } catch (err) {
      console.warn(`[RedisStateStore] 讀取業務資料 ${flightKey} 失敗:`, err.message);
      return null;
    }
  }

  async saveFlightData(flightKey, flightData) {
    try {
      const existing = (await this.getFlightData(flightKey)) || {};
      const merged = {
        ...existing,
        ...flightData,
        updatedAt: Date.now()
      };
      await this.redis.set(`${this.dataPrefix}${flightKey}`, merged, { ex: 14 * 86400 });
    } catch (err) {
      console.warn(`[RedisStateStore] 儲存業務資料 ${flightKey} 失敗:`, err.message);
    }
  }

  async deleteFlight(flightKey) {
    try {
      await this.redis.del(`${this.schedulePrefix}${flightKey}`);
      await this.redis.del(`${this.dataPrefix}${flightKey}`);
      await this.redis.del(`flight:state:${flightKey}`); // 順手清理舊版 key
    } catch (err) {
      console.warn(`[RedisStateStore] 刪除 ${flightKey} 失敗:`, err.message);
    }
  }

  async clearAll() {
    try {
      const keys = await this.redis.keys('flight:*');
      for (const k of keys) {
        await this.redis.del(k);
      }
    } catch (_) {}
  }

  // 向後相容方法
  async getState(flightKey) {
    const s = await this.getSchedule(flightKey);
    const d = await this.getFlightData(flightKey);
    if (!s && !d) return null;
    return { ...d, ...s, lastPayload: d };
  }
}

class HybridStateStore extends BaseStateStore {
  constructor() {
    super();
    this.localStore = new LocalFileStateStore();
    this.hasRedis = Boolean(process.env.UPSTASH_REDIS_REST_URL && process.env.UPSTASH_REDIS_REST_TOKEN);
    if (this.hasRedis) {
      this.redisStore = new RedisStateStore();
    }
  }

  async getSchedule(flightKey) {
    if (this.hasRedis) {
      const remote = await this.redisStore.getSchedule(flightKey);
      if (remote) return remote;
    }
    return await this.localStore.getSchedule(flightKey);
  }

  async saveSchedule(flightKey, scheduleData) {
    if (this.hasRedis) {
      await this.redisStore.saveSchedule(flightKey, scheduleData);
    }
    await this.localStore.saveSchedule(flightKey, scheduleData);
  }

  async getFlightData(flightKey) {
    if (this.hasRedis) {
      const remote = await this.redisStore.getFlightData(flightKey);
      if (remote) return remote;
    }
    return await this.localStore.getFlightData(flightKey);
  }

  async saveFlightData(flightKey, flightData) {
    if (this.hasRedis) {
      await this.redisStore.saveFlightData(flightKey, flightData);
    }
    await this.localStore.saveFlightData(flightKey, flightData);
  }

  async deleteFlight(flightKey) {
    if (this.hasRedis) {
      await this.redisStore.deleteFlight(flightKey);
    }
    await this.localStore.deleteFlight(flightKey);
  }

  async clearAll() {
    if (this.hasRedis) {
      await this.redisStore.clearAll();
    }
    await this.localStore.clearAll();
  }

  // 向後相容方法
  async getState(flightKey) {
    const s = await this.getSchedule(flightKey);
    const d = await this.getFlightData(flightKey);
    if (!s && !d) return null;
    return { ...d, ...s, lastPayload: d };
  }
}

function createStateStore() {
  return new HybridStateStore();
}

module.exports = {
  BaseStateStore,
  LocalFileStateStore,
  RedisStateStore,
  HybridStateStore,
  createStateStore
};
